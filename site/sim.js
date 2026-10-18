// In-browser port of pipeline/merchant.py (same policy logic; Python is the reference implementation).
import { lineChart, hbars, fmt, h } from "./charts.js";
import { S, C, card, para, table, selectCtl, teamName, dayMs, addDays, CLASS_LABEL, statusPill } from "./app.js";

const SAFETY = 1.2;
const P = { run: null, arch: "licensed_reseller", lead: null, units: 20, retail: null, cost: null, salvage: null };

const SHORT = {
  pod: "Print-on-demand",
  dtf_inhouse: "In-house DTF/DTG",
  screenprint_contract: "Contract screen print",
  licensed_reseller: "Licensed reseller",
};
function mean(a) {
  return a.reduce((x, y) => x + y, 0) / (a.length || 1);
}

export function simulateRun(run, L, policy, holds) {
  const D = run.demand,
    n = D.length,
    dates = run.dates;
  const mult = S.merchant.multipliers[run.season];
  const cm = mult.classes[String(Math.min(21, L))] || {};
  const poMult = mult.po_mult;
  const leaguePo = S.merchant.league_po_start[run.season];
  const sigByDay = {};
  for (const s of run.signals) sigByDay[s.day0] = s; // last signal of the day wins (emission order)
  const st = { mult: 1, until: -1, dead: false };
  const reactive = (t) => mean(D.slice(Math.max(0, t - 2), t + 1));
  const fc = {
    reactive,
    signal: (t) => {
      const base = reactive(t);
      const day = dates[t];
      const r = sigByDay[day];
      if (r) {
        if (r.cls === "elimination") st.dead = true;
        else if (cm[r.cls] != null) {
          st.mult = cm[r.cls];
          st.until = t + L;
        }
      }
      if (st.dead) return 1.0;
      let f = base * (t <= st.until ? st.mult : 1);
      if (run.t_ladder && day >= run.t_ladder && day >= addDays(leaguePo, -(L + 7))) f = Math.max(f, poMult);
      return f;
    },
    hindsight: (t) => D[Math.min(t + L, n - 1)] / SAFETY,
  }[policy];
  const arrivals = new Array(n + L + 1).fill(0);
  let onHand = mean(D.slice(0, 3)) * (L + 1),
    pipeline = 0,
    sold = 0,
    lost = 0;
  const out = { sold: [], lost: [], onHand: [] };
  for (let t = 0; t < n; t++) {
    onHand += arrivals[t];
    pipeline -= arrivals[t];
    const s = holds ? Math.min(D[t], onHand) : D[t];
    sold += s;
    lost += D[t] - s;
    onHand -= s;
    if (holds) {
      const f = fc(t);
      const q = Math.max(0, f * (L + 1) * SAFETY - onHand - pipeline);
      arrivals[t + L] += q;
      pipeline += q;
    }
    out.sold.push(sold);
    out.lost.push(lost);
    out.onHand.push(onHand);
  }
  const leftover = holds ? Math.max(0, onHand + pipeline - (L + 1) * SAFETY) : 0;
  return { sold, lost, leftover, demand: D.reduce((a, b) => a + b, 0), daily: out };
}

function econ(a) {
  return {
    retail: P.retail ?? a.retail,
    cost: P.cost ?? a.unit_cost,
    salvage: (P.salvage ?? a.salvage_pct) / 100,
  };
}
function profit(res, e, units) {
  return (res.sold * (e.retail - e.cost) - res.leftover * e.cost * (1 - e.salvage)) * units;
}

