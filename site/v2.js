// Three-merchant views. Orders and profits are recomputed in the browser from the exported forecasts so the
// economics inputs can change live; pipeline/scenarios.py is the reference implementation.
import { lineChart, fmt, h } from "./charts.js";
import {
  S,
  C,
  UI,
  LEAGUES,
  card,
  para,
  richPara,
  table,
  statusPill,
  selectCtl,
  dayMs,
  addDays,
  leagueData,
} from "./app.js";

const H = 14;
export const MERCH = [
  {
    id: "m0",
    name: "Business as usual",
    tag: "Scenario 1 · did nothing special",
    desc: "Re-orders 14 days at last week's pace plus its usual buffer. Doesn't react to the news.",
  },
  {
    id: "m1",
    name: "Smart merchant",
    tag: "Scenario 2 · gut feel",
    desc: "Knows the headline (good news, bad news, eliminated, won it all) and orders what that kind of headline usually means.",
  },
  {
    id: "m2",
    name: "Pro with history",
    tag: "strict benchmark",
    desc: "Knows our exact event class (series clinch, mid-series loss, rival's game, trade…) and its historical average, but not the market's number.",
  },
  {
    id: "m3",
    name: "Tipoff",
    tag: "Scenario 3 · our signal",
    desc: "Event class plus the market's number: how far and to where the odds moved. Model trained only on the other season.",
  },
  {
    id: "m4",
    name: "Perfect hindsight",
    tag: "ceiling",
    desc: "Ordered exactly the demand that arrived. Nobody can do this; it defines the opportunity.",
  },
];
const CAT_LABEL = {
  good: "Good news (team still playing)",
  bad: "Bad news (team still playing)",
  eliminated: "Season over: eliminated",
  title: "Season over: won the title",
};
const ECON = { retail: 30, cost: 12, salvage: 30, store: 20 };
const V = { sid: null, league: "ALL", cat: "ALL", replayLeague: "ALL", q: "" };

// inverse standard normal (Acklam)
function zOf(p) {
  const a = [
    -39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239,
  ];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [
    -0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968,
    2.938163982698783,
  ];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const pl = 0.02425;
  if (p < pl) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (
      (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    );
  }
  if (p > 1 - pl) {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    return (
      -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    );
  }
  const q = p - 0.5,
    r = q * q;
  return (
    ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) /
    (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
  );
}

export function econ() {
  const cu = ECON.retail - ECON.cost,
    co = ECON.cost * (1 - ECON.salvage / 100);
  return { cu, co, cr: cu / (cu + co), z: zOf(cu / (cu + co)) };
}

/** per-event outcomes for every merchant, in units of last week's daily sales (×store for units) */
export function score(ev, E = econ()) {
  const out = {};
  for (const m of MERCH) {
    const Q = m.id === "m4" ? ev.X : H * Math.exp(ev[`${m.id}_mu`] + E.z * ev[`${m.id}_sd`]);
    const sold = Math.min(Q, ev.X),
      left = Math.max(Q - ev.X, 0),
      lost = Math.max(ev.X - Q, 0);
    out[m.id] = { Q, sold, left, lost, profit: E.cu * sold - E.co * left };
  }
  return out;
}

export function aggregate(events, E = econ()) {
  const n = events.length;
  if (!n) return null;
  const tot = {};
  for (const m of MERCH) tot[m.id] = { profit: 0, sold: 0, left: 0, lost: 0, Q: 0 };
  let X = 0,
    win31 = 0,
    win32 = 0;
  for (const ev of events) {
    const s = score(ev, E);
    X += ev.X;
    for (const m of MERCH) for (const k of ["profit", "sold", "left", "lost", "Q"]) tot[m.id][k] += s[m.id][k];
    win31 += s.m3.profit >= s.m1.profit - 1e-9;
    win32 += s.m3.profit >= s.m2.profit - 1e-9;
  }
  const gap = tot.m4.profit - tot.m0.profit;
  const res = { n, demandVsLastWeek: X / (H * n) - 1, win31: win31 / n, win32: win32 / n, m: {} };
  for (const m of MERCH) {
    const t = tot[m.id];
    res.m[m.id] = {
      ...t,
      captured: gap > 0 ? (t.profit - tot.m0.profit) / gap : NaN,
      soldVsLastWeek: t.sold / (H * n) - 1,
      unitsVsM0: t.sold / tot.m0.sold - 1,
      profitVsM0PerEvent: ((t.profit - tot.m0.profit) / n) * ECON.store,
      profitPerEvent: (t.profit / n) * ECON.store,
    };
  }
  return res;
}

const evs = () => S.v2.scenarios.events.filter((e) => e.passed);
const signedPct = (v, d = 0) =>
  v == null || !isFinite(v) ? "–" : (v >= 0 ? "+" : "−") + Math.abs(v * 100).toFixed(d) + "%";

function divBars(container, rows, o = {}) {
  container.replaceChildren();
  const vals = rows.map((r) => r.value).filter(isFinite);
  const lo = Math.min(0, ...vals, o.min ?? 0),
    hi = Math.max(0, ...vals, o.max ?? 0);
  const span = hi - lo || 1;
  const list = h("div", "dbars");
  for (const r of rows) {
    const row = h("div", "dbar-row");
    row.appendChild(h("div", null, r.label));
    const tr = h("div", "dbar-track");
    const z = h("div", "dbar-zero");
    z.style.left = ((0 - lo) / span) * 100 + "%";
    tr.appendChild(z);
    if (isFinite(r.value)) {
      const b = h("div", "dbar");
      const x0 = Math.min(0, r.value),
        x1 = Math.max(0, r.value);
      b.style.left = ((x0 - lo) / span) * 100 + "%";
      b.style.width = Math.max(0.4, ((x1 - x0) / span) * 100) + "%";
      b.style.background = r.color || (r.value >= 0 ? "var(--pos)" : "var(--neg)");
      if (r.dim) b.style.opacity = 0.45;
      tr.appendChild(b);
    }
    row.appendChild(tr);
    row.appendChild(h("div", "dbar-val", r.display ?? signedPct(r.value)));
    if (r.title) row.title = r.title;
    list.appendChild(row);
  }
  container.appendChild(list);
}

function econControls(parent, onChange) {
  const f = h("div", "filters");
  const num = (label, key, step, w = 76) => {
    const l = h("label", null, label);
    const i = h("input");
    i.type = "number";
    i.step = step;
    i.value = ECON[key];
    i.style.width = w + "px";
    i.addEventListener("change", () => {
      ECON[key] = +i.value;
      onChange();
    });
    l.appendChild(i);
    return l;
  };
  f.appendChild(num("Retail price $", "retail", 1));
  f.appendChild(num("Unit cost $", "cost", 0.5));
  f.appendChild(num("Leftover salvage %", "salvage", 5));
  f.appendChild(num("Store's normal sales (units/day)", "store", 1, 90));
  const E = econ();
  f.appendChild(
    h(
      "span",
      "small muted",
      `→ the profit-maximising order is the ${Math.round(E.cr * 100)}th percentile of each merchant's demand forecast`,
    ),
  );
  parent.appendChild(f);
}

function verdictPill(p) {
  if (p == null) return statusPill("na", "n/a");
  if (p === 0.01) return statusPill("good", "yes (90% CI > 0)");
  if (p < 0.05) return statusPill("good", `yes (p = ${fmt.p(p)})`);
  if (p < 0.2) return statusPill("warn", `suggestive (p = ${fmt.p(p)})`);
  return statusPill("bad", `no (p = ${fmt.p(p)})`);
}

export function renderAnswer(root) {
  root.replaceChildren();
  const SC = S.v2.scenarios;
  const P = SC.primary;
  const all = evs();
  const A = aggregate(all);
  root.appendChild(h("h1", null, "If a merchant had our signal at T=0, would they have made more money?"));
  const re = h("div", "callout");
  re.appendChild(h("strong", null, "The reframe we're testing: "));
  re.appendChild(
    document.createTextNode(
      'prediction markets don\'t beat the news; they price it, instantly and in numbers. The question is whether that number lets a merchant size their response better than they would on their own. We stop asking "does the market move first?" and ask "does the market\'s number make the merchant\'s decision better?"',
    ),
  );
  root.appendChild(re);

  const lg = Object.keys(SC.by_league);
  para(
    root,
    `How we tested it: for every one of ${A.n} classified signals across ${lg.length} league${lg.length > 1 ? "s" : ""} (${lg.join(", ")}; two seasons each, MLB 2024 from late August), five merchants each placed one order at the moment the signal fired, to cover the next 14 days. Delivery is instant (a deliberate simplification), but they can't top up mid-window, because otherwise no decision would matter. Then we replayed what fans actually did. Demand = the team's merch-search volume, used as a stand-in for sales. Every forecast was trained only on the other season (no lookahead).`,
    "lede",
  );

  const mc = h("div", "merchants mt");
  for (const m of MERCH) {
    const x = A.m[m.id];
    const c = h("div", "mcard" + (m.id === "m3" ? " hl" : ""));
    c.appendChild(h("div", "tiny muted", m.tag));
    c.appendChild(h("div", "mname", m.name));
    c.appendChild(h("div", "msub", m.desc));
    c.appendChild(h("div", "mnum", signedPct(x.soldVsLastWeek)));
    c.appendChild(h("div", "msub", "units sold vs last week"));
    c.appendChild(h("div", "mnum", m.id === "m0" ? "–" : signedPct(x.captured)));
    c.appendChild(
      h(
        "div",
        "msub",
        m.id === "m0"
          ? "the baseline (0%)"
          : m.id === "m4"
            ? "the whole opportunity (100%)"
            : "of the opportunity captured",
      ),
    );
    mc.appendChild(c);
  }
  root.appendChild(mc);
  para(
    root,
    `Demand over the 14 days after a signal ran ${signedPct(A.demandVsLastWeek)} vs the previous week. "Opportunity" = the extra profit a perfect forecaster earns over business as usual: ${fmt.money(A.m.m4.profitVsM0PerEvent)} per event for a store that normally sells ${ECON.store} units/day (at $${ECON.retail} retail, $${ECON.cost} cost, ${ECON.salvage}% salvage). Negative = worse than doing nothing special.`,
    "small secondary mt",
  );

  const g = h("div", "grid2 mt");
  root.appendChild(g);
  const v = card(g, "The three scenarios, answered");
  const b = P.bootstrap;
  const rows = [
    [
      "Does Tipoff beat doing nothing special?",
      { p: P.bootstrap.ci.m3.lo > 0 ? 0.01 : 0.5 },
      `Tipoff captured ${signedPct(P.captured.m3)} of the opportunity (90% CI ${signedPct(P.bootstrap.ci.m3.lo)} to ${signedPct(P.bootstrap.ci.m3.hi)}; the interval excludes zero). Gut feel: ${signedPct(P.captured.m1)}.`,
    ],
    [
      "Does Tipoff beat the smart merchant's gut feel?",
      b.m3_minus_m1,
      `Tipoff ${signedPct(P.captured.m3)} vs smart merchant ${signedPct(P.captured.m1)} of the opportunity (difference ${signedPct(P.captured.m3 - P.captured.m1)}; 90% CI ${signedPct(b.m3_minus_m1.lo)} to ${signedPct(b.m3_minus_m1.hi)}). Tipoff did at least as well on ${fmt.pct(P.win_m3_vs_m1)} of events.`,
    ],
    [
      "Does the market's number add anything beyond knowing the event class?",
      b.m3_minus_m2,
      `Tipoff ${signedPct(P.captured.m3)} vs pro-with-history ${signedPct(P.captured.m2)} (difference ${signedPct(P.captured.m3 - P.captured.m2)}; 90% CI ${signedPct(b.m3_minus_m2.lo)} to ${signedPct(b.m3_minus_m2.hi)}). This is the strict test of the reframe.`,
    ],
  ];
  for (const [q, bb, a] of rows) {
    const s = h("div", "score");
    s.appendChild(h("div", "q", q));
    s.appendChild(verdictPill(bb.p));
    s.appendChild(h("div", "a", a));
    v.appendChild(s);
  }
  const pl = SC.placebo;
  if (pl) {
    const s = h("div", "score");
    s.appendChild(h("div", "q", "Placebo: does Tipoff's edge vanish when the odds numbers are shuffled?"));
    s.appendChild(statusPill(pl.p < 0.05 ? "good" : "warn", pl.p < 0.05 ? "edge is real" : "can't tell"));
    s.appendChild(
      h(
        "div",
        "a",
        `With the odds-move sizes shuffled among events of the same class, the same model captured ${signedPct(pl.mean)} on average (95th pct ${signedPct(pl.p95)}) vs ${signedPct(pl.actual)} with the real numbers (p = ${fmt.p(pl.p)}).`,
      ),
    );
    v.appendChild(s);
  }

  const w = card(g, "Where the money is (and isn't)", "share of the opportunity captured, by what happened");
  const cats = ["eliminated", "title", "bad", "good"];
  for (const c of cats) {
    const ce = all.filter((e) => e.cat === c);
    if (!ce.length) continue;
    const a = aggregate(ce);
    w.appendChild(
      h("h4", "mt", `${CAT_LABEL[c]} · ${ce.length} events · demand ${signedPct(a.demandVsLastWeek)} vs last week`),
    );
    const d = h("div");
    w.appendChild(d);
    divBars(
      d,
      ["m1", "m2", "m3"]
        .map((id) => ({
          label: MERCH.find((m) => m.id === id).name,
          value: a.m[id].captured,
          color: id === "m3" ? "var(--pos)" : "var(--muted-series)",
        }))
        .map((r) => ({ ...r, color: r.value < 0 ? "var(--neg)" : r.color })),
      { min: -0.5, max: 1 },
    );
  }
  para(
    w,
    "Bars show each merchant's profit gain over business as usual, as a share of what perfect hindsight would have gained. 100% = perfect, 0% = no better than doing nothing special, below 0 = worse.",
    "tiny muted mt",
  );

  const k = card(root, "What this means, in plain English");
  k.classList.add("mt");
  const ul = h("ul", "prose");
  for (const t of answerBullets(SC, A, all)) ul.appendChild(h("li", null, t));
  k.appendChild(ul);
  const integ = h("p", "tiny muted");
  integ.textContent = `Integrity: design pre-registered before any v2 result (sha256 ${SC.prereg_sha256.slice(0, 16)}…); ${SC.amendments?.amendments?.length || 0} documented amendment(s); forecasts trained on the other season only; CIs from a cluster bootstrap by team-season. Details under Method & integrity.`;
  k.appendChild(integ);
}