export function renderMerchant(root) {
  root.replaceChildren();
  const M = S.merchant;
  const runs = M.runs;
  if (!P.run)
    P.run = runs.find((r) => r.season === "2025-26" && r.abbr === "NYK") || runs.find((r) => r.champion) || runs[0];
  root.appendChild(h("h1", null, "Could a merchant actually have acted, and would it have paid?"));
  para(
    root,
    "Every playoff run with a usable demand series, replayed day by day. Each morning the merchant orders enough stock to cover its lead time (order-up-to policy, 1.2× safety). The reactive merchant forecasts from its last 3 days of sales. The signal-aware merchant uses the same forecast, but pre-positions once the make-playoffs market says it's ≥90% and the calendar says the playoffs are near, scales orders on classified title-odds signals, and stops ordering the night of an elimination signal. All scaling factors come from the other season. Hindsight is the perfect-forecast ceiling.",
    "lede",
  );

  const arch = M.archetypes;
  const a = arch[P.arch];
  const L = P.lead ?? a.lead;
  const e = econ(a);
  const f = h("div", "filters");
  f.appendChild(
    selectCtl(
      "Playoff run",
      runs.map((r, i) => [String(i), `${r.season} · ${teamName(r.abbr)}${r.champion ? " (champion)" : ""}`]),
      String(runs.indexOf(P.run)),
      (v) => {
        P.run = runs[+v];
        renderMerchant(root);
      },
    ),
  );
  f.appendChild(
    selectCtl(
      "Merchant type",
      Object.values(arch).map((x) => [x.id, `${SHORT[x.id] || x.name} · ${x.lead}d lead`]),
      P.arch,
      (v) => {
        P.arch = v;
        P.lead = null;
        P.retail = P.cost = P.salvage = null;
        renderMerchant(root);
      },
    ),
  );
  const num = (label, val, step, on, w = 80) => {
    const l = h("label", null, label);
    const i = h("input");
    i.type = "number";
    i.value = val;
    i.step = step;
    i.style.width = w + "px";
    i.addEventListener("change", () => on(+i.value));
    l.appendChild(i);
    return l;
  };
  const rng = h("label", null, `Lead time: ${L} days`);
  const ri = h("input");
  ri.type = "range";
  ri.min = 0;
  ri.max = 21;
  ri.value = L;
  ri.addEventListener("input", () => {
    rng.firstChild.textContent = `Lead time: ${ri.value} days`;
  });
  ri.addEventListener("change", () => {
    P.lead = +ri.value;
    renderMerchant(root);
  });
  rng.appendChild(ri);
  f.appendChild(rng);
  f.appendChild(
    num("Normal sales (units/day)", P.units, 1, (v) => {
      P.units = Math.max(1, v);
      renderMerchant(root);
    }),
  );
  f.appendChild(
    num(
      "Retail $",
      e.retail,
      1,
      (v) => {
        P.retail = v;
        renderMerchant(root);
      },
      70,
    ),
  );
  f.appendChild(
    num(
      "Unit cost $",
      e.cost,
      0.5,
      (v) => {
        P.cost = v;
        renderMerchant(root);
      },
      70,
    ),
  );
  f.appendChild(
    num(
      "Salvage %",
      Math.round(e.salvage * 100),
      5,
      (v) => {
        P.salvage = v;
        renderMerchant(root);
      },
      70,
    ),
  );
  root.appendChild(f);
  if (!a.holds_inventory)
    root.appendChild(
      h(
        "div",
        "callout",
        "Print-on-demand holds no inventory, so every policy sells everything and the simulation is trivially equal. For POD the signal's value is ad and creative timing (be live with the right design the morning after a clinch), not stock. Pick another merchant type to see inventory effects.",
      ),
    );

  const run = P.run;
  const res = {};
  for (const pol of ["reactive", "signal", "hindsight"]) res[pol] = simulateRun(run, L, pol, a.holds_inventory);
  const xs = run.dates.map(dayMs);
  const c1 = card(
    root,
    `${teamName(run.abbr)} ${run.season}: demand during the run`,
    `1.0 = a normal day (${P.units} units)`,
  );
  const ch = h("div");
  c1.appendChild(ch);
  const rules = [];
  const inWin = (d) => d >= run.dates[0] && d <= run.dates[run.dates.length - 1];
  rules.push({ x: dayMs(run.po_start), label: "playoffs start", row: 0 });
  rules.push({ x: dayMs(run.po_end), label: run.champion ? "title" : "last game", row: 0 });
  const tr = run.t_react;
  if (tr && inWin(tr)) rules.push({ x: dayMs(tr), label: "own sales +50%", row: 1 });
  const lead = S.merchant.league_po_start[run.season];
  if (run.t_ladder) {
    const pre = addDays(lead, -(L + 7));
    const d = run.t_ladder > pre ? run.t_ladder : pre;
    if (inWin(d)) rules.push({ x: dayMs(d), label: "ladder pre-position", row: 2 });
  }
  const markers = run.signals
    .filter((s) => inWin(s.day0))
    .map((s) => {
      const i = run.dates.indexOf(s.day0);
      return {
        x: dayMs(s.day0),
        y: run.demand[i] * P.units,
        shape: s.cls === "elimination" ? "down" : s.dir > 0 ? "up" : "down",
        tip: [
          s.day0,
          [
            { value: CLASS_LABEL[s.cls] || s.cls, label: "signal" },
            { value: `${fmt.pct(s.p0, 1)} → ${fmt.pct(s.p1, 1)}`, label: "title odds" },
          ],
        ],
      };
    });
  lineChart(ch, {
    height: 240,
    x: { domain: [xs[0], xs[xs.length - 1]] },
    y: { format: (v) => fmt.num(v) },
    series: [
      { label: "Demand (units/day)", color: C.s1, points: xs.map((x, i) => [x, run.demand[i] * P.units]), area: true },
    ],
    rules,
    markers,
    extraLegend: [{ label: "Kept title-odds signal", kind: "tri-up" }],
  });
  const c2 = card(root, "Cumulative lost sales (stock-outs)", "lower is better");
  c2.classList.add("mt");
  const ch2 = h("div");
  c2.appendChild(ch2);
  lineChart(ch2, {
    height: 200,
    x: { domain: [xs[0], xs[xs.length - 1]] },
    y: { format: (v) => fmt.num(v) },
    series: [
      { label: "Reactive", color: C.s2, points: xs.map((x, i) => [x, res.reactive.daily.lost[i] * P.units]) },
      { label: "Signal-aware", color: C.s1, points: xs.map((x, i) => [x, res.signal.daily.lost[i] * P.units]) },
      {
        label: "Hindsight",
        color: C.muted,
        points: xs.map((x, i) => [x, res.hindsight.daily.lost[i] * P.units]),
        width: 1.5,
      },
    ],
  });

  const g = h("div", "grid2 mt");
  root.appendChild(g);
  const c3 = card(
    g,
    "This run",
    `${a.name.split("(")[0].trim()} · ${L}-day lead · $${e.retail} retail / $${e.cost} cost / ${Math.round(e.salvage * 100)}% salvage`,
  );
  table(
    c3,
    [
      { label: "Policy", get: (x) => x.lab },
      { label: "Units sold", num: true, get: (x) => fmt.num(x.r.sold * P.units) },
      { label: "Lost (stock-out)", num: true, get: (x) => fmt.num(x.r.lost * P.units) },
      { label: "Stranded at end", num: true, get: (x) => fmt.num(x.r.leftover * P.units) },
      { label: "Gross profit", num: true, get: (x) => fmt.money(profit(x.r, e, P.units)) },
    ],
    [
      { lab: "Reactive (own sales)", r: res.reactive },
      { lab: "Signal-aware", r: res.signal },
      { lab: "Hindsight (ceiling)", r: res.hindsight },
    ],
  );
  const up = profit(res.signal, e, P.units) - profit(res.reactive, e, P.units);
  const gap = profit(res.hindsight, e, P.units) - profit(res.reactive, e, P.units);
  const p = h("p", "small mt");
  p.appendChild(
    statusPill(
      up > 0 ? "good" : up < 0 ? "bad" : "na",
      up > 0 ? "signal helps" : up < 0 ? "signal hurts" : "no difference",
    ),
  );
  p.appendChild(
    document.createTextNode(
      ` Signal-aware vs reactive: ${fmt.money(up)} on this run; that's ${gap > 0 ? fmt.pct(up / gap, 0) : "–"} of the gap to a perfect forecast.`,
    ),
  );
  c3.appendChild(p);

  const c4 = card(
    g,
    "All runs, every merchant type",
    `${runs.length} playoff runs, both seasons, at the settings above`,
  );
  const rows = Object.values(arch).map((x) => {
    const Lx = x.id === P.arch ? L : x.lead;
    const ex2 = x.id === P.arch ? e : { retail: x.retail, cost: x.unit_cost, salvage: x.salvage_pct / 100 };
    let pr = 0,
      ps = 0,
      ph = 0,
      better = 0;
    for (const r of runs) {
      const a1 = profit(simulateRun(r, Lx, "reactive", x.holds_inventory), ex2, P.units);
      const a2 = profit(simulateRun(r, Lx, "signal", x.holds_inventory), ex2, P.units);
      const a3 = profit(simulateRun(r, Lx, "hindsight", x.holds_inventory), ex2, P.units);
      pr += a1;
      ps += a2;
      ph += a3;
      better += a2 > a1 + 1e-6;
    }
    return { x, Lx, pr, ps, ph, better };
  });
  table(
    c4,
    [
      { label: "Merchant type", get: (r) => SHORT[r.x.id] || r.x.name },
      { label: "Lead", num: true, get: (r) => r.Lx + "d" },
      { label: "Reactive", num: true, get: (r) => fmt.money(r.pr) },
      { label: "Signal-aware", num: true, get: (r) => fmt.money(r.ps) },
      {
        label: "Uplift",
        num: true,
        get: (r) =>
          r.pr ? (r.ps >= r.pr ? "+" : "") + (((r.ps - r.pr) / Math.abs(r.pr)) * 100).toFixed(1) + "%" : "–",
      },
      { label: "Gap closed", num: true, get: (r) => (r.ph - r.pr > 0 ? fmt.pct((r.ps - r.pr) / (r.ph - r.pr)) : "–") },
      { label: "Runs better", num: true, get: (r) => `${r.better}/${runs.length}` },
    ],
    rows,
  );
  para(
    c4,
    "Gap closed = share of the profit gap between reactive and perfect-forecast ordering that the signal closes. Profit = units sold × (retail − cost) − stranded units × cost × (1 − salvage), over the run window (35 days before the playoffs to 14 days after the last game). Gross margin only: no ad spend or rush fees. Default economics come from the execution research (cited below).",
    "tiny muted mt",
  );

  const c5 = card(
    root,
    "Execution reality: how fast can each merchant type move?",
    "from supplier and fulfilment docs; [est] = analyst estimate",
  );
  c5.classList.add("mt");
  const R = S.research.execution_leadtimes;
  if (R) {
    const rows2 = [];
    for (const ar of R.archetypes) for (const ac of ar.actions) rows2.push({ ar, ac });
    table(
      c5,
      [
        { label: "Merchant type", get: (r) => r.ar.name.split("(")[0].trim() },
        { label: "Action", get: (r) => r.ac.action },
        { label: "Fast", num: true, get: (r) => fmtDays(r.ac.lead_time_days_fast) },
        { label: "Typical", num: true, get: (r) => fmtDays(r.ac.lead_time_days_typical) },
        { label: "Slow", num: true, get: (r) => fmtDays(r.ac.lead_time_days_slow) },
        {
          label: "Source",
          get: (r) => {
            const u = (r.ac.source_urls || [])[0];
            if (!u) return "–";
            const l = h("a", "src", hostOf(u));
            l.href = u;
            l.target = "_blank";
            l.rel = "noopener";
            return l;
          },
        },
      ],
      rows2,
      { maxHeight: "460px" },
    );
  }
}
function fmtDays(d) {
  if (d == null) return "–";
  if (d < 1) return Math.round(d * 24) + "h";
  return Math.round(d * 10) / 10 + "d";
}
function hostOf(u) {
  try {
    return new URL(u).hostname.replace("www.", "");
  } catch {
    return "link";
  }
}