function answerBullets(SC, A, all) {
  const out = [];
  const byCat = (c) => {
    const ce = all.filter((e) => e.cat === c);
    return ce.length ? aggregate(ce) : null;
  };
  const el = byCat("eliminated"),
    gd = byCat("good"),
    bd = byCat("bad");
  const P = SC.primary,
    ci = P.bootstrap.ci.m3,
    b = P.bootstrap;
  const ok = Object.entries(SC.by_league).filter(([, v]) => v.n >= 20);
  const won = ok.filter(([, v]) => v.bootstrap.m3_minus_m1.p < 0.05).map(([L]) => L);
  const robust = (L) => Object.values(SC.robustness_by_league || {}).every((d) => d[L] && d[L].m3 > d[L].m1);
  out.push(
    `Versus doing nothing special: Tipoff captured ${signedPct(A.m.m3.captured)} of the available opportunity (90% CI ${signedPct(ci.lo)} to ${signedPct(ci.hi)}), or ${fmt.money(A.m.m3.profitVsM0PerEvent)} per event for a store selling ${ECON.store} units/day. The ceiling (perfect hindsight) is ${fmt.money(A.m.m4.profitVsM0PerEvent)}. That's a real, statistically solid gain over business as usual.`,
  );
  out.push(
    `Versus a smart merchant who already follows every game and has calibrated instincts: Tipoff ${signedPct(P.captured.m3)} vs ${signedPct(P.captured.m1)} (p = ${fmt.p(b.m3_minus_m1.p)}). Overall that's not a reliable edge.` +
      (won.length
        ? ` The exception is the ${won.join(" and ")}: ${won.map((L) => `Tipoff ${signedPct(SC.by_league[L].captured.m3)} vs gut feel ${signedPct(SC.by_league[L].captured.m1)} (p = ${fmt.p(SC.by_league[L].bootstrap.m3_minus_m1.p)})${robust(L) ? ", ahead in every robustness variant" : ""}`).join("; ")}. In ${ok
            .filter(([L]) => !won.includes(L))
            .map(([L]) => L)
            .join(" and ")} the market's number added nothing over gut feel.`
        : ""),
  );
  if (el)
    out.push(
      `"Stop" is the biggest money per event. After eliminations, demand fell ${signedPct(el.demandVsLastWeek)} vs the week before. Any merchant who knew captured about ${signedPct(el.m.m3.captured)} of the opportunity, simply by not restocking at last week's pace.`,
    );
  if (gd)
    out.push(
      `"Go" (good news) works, but less precisely. Demand ran ${signedPct(gd.demandVsLastWeek)} vs the week before. Tipoff captured ${signedPct(gd.m.m3.captured)} and gut feel ${signedPct(gd.m.m1.captured)}: the size of good-news bumps varies a lot, so even good forecasts leave most of it on the table.`,
    );
  if (bd)
    out.push(
      `Mid-season losses ("bad news, still playing"): demand ${signedPct(bd.demandVsLastWeek)} vs the week before. Nobody gains much (Tipoff ${signedPct(bd.m.m3.captured)}), which supports the playbook rule: don't over-react to a loss while the team is still alive.`,
    );
  const tq = SC.exploratory?.top_quartile_shocks;
  if (tq)
    out.push(
      `Big repricings matter most (exploratory): on the largest quarter of odds moves (n = ${tq.n}), Tipoff captured ${signedPct(tq.m3)} vs gut feel ${signedPct(tq.m1)}.`,
    );
  out.push(
    `Sales vs profit: event-aware merchants sell more units than business as usual (Tipoff ${signedPct(A.m.m3.unitsVsM0)}, gut feel ${signedPct(A.m.m1.unitsVsM0)}). Price on profit uplift, not GMV: some of that extra volume comes with leftover stock.`,
  );
  const thin = Object.entries(SC.by_league)
    .filter(([, v]) => v.n < 20)
    .map(([L]) => L);
  if (thin.length)
    out.push(
      `${thin.join(", ")}: not enough usable search data to judge (US merch searches too sparse for most teams). Excluded from conclusions, not evidence against.`,
    );
  return out;
}

export async function renderReplay(root) {
  root.replaceChildren();
  const all = evs();
  if (!V.sid) V.sid = all.find((e) => e.sid === "25-LAL-020213") ? "25-LAL-020213" : all[0].sid;
  root.appendChild(h("h1", null, "Event replay: five merchants, one signal"));
  para(
    root,
    "Pick any classified signal. At T=0 (the moment it fired) each merchant commits one order for the next 14 days. Then we play back the demand that actually arrived.",
    "lede",
  );
  econControls(root, () => renderReplay(root));
  const g = h("div", "grid2");
  root.appendChild(g);
  g.style.gridTemplateColumns = "minmax(0, 1fr) minmax(0, 2fr)";
  const lc = card(g, "Events", `${all.length} kept signals with demand data`);
  const f = h("div", "filters");
  f.appendChild(
    selectCtl("League", [["ALL", "All leagues"], ...LEAGUES.map((L) => [L, L])], V.replayLeague, (v) => {
      V.replayLeague = v;
      renderReplay(root);
    }),
  );
  const sl = h("label", null, "Search");
  const si = h("input");
  si.type = "text";
  si.value = V.q;
  si.placeholder = "team, class, cause…";
  si.addEventListener("change", () => {
    V.q = si.value;
    renderReplay(root);
  });
  sl.appendChild(si);
  f.appendChild(sl);
  lc.appendChild(f);
  const q = V.q.toLowerCase();
  const list = all
    .filter(
      (e) =>
        (V.replayLeague === "ALL" || e.league === V.replayLeague) &&
        (!q || `${e.abbr} ${e.cls} ${e.cause} ${e.league}`.toLowerCase().includes(q)),
    )
    .sort((a, b) => b.X / 14 - a.X / 14);
  const lw = h("div", "event-list");
  lc.appendChild(lw);
  table(
    lw,
    [
      { label: "Event", get: (e) => `${e.league} ${e.abbr} · ${e.day0}` },
      { label: "What", get: (e) => (e.cause.length > 38 ? e.cause.slice(0, 36) + "…" : e.cause) },
      { label: "Demand", num: true, get: (e) => fmt.num(e.X / 14, 1) + "×" },
    ],
    list.map((e) => ({ ...e, _cls: e.sid === V.sid ? "selected" : "" })),
    {
      onClick: (e) => {
        V.sid = e.sid;
        renderReplay(root);
      },
    },
  );
  para(lc, "Sorted by how big the demand response was (14-day demand ÷ last week's pace).", "tiny muted mt");

  const ev = all.find((e) => e.sid === V.sid) || list[0];
  if (!ev) return;
  const rc = card(g, null);
  let sig = null;
  try {
    sig = (await leagueData(ev.league)).signals.find((x) => x.sid === ev.sid);
  } catch (e) {
    /* league data not exported yet */
  }
  const head = h("div", "row");
  head.appendChild(statusPill("na", ev.league));
  head.appendChild(statusPill("na", CAT_LABEL[ev.cat]));
  head.appendChild(
    h("span", "small muted", `${ev.abbr} · signal day ${ev.day0} · class: ${ev.cls.replace(/_/g, " ")}`),
  );
  rc.appendChild(head);
  rc.appendChild(h("h2", "mt", ev.cause));
  richPara(rc, [
    "Title odds moved ",
    { b: `${fmt.pct(ev.p0, 1)} → ${fmt.pct(ev.p1, 1)}` },
    ` (${fmt.signed(ev.dlogit, 2)} log-odds). Over the next 14 days demand came in at `,
    { b: `${fmt.num(ev.X / 14, 2)}× last week's pace` },
    ".",
  ]);
  const s = score(ev);
  const E = econ();
  // demand path chart
  const ch = h("div");
  rc.appendChild(ch);
  const days = Array.from({ length: ev.path.length }, (_, i) => i - 7);
  lineChart(ch, {
    height: 190,
    x: { type: "linear", domain: [-7, 13], format: (v) => (v > 0 ? "+" : "") + v + "d" },
    y: { format: (v) => fmt.num(v, 1) + "×", zero: true },
    series: [
      {
        label: "daily demand ÷ last week's average day",
        color: C.s1,
        points: days.map((d, i) => [d, ev.path[i]]),
        area: true,
      },
    ],
    rules: [{ x: 0, label: "T=0: signal fires, orders placed", strong: true }],
    xTip: (x) => `day ${x > 0 ? "+" : ""}${x}`,
    snap: 0.5,
  });
  rc.appendChild(
    h("div", "tiny muted", "1.0× = a normal day last week. Days 0 to 13 are what each order has to cover."),
  );
  // per-merchant table
  const cum = [];
  let acc = 0;
  for (let i = 7; i < ev.path.length; i++) {
    acc += ev.path[i] ?? 0;
    cum.push(acc);
  }
  const soldOut = (Q) => {
    const i = cum.findIndex((c) => c > Q + 1e-9);
    return i < 0 ? null : i;
  };
  const t = h("div", "mt");
  rc.appendChild(t);
  table(
    t,
    [
      { label: "Merchant", get: (m) => m.name },
      { label: "Ordered (days of last week's sales)", num: true, get: (m) => fmt.num(s[m.id].Q, 1) },
      { label: "Units sold", num: true, get: (m) => fmt.num(s[m.id].sold * ECON.store) },
      {
        label: "Sold out",
        num: true,
        get: (m) => {
          const d = soldOut(s[m.id].Q);
          return m.id === "m4" ? "–" : d == null ? "no" : `day ${d}`;
        },
      },
      { label: "Missed sales", num: true, get: (m) => fmt.num(s[m.id].lost * ECON.store) },
      { label: "Leftover", num: true, get: (m) => fmt.num(s[m.id].left * ECON.store) },
      { label: "Profit", num: true, get: (m) => fmt.money(s[m.id].profit * ECON.store) },
      {
        label: "vs BAU",
        num: true,
        get: (m) => (m.id === "m0" ? "–" : fmt.money((s[m.id].profit - s.m0.profit) * ECON.store)),
      },
    ],
    MERCH.map((m) => ({ ...m, _cls: m.id === "m3" ? "selected" : "" })),
  );
  // narrative
  const best = ["m1", "m2", "m3"].reduce((a, b) => (s[b].profit > s[a].profit ? b : a), "m1");
  const nar = h("div", "callout mt");
  const d0 = soldOut(s.m0.Q);
  nar.appendChild(
    document.createTextNode(
      `Business as usual ordered ${fmt.num(s.m0.Q, 1)} days of last week's sales and ${d0 == null ? `was left with ${fmt.num(s.m0.left * ECON.store)} units` : `sold out on day ${d0}, missing ${fmt.num(s.m0.lost * ECON.store)} sales`}. ` +
        `The smart merchant ordered ${fmt.num(s.m1.Q, 1)}; Tipoff ordered ${fmt.num(s.m3.Q, 1)}. Perfect hindsight would have ordered ${fmt.num(ev.X, 1)}. ` +
        `On this event ${MERCH.find((m) => m.id === best).name} did best among the realistic merchants, and Tipoff ${s.m3.profit >= s.m0.profit ? "beat" : "lost to"} business as usual by ${fmt.money(Math.abs(s.m3.profit - s.m0.profit) * ECON.store)}.`,
    ),
  );
  rc.appendChild(nar);
  para(
    rc,
    `Orders are each merchant's forecast at the ${Math.round(E.cr * 100)}th percentile (the profit-maximising point when a missed sale costs $${(ECON.retail - ECON.cost).toFixed(0)} and a leftover unit costs $${(ECON.cost * (1 - ECON.salvage / 100)).toFixed(2)}). Forecasts were trained on the other season of the same league.`,
    "tiny muted",
  );
  if (sig) {
    const pb = sig.playbook;
    if (pb) {
      const c2 = h("div", "playbook mt");
      c2.appendChild(h("div", "stance", "What Tipoff would have told the merchant: " + pb.stance));
      for (const [who, what] of pb.actions.slice(0, 4)) {
        const r = h("div", "pb-row");
        r.appendChild(h("div", "pb-who", who));
        r.appendChild(h("div", null, what));
        c2.appendChild(r);
      }
      rc.appendChild(c2);
    }
  }
}

export function renderEvents(root) {
  root.replaceChildren();
  root.appendChild(h("h1", null, "All events: what each merchant captured"));
  para(
    root,
    "Change the store's economics and every order is re-sized and re-scored live. Filter by league or by what happened.",
    "lede",
  );
  econControls(root, () => renderEvents(root));
  const f = h("div", "filters");
  f.appendChild(
    selectCtl("League", [["ALL", "All leagues"], ...LEAGUES.map((L) => [L, L])], V.league, (v) => {
      V.league = v;
      renderEvents(root);
    }),
  );
  f.appendChild(
    selectCtl("What happened", [["ALL", "Everything"], ...Object.entries(CAT_LABEL)], V.cat, (v) => {
      V.cat = v;
      renderEvents(root);
    }),
  );
  root.appendChild(f);
  const sel = evs().filter(
    (e) => (V.league === "ALL" || e.league === V.league) && (V.cat === "ALL" || e.cat === V.cat),
  );
  const A = aggregate(sel);
  if (!A) {
    root.appendChild(h("div", "empty", "No events for this filter."));
    return;
  }
  const g = h("div", "grid2");
  root.appendChild(g);
  const c1 = card(
    g,
    "Share of the opportunity captured",
    `${A.n} events · demand ${signedPct(A.demandVsLastWeek)} vs last week`,
  );
  const d = h("div");
  c1.appendChild(d);
  divBars(
    d,
    MERCH.filter((m) => m.id !== "m0").map((m) => ({
      label: m.name,
      value: A.m[m.id].captured,
      color: m.id === "m4" ? "var(--muted-series)" : undefined,
    })),
    { min: -0.25, max: 1 },
  );
  para(c1, "0% = business as usual; 100% = perfect hindsight.", "tiny muted mt");
  const c2 = card(
    g,
    "Per event, for this store",
    `${ECON.store} units/day · $${ECON.retail} retail · $${ECON.cost} cost`,
  );
  table(
    c2,
    [
      { label: "Merchant", get: (m) => m.name },
      { label: "Sold vs last week", num: true, get: (m) => signedPct(A.m[m.id].soldVsLastWeek) },
      { label: "Units vs BAU", num: true, get: (m) => signedPct(A.m[m.id].unitsVsM0) },
      { label: "Profit / event", num: true, get: (m) => fmt.money(A.m[m.id].profitPerEvent) },
      { label: "vs BAU", num: true, get: (m) => (m.id === "m0" ? "–" : fmt.money(A.m[m.id].profitVsM0PerEvent)) },
    ],
    MERCH,
  );
  para(
    c2,
    `Tipoff ≥ smart merchant on ${fmt.pct(A.win31)} of events; ≥ pro-with-history on ${fmt.pct(A.win32)}.`,
    "small secondary mt",
  );

  const g2 = h("div", "grid2 mt");
  root.appendChild(g2);
  const c3 = card(g2, "By league");
  table(
    c3,
    [
      { label: "League", get: (r) => r.L },
      { label: "Events", num: true, get: (r) => r.a.n },
      { label: "Demand vs last wk", num: true, get: (r) => signedPct(r.a.demandVsLastWeek) },
      { label: "Smart", num: true, get: (r) => signedPct(r.a.m.m1.captured) },
      { label: "Pro", num: true, get: (r) => signedPct(r.a.m.m2.captured) },
      { label: "Tipoff", num: true, get: (r) => signedPct(r.a.m.m3.captured) },
    ],
    LEAGUES.map((L) => ({
      L,
      a: aggregate(evs().filter((e) => e.league === L && (V.cat === "ALL" || e.cat === V.cat))),
    })).filter((r) => r.a),
  );
  const c4 = card(g2, "By what happened");
  table(
    c4,
    [
      { label: "Category", get: (r) => CAT_LABEL[r.c] },
      { label: "Events", num: true, get: (r) => r.a.n },
      { label: "Demand vs last wk", num: true, get: (r) => signedPct(r.a.demandVsLastWeek) },
      { label: "Smart", num: true, get: (r) => signedPct(r.a.m.m1.captured) },
      { label: "Pro", num: true, get: (r) => signedPct(r.a.m.m2.captured) },
      { label: "Tipoff", num: true, get: (r) => signedPct(r.a.m.m3.captured) },
    ],
    Object.keys(CAT_LABEL)
      .map((c) => ({
        c,
        a: aggregate(evs().filter((e) => e.cat === c && (V.league === "ALL" || e.league === V.league))),
      }))
      .filter((r) => r.a),
  );

  // revenue model
  const c5 = card(root, "If we took a cut: revenue per merchant", "uses this page's filters and economics");
  c5.classList.add("mt");
  const perTeamSeason = {};
  for (const e of sel)
    perTeamSeason[`${e.league}-${e.season}-${e.abbr}`] = (perTeamSeason[`${e.league}-${e.season}-${e.abbr}`] || 0) + 1;
  const nonOverlap = nonOverlappingCount(sel);
  const ts = Object.keys(perTeamSeason).length;
  const perSeason = ts ? nonOverlap / ts : 0;
  const upl = A.m.m3.profitVsM0PerEvent,
    gmv = ((A.m.m3.sold - A.m.m0.sold) / A.n) * ECON.store * ECON.retail;
  const rows = [10, 20].map((take) => ({
    take,
    profitCut: ((Math.max(0, upl) * take) / 100) * perSeason,
    gmvCut: ((gmv * take) / 100) * perSeason,
  }));
  table(
    c5,
    [
      { label: "Take rate", get: (r) => r.take + "%" },
      { label: "…of profit uplift, per store per season", num: true, get: (r) => fmt.money(r.profitCut) },
      { label: "…of incremental GMV, per store per season", num: true, get: (r) => fmt.money(r.gmvCut) },
    ],
    rows,
  );
  para(
    c5,
    `Assumes one store per team, acting on ${fmt.num(perSeason, 1)} non-overlapping signals per team-season (the average here). Profit uplift per event: ${fmt.money(upl)}; incremental GMV per event: ${fmt.money(gmv)}. A GMV cut can be positive while the merchant's profit is negative. That's the trap to avoid.`,
    "small secondary mt",
  );
}

function nonOverlappingCount(events) {
  const by = {};
  for (const e of events) (by[`${e.league}-${e.season}-${e.abbr}`] ||= []).push(e.day0);
  let n = 0;
  for (const k in by) {
    const ds = by[k].sort();
    let last = null;
    for (const d of ds)
      if (!last || (dayMs(d) - dayMs(last)) / 864e5 >= H) {
        n++;
        last = d;
      }
  }
  return n;
}

export function renderLeagues(root) {
  root.replaceChildren();
  const SC = S.v2.scenarios,
    LS = S.v2.leagues;
  root.appendChild(h("h1", null, "Leagues: where is the signal strongest?"));
  para(
    root,
    "Same pipeline, same filters, same pre-registered test in four sports. Left half: does the market's move predict demand at all (v1-style signal tests)? Right half: does it make the merchant money (v2)?",
    "lede",
  );
  const rows = LEAGUES.map((L) => ({
    L,
    s: LS[L],
    v: SC.by_league[L],
    a: aggregate(evs().filter((e) => e.league === L)),
  })).filter((r) => r.s);
  const c = card(root, "Signal strength vs money made");
  table(
    c,
    [
      { label: "League", get: (r) => r.L },
      {
        label: "Moves → kept",
        num: true,
        get: (r) => `${r.s.funnel?.candidates ?? "–"} → ${r.s.funnel?.passed ?? "–"}`,
      },
      { label: "Kept with demand data", num: true, get: (r) => r.s.n_es ?? "–" },
      {
        label: "Size → demand t",
        num: true,
        get: (r) => (r.s.slope_kept_t == null ? "–" : fmt.signed(r.s.slope_kept_t, 1)),
      },
      { label: "Rejected t", num: true, get: (r) => (r.s.slope_rej_t == null ? "–" : fmt.signed(r.s.slope_rej_t, 1)) },
      { label: "Direction p", num: true, get: (r) => (r.s.dir_p == null ? "–" : fmt.p(r.s.dir_p)) },
      { label: "Smart captured", num: true, get: (r) => (r.a ? signedPct(r.a.m.m1.captured) : "–") },
      { label: "Tipoff captured", num: true, get: (r) => (r.a ? signedPct(r.a.m.m3.captured) : "–") },
      {
        label: "Tipoff − smart (p)",
        num: true,
        get: (r) =>
          !r.v
            ? "–"
            : r.v.n < 20
              ? `too few events (${r.v.n})`
              : `${signedPct(r.v.captured.m3 - r.v.captured.m1)} (${fmt.p(r.v.bootstrap.m3_minus_m1.p)})`,
      },
    ],
    rows,
  );
  para(
    c,
    '"Size → demand t": does a bigger kept odds move predict bigger abnormal merch demand over days 2–14 (vs other teams)? Rejected t should be ~0. Direction p: permutation test that demand follows the odds\' direction. Captured columns use default economics.',
    "tiny muted mt",
  );
  const leaky = rows.filter((r) => r.s.slope_rej_t != null && r.s.slope_rej_t > 2).map((r) => r.L);
  if (leaky.length)
    para(
      c,
      `Caveat: in ${leaky.join(" and ")} the REJECTED moves still predict demand. Those markets are thinner, so the "too few trades" and single-wallet gates (tuned on the NBA) throw out some real game moves. The denoising thresholds should scale with each market's liquidity. That's a phase-2 fix, not applied here, so as not to tune on results.`,
      "small secondary mt",
    );
  const RB = SC.robustness_by_league || {};
  if (Object.keys(RB).length) {
    const rc = card(
      root,
      "Is a league's result robust? Tipoff minus smart merchant, under every pre-registered variant",
      "positive = Tipoff captured more of the opportunity",
    );
    rc.classList.add("mt");
    const vars = Object.keys(RB);
    table(
      rc,
      [
        { label: "League", get: (L) => L + ((SC.by_league[L]?.n ?? 0) < 20 ? " (too few events)" : "") },
        ...vars.map((k) => ({
          label: k.replace(/_/g, " ").replace("cr ", "crit. ratio "),
          num: true,
          get: (L) => (RB[k][L] ? signedPct(RB[k][L].m3 - RB[k][L].m1) : "–"),
        })),
      ],
      LEAGUES.filter((L) => RB.default?.[L]),
    );
    para(
      rc,
      'A league earns a "works there" verdict only if Tipoff beats gut feel in every column. Per-league results were reported but not pre-registered as hypotheses, so a league that passes is a strong lead to confirm out of sample (e.g. on the live season), not a final proof.',
      "tiny muted mt",
    );
  }
  const g = h("div", "grid2 mt");
  root.appendChild(g);
  for (const r of rows) {
    if (!r.a || r.a.n < 20) continue;
    const cc = card(g, `${r.L}: share captured by what happened`);
    const d = h("div");
    cc.appendChild(d);
    const out = [];
    for (const cat of Object.keys(CAT_LABEL)) {
      const a = aggregate(evs().filter((e) => e.league === r.L && e.cat === cat));
      const SHORT = { good: "Good news", bad: "Bad news", eliminated: "Eliminated", title: "Won the title" };
      if (a)
        out.push({
          label: `${SHORT[cat]} (${a.n})`,
          value: a.m.m3.captured,
          title: `smart ${signedPct(a.m.m1.captured)}`,
        });
    }
    divBars(d, out, { min: -0.5, max: 1 });
    para(cc, "Tipoff's share of the opportunity per category (hover a row for the smart merchant's).", "tiny muted mt");
  }
}

export function renderMethod(root) {
  root.replaceChildren();
  const SC = S.v2.scenarios,
    PR = S.v2.prereg;
  root.appendChild(h("h1", null, "Method & integrity"));
  para(root, "Everything that could make these numbers look better than reality, and what we did about it.", "lede");
  const g = h("div", "grid2");
  root.appendChild(g);
  const c1 = card(g, "1 · Pre-registered before any v2 result");
  c1.appendChild(
    h(
      "p",
      "small",
      "The full design was written to pipeline/prereg_v2.json and hashed before the three-merchant engine ran on any data. The engine reads the file and prints its hash into every result.",
    ),
  );
  c1.appendChild(h("div", "hash", "sha256 " + SC.prereg_sha256));
  const dl = h("dl", "prereg");
  const add = (k, v) => {
    dl.appendChild(h("dt", null, k));
    dl.appendChild(h("dd", null, v));
  };
  add("Events", PR.event_set.include + "; " + PR.event_set.data_requirement);
  add("Decision", PR.decision.commitment + ". " + PR.decision.why_a_commitment + ".");
  add("Demand", PR.demand.proxy);
  for (const [k, v] of Object.entries(PR.merchants)) add(k.replace(/_/g, " "), v);
  add("Training", PR.training.primary);
  add("Primary metric", PR.metrics.primary);
  add("Inference", PR.inference.bootstrap);
  c1.appendChild(dl);
  const c2 = card(g, "2 · Amendments (logged, both results shown)");
  for (const am of SC.amendments?.amendments || []) {
    c2.appendChild(h("h4", null, `${am.id} · ${am.made}`));
    c2.appendChild(h("p", "small", "Why: " + am.trigger));
    c2.appendChild(h("p", "small", "Change: " + am.change));
    c2.appendChild(h("p", "small muted", "Unchanged: " + am.not_changed));
  }
  if (SC.original_spec) {
    const o = SC.original_spec.captured,
      n = SC.primary.captured;
    table(
      c2,
      [
        { label: "Merchant", get: (r) => r.n },
        { label: "Original spec", num: true, get: (r) => signedPct(o[r.id]) },
        { label: "Amended (reported)", num: true, get: (r) => signedPct(n[r.id]) },
      ],
      MERCH.filter((m) => m.id !== "m0" && m.id !== "m4").map((m) => ({ n: m.name, id: m.id })),
    );
  }
  const c3 = card(g, "3 · Inference checks");
  const b = SC.primary.bootstrap;
  const rows = [
    [
      "Tipoff − smart merchant (90% CI, cluster bootstrap)",
      `${signedPct(SC.primary.captured.m3 - SC.primary.captured.m1)} [${signedPct(b.m3_minus_m1.lo)}, ${signedPct(b.m3_minus_m1.hi)}] · p = ${fmt.p(b.m3_minus_m1.p)}`,
    ],
    [
      "Tipoff − pro with history (strict)",
      `${signedPct(SC.primary.captured.m3 - SC.primary.captured.m2)} [${signedPct(b.m3_minus_m2.lo)}, ${signedPct(b.m3_minus_m2.hi)}] · p = ${fmt.p(b.m3_minus_m2.p)}`,
    ],
  ];
  if (SC.placebo)
    rows.push([
      "Placebo (odds sizes shuffled within class)",
      `real ${signedPct(SC.placebo.actual)} vs shuffled mean ${signedPct(SC.placebo.mean)} · p = ${fmt.p(SC.placebo.p)} (${SC.placebo.n} runs)`,
    ]);
  if (SC.noise)
    rows.push([
      "Acting on REJECTED moves (noise) with Tipoff's sizing",
      `${fmt.money(SC.noise.m3_minus_m0_per_event * 20)} per event vs business as usual (20 units/day); worse on ${fmt.pct(SC.noise.m3_worse_share)} of ${SC.noise.n} moves`,
    ]);
  for (const [k, v] of Object.entries(SC.robustness || {}))
    rows.push([
      `Robustness: ${k.replace(/_/g, " ")}`,
      `smart ${signedPct(v.m1)} · pro ${signedPct(v.m2)} · Tipoff ${signedPct(v.m3)}`,
    ]);
  table(
    c3,
    [
      { label: "Check", get: (r) => r[0] },
      { label: "Result", get: (r) => r[1] },
    ],
    rows,
  );
  const c4 = card(g, "4 · Data coverage & lineage");
  table(
    c4,
    [
      { label: "League", get: (r) => r[0] },
      {
        label: "Coverage",
        get: (r) =>
          typeof r[1] === "string"
            ? r[1]
            : `${r[1].kept_signals} kept signals → ${r[1].events_with_demand} with usable demand (${r[1].teams} teams); ${r[1].rejected_with_demand} rejected moves scored as noise`,
      },
    ],
    Object.entries(SC.coverage),
  );
  para(
    c4,
    "Odds: Polymarket CLOB hourly prices (title markets), Kalshi hourly candles where listed. Games: ESPN scoreboards. Demand: Google Trends daily merch-search composites per team (regular-season pull stitched for resolution). Attention control: Wikipedia pageviews.",
    "tiny muted mt",
  );
  const ex = SC.exploratory || {};
  if (Object.keys(ex).length) {
    const c6 = card(
      root,
      "6 · Exploratory: not pre-registered, never used for a headline",
      "added after seeing the primary result, to understand it",
    );
    c6.classList.add("mt");
    const er = [];
    for (const k of ["good", "bad"]) {
      const x = ex[`spearman_absdlogit_vs_demand_${k}`];
      if (x)
        er.push([
          `Within ${k}-news events: does a bigger odds move mean bigger 14-day demand? (rank correlation)`,
          `ρ = ${fmt.signed(x.rho, 2)} (p = ${fmt.p(x.p)}, n = ${x.n})`,
        ]);
    }
    if (ex.in_sample_r2_class != null)
      er.push([
        "In-sample ceiling: share of demand variation explained by the event class → class + the market's number",
        `${fmt.pct(ex.in_sample_r2_class)} → ${fmt.pct(ex.in_sample_r2_class_plus_odds)}`,
      ]);
    const tq = ex.top_quartile_shocks;
    if (tq)
      er.push([
        `Biggest repricings only (top quarter of odds moves, n = ${tq.n}): share of opportunity captured`,
        `smart ${signedPct(tq.m1)} · pro ${signedPct(tq.m2)} · Tipoff ${signedPct(tq.m3)}`,
      ]);
    table(
      c6,
      [
        { label: "Question", get: (r) => r[0] },
        { label: "Answer", get: (r) => r[1] },
      ],
      er,
    );
  }
  const c5 = card(root, "5 · Limits: what would change our mind");
  c5.classList.add("mt");
  const ul = h("ul", "prose small");
  for (const t of [
    "Search interest is not sales. Google's daily sampling noise makes demand look more erratic than real orders, which punishes every forecaster (and inflates the hindsight ceiling). Real Shopify order data could move every number here, up or down. This is the #1 next step.",
    "Latency is set to zero by design. With real lead times the value shifts toward merchants who must commit early; see the v1 latency sim.",
    "Overlapping windows: in playoffs a team can fire signals every two days; each event is scored as if it were the only decision. Inference is clustered by team-season to account for that.",
    "Only teams with dense enough search data are scored (≥60% non-zero days), which skews toward big-market teams.",
    "Two seasons per league; forecasts trained on one season and tested on the other. Season-to-season drift (e.g. a different champion profile) is a real risk the test includes rather than hides.",
  ])
    ul.appendChild(h("li", null, t));
  c5.appendChild(ul);
}
