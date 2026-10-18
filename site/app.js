import { lineChart, scatter, hbars, legend, fmt, h } from "./charts.js";
import { renderCases } from "./cases.js";
import { renderMerchant } from "./sim.js";
import { renderStrategy } from "./strategy.js";
import { renderAnswer, renderReplay, renderEvents, renderLeagues, renderMethod } from "./v2.js";

export const C = {
  s1: "var(--series-1)",
  s2: "var(--series-2)",
  s3: "var(--series-3)",
  s4: "var(--series-4)",
  muted: "var(--muted-series)",
};
export const S = {
  league: null,
  meta: null,
  signals: [],
  daily: {},
  merchant: null,
  research: null,
  v2: null,
  oddsCache: new Map(),
  leagueCache: {},
};
export const LEAGUES = ["NBA", "NHL", "NFL", "MLB"];
export const UI = {
  league: "NBA",
  season: "2025-26",
  team: "NYK",
  demand: "merch",
  showKx: true,
  showPo: false,
  showRejected: true,
  sel: null,
  doseMetric: "merch",
  doseWin: "car_2_14",
  evCol: "merch",
};

export const dayMs = (s) => {
  const [y, m, d] = s.split("-").map(Number);
  return Date.UTC(y, m - 1, d, 12);
};
export const addDays = (s, n) => new Date(dayMs(s) + n * 864e5).toISOString().slice(0, 10);
const j = async (u) => {
  const r = await fetch(u);
  if (!r.ok) throw new Error(u + " " + r.status);
  return r.json();
};
export const teamName = (a) => S.meta.teams[a]?.name || a;
const CLASS_MEANING = {
  title_clinch:
    "Won it all. The spike lasts about 72 hours and is pre-printed by Fanatics; sell through, don't reorder at spike rates.",
  series_clinch: "Team advanced. More home games, a new round's merch, and a step up in demand.",
  playoff_win: "Win with the series still alive. Demand builds; keep leaning in.",
  playoff_loss: "Loss with the series still alive. Usually not bearish for demand. Hold.",
  elimination: "Season over. Demand collapses within days. Unwind exposure now.",
  rival_game: "A rival's result moved our odds. Fans don't buy because a rival lost; prepare, don't stock.",
  news: "Off-court news (trade, injury, injury report). Direction and size vary, so it needs a human-readable cause.",
  regular_win: "Regular-season result. Rarely moves title odds enough to matter.",
  regular_loss: "Regular-season result. Rarely moves title odds enough to matter.",
};
export const CLASS_LABEL = {
  title_clinch: "Title clinch",
  series_clinch: "Series clinch",
  elimination: "Elimination",
  playoff_win: "Playoff win",
  playoff_loss: "Playoff loss",
  regular_win: "Regular-season win",
  regular_loss: "Regular-season loss",
  rival_game: "Rival's game",
  news: "Off-court news",
  playin_win: "Play-in win",
  playin_loss: "Play-in loss",
};

export async function leagueData(L) {
  if (!S.leagueCache[L]) {
    const [meta, signals, daily] = await Promise.all([
      j(`data/${L}/meta.json`),
      j(`data/${L}/signals.json`),
      j(`data/${L}/daily.json`),
    ]);
    S.leagueCache[L] = { meta, signals, daily };
  }
  return S.leagueCache[L];
}
export async function useLeague(L) {
  if (S.league === L) return;
  Object.assign(S, await leagueData(L), { league: L });
}
export function champion(season) {
  const t = S.signals.find((s) => s.season === season && s.cls === "title_clinch");
  return t ? t.abbr : null;
}
export function leagueCtl(onChange) {
  return selectCtl(
    "League",
    LEAGUES.map((L) => [L, L]),
    UI.league,
    async (v) => {
      UI.league = v;
      await useLeague(v);
      const seasons = Object.keys(S.meta.seasons);
      UI.season = seasons[seasons.length - 1];
      const counts = {};
      for (const s of S.signals) if (s.season === UI.season && s.passed) counts[s.abbr] = (counts[s.abbr] || 0) + 1;
      UI.team =
        champion(UI.season) ||
        Object.entries(counts).sort((x, y) => y[1] - x[1])[0]?.[0] ||
        Object.keys(S.meta.teams)[0];
      UI.sel = null;
      onChange();
    },
  );
}

export async function getOdds(season, abbr) {
  const key = S.league + "_" + season + "_" + abbr;
  if (S.oddsCache.has(key)) return S.oddsCache.get(key);
  const o = await j(`data/${S.league}/odds/${season}_${abbr}.json`);
  const mk = (t0, arr, step = 7200) => arr.map((v, i) => [(t0 + i * step) * 1000, v]);
  const res = { pm: mk(o.t0, o.pm), kx: o.kx_t0 ? mk(o.kx_t0, o.kx) : [], po: o.po_t0 ? mk(o.po_t0, o.po) : [] };
  S.oddsCache.set(key, res);
  return res;
}

export function dailySeries(season, abbr, col) {
  const d = S.daily[season + "_" + abbr];
  if (!d) return [];
  return d[col].map((v, i) => [dayMs(addDays(d.d0, i)), v]);
}

const nba = (fn) => async (root) => {
  await useLeague("NBA");
  return fn(root);
};
const inLeague = (fn) => async (root) => {
  await useLeague(UI.league);
  return fn(root);
};
const views = {
  answer: renderAnswer,
  replay: renderReplay,
  events: renderEvents,
  leagues: renderLeagues,
  method: renderMethod,
  backtest: inLeague(renderBacktest),
  denoise: inLeague(renderDenoise),
  evidence: inLeague(renderEvidence),
  cases: nba(renderCases),
  merchant: nba(renderMerchant),
  strategy: nba(renderStrategy),
};
let routing = 0;
async function route() {
  const v = (location.hash || "#answer").slice(1).split("/")[0];
  const name = views[v] ? v : "answer";
  document.querySelectorAll("section.view").forEach((s) => s.classList.toggle("active", s.id === "view-" + name));
  document.querySelectorAll("nav a[data-view]").forEach((a) => a.classList.toggle("active", a.dataset.view === name));
  const my = ++routing;
  const el = document.getElementById("view-" + name);
  try {
    await views[name](el);
  } catch (e) {
    if (my === routing) {
      el.replaceChildren(h("div", "callout warn", "This view failed to render: " + e.message));
      console.error(e);
    }
  }
}
let rz;
window.addEventListener("resize", () => {
  clearTimeout(rz);
  rz = setTimeout(() => {
    route();
  }, 250);
});
document.getElementById("themeBtn").addEventListener("click", () => {
  const root = document.documentElement;
  const dark = root.dataset.theme ? root.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
  root.dataset.theme = dark ? "light" : "dark";
  try {
    localStorage.setItem("tipoff-theme", root.dataset.theme);
  } catch (e) {
    /* storage unavailable */
  }
});
try {
  const t = localStorage.getItem("tipoff-theme");
  if (t) document.documentElement.dataset.theme = t;
} catch (e) {
  /* ignore */
}

export function card(parent, title, note) {
  const c = h("div", "card");
  if (title) {
    const t = h("div", "chart-title");
    t.appendChild(h("h3", null, title));
    if (note) t.appendChild(h("span", "note", note));
    c.appendChild(t);
  }
  parent.appendChild(c);
  return c;
}
export function para(parent, text, cls) {
  const p = h("p", cls, text);
  parent.appendChild(p);
  return p;
}
export function richPara(parent, parts, cls) {
  const p = h("p", cls);
  for (const x of parts) {
    if (typeof x === "string") p.appendChild(document.createTextNode(x));
    else if (x.b) p.appendChild(h("strong", null, x.b));
    else if (x.a) {
      const a = h("a", null, x.a);
      a.href = x.href;
      a.target = "_blank";
      a.rel = "noopener";
      p.appendChild(a);
    }
  }
  parent.appendChild(p);
  return p;
}
export function statusPill(kind, text) {
  return h("span", "status " + kind, text);
}
export function table(parent, cols, rows, opts = {}) {
  const wrap = h("div", "table-wrap");
  if (opts.maxHeight) {
    wrap.style.maxHeight = opts.maxHeight;
    wrap.style.overflowY = "auto";
  }
  const t = h("table");
  const thead = h("thead");
  const tr = h("tr");
  for (const c of cols) {
    const th = h("th", c.num ? "num" : "", c.label);
    tr.appendChild(th);
  }
  thead.appendChild(tr);
  t.appendChild(thead);
  const tb = h("tbody");
  for (const r of rows) {
    const row = h("tr", r._cls || "");
    for (const c of cols) {
      const td = h("td", c.num ? "num" : "");
      const v = c.get(r);
      if (v instanceof Node) td.appendChild(v);
      else td.textContent = v ?? "–";
      row.appendChild(td);
    }
    if (opts.onClick) {
      row.classList.add("clickable");
      row.tabIndex = 0;
      row.addEventListener("click", () => opts.onClick(r));
      row.addEventListener("keydown", (e) => {
        if (e.key === "Enter") opts.onClick(r);
      });
    }
    tb.appendChild(row);
  }
  t.appendChild(tb);
  wrap.appendChild(t);
  parent.appendChild(wrap);
  return t;
}
function tile(parent, label, value, sub) {
  const c = h("div", "card tile");
  c.appendChild(h("div", "label", label));
  c.appendChild(h("div", "value", value));
  if (sub) c.appendChild(h("div", "sub", sub));
  parent.appendChild(c);
}

function filterRow(parent, controls) {
  const f = h("div", "filters");
  for (const c of controls) f.appendChild(c);
  parent.appendChild(f);
  return f;
}
export function selectCtl(label, options, value, onChange) {
  const l = h("label", null, label);
  const s = h("select");
  for (const [v, t] of options) {
    const o = h("option", null, t);
    o.value = v;
    if (v === value) o.selected = true;
    s.appendChild(o);
  }
  s.addEventListener("change", () => onChange(s.value));
  l.appendChild(s);
  return l;
}
function checkCtl(label, value, onChange) {
  const l = h("label", "check");
  const i = h("input");
  i.type = "checkbox";
  i.checked = value;
  i.addEventListener("change", () => onChange(i.checked));
  l.appendChild(i);
  l.appendChild(document.createTextNode(label));
  return l;
}

function signalTip(s) {
  return [
    `${s.emit} ET · ${teamName(s.abbr)}`,
    [
      { value: `${fmt.pct(s.p0, 1)} → ${fmt.pct(s.p1, 1)}`, label: `title odds (${fmt.pp(s.move)})` },
      { value: s.cls_label, label: s.passed ? "kept" : "rejected: " + s.reject },
      { value: s.cause.length > 70 ? s.cause.slice(0, 68) + "…" : s.cause, label: "" },
    ],
  ];
}

async function renderBacktest(root) {
  root.replaceChildren();
  if (S.league !== "NBA" && UI.demand !== "merch") UI.demand = "merch";
  root.appendChild(h("h1", null, `Signal backtester · ${S.league}`));
  para(
    root,
    "Hourly title odds (Polymarket, with Kalshi as an independent check), every move the detector flagged, and the demand series it's meant to lead, on one time axis. Click a marker or a table row to open its insight card: the cause, the quality checks, the merchant playbook, and what actually happened next.",
    "lede",
  );
  const teams = Object.keys(S.meta.teams).sort((a, b) => teamName(a).localeCompare(teamName(b)));
  const body = h("div");
  const rerender = () => draw();
  if (!S.meta.seasons[UI.season]) UI.season = Object.keys(S.meta.seasons).slice(-1)[0];
  if (UI.team !== "ALL" && !S.meta.teams[UI.team]) UI.team = champion(UI.season) || Object.keys(S.meta.teams)[0];
  filterRow(root, [
    leagueCtl(() => renderBacktest(root)),
    selectCtl(
      "Season",
      Object.keys(S.meta.seasons).map((s) => [s, champion(s) ? `${s} (${champion(s)} champion)` : s]),
      UI.season,
      (v) => {
        UI.season = v;
        UI.sel = null;
        rerender();
      },
    ),
    selectCtl("Team", [["ALL", "All teams (table)"], ...teams.map((a) => [a, teamName(a)])], UI.team, (v) => {
      UI.team = v;
      UI.sel = null;
      rerender();
    }),
    selectCtl(
      "Demand series",
      [
        ["merch", "Merch searches (national)"],
        ...(S.league === "NBA"
          ? [
              ["tickets", "Ticket searches (local, playoffs)"],
              ["watch", "Watch party / sports bar (local, playoffs)"],
              ["hotel", "City hotel searches (playoffs)"],
            ]
          : []),
      ],
      UI.demand,
      (v) => {
        UI.demand = v;
        rerender();
      },
    ),
    checkCtl("Kalshi", UI.showKx, (v) => {
      UI.showKx = v;
      rerender();
    }),
    ...(S.league === "NBA"
      ? [
          checkCtl("Make-playoffs market", UI.showPo, (v) => {
            UI.showPo = v;
            rerender();
          }),
        ]
      : []),
    checkCtl("Show rejected moves", UI.showRejected, (v) => {
      UI.showRejected = v;
      rerender();
    }),
  ]);
  root.appendChild(body);

  async function draw() {
    body.style.opacity = 0.6;
    const season = UI.season,
      team = UI.team;
    const cfg = S.meta.seasons[season];
    const x0 = dayMs(cfg.analysis_start),
      x1 = dayMs(cfg.analysis_end);
    const sigs = S.signals.filter(
      (s) => s.season === season && (team === "ALL" || s.abbr === team) && (UI.showRejected || s.passed),
    );
    const frag = h("div");
    body.replaceChildren(frag); // attach first so charts can measure their width
    if (team !== "ALL") {
      const o = await getOdds(season, team);
      const c1 = card(
        frag,
        `${teamName(team)} · probability of winning the title`,
        "hover for values; markers = detected moves",
      );
      const series = [{ label: "Polymarket title odds", color: C.s1, points: o.pm }];
      if (UI.showKx && o.kx.length) series.push({ label: "Kalshi title odds", color: C.s2, points: o.kx, width: 1.5 });
      if (UI.showPo && o.po.length)
        series.push({ label: "Polymarket: make playoffs", color: C.s3, points: o.po, width: 1.5 });
      const chart1 = h("div");
      c1.appendChild(chart1);
      lineChart(chart1, {
        height: 280,
        x: { domain: [x0, x1] },
        y: { format: (v) => fmt.pct(v), tipFormat: (v) => fmt.pct(v, 1) },
        series,
        xTip: (t) => fmt.datetime(t),
        markers: sigs.map((s) => ({
          x: s.emit_ts * 1000,
          y: s.p1,
          shape: s.passed ? (s.dir > 0 ? "up" : "down") : "ring",
          muted: !s.passed,
          selected: UI.sel === s.sid,
          tip: signalTip(s),
          aria: `${s.cls_label} ${s.emit}`,
          onClick: () => select(s),
        })),
        extraLegend: [
          { label: "Kept signal (up)", kind: "tri-up" },
          { label: "Kept signal (down)", kind: "tri-down" },
          ...(UI.showRejected ? [{ label: "Rejected move", kind: "ring" }] : []),
        ],
      });
      const g2 = h("div", "grid2 mt");
      frag.appendChild(g2);
      const selSig = S.signals.find((s) => s.sid === UI.sel);
      const rules = selSig ? [{ x: dayMs(selSig.day0), label: "signal day 0", strong: true }] : [];
      const dLabel = {
        merch: "Merch search interest (Google Trends, national)",
        tickets: `"${S.meta.teams[team].nick} tickets" searches in the team's metro`,
        watch: `"watch party / sports bar" searches in the team's metro`,
        hotel: `"${S.meta.teams[team].city} hotel(s)" searches, national`,
      }[UI.demand];
      const c2 = card(g2, dLabel, "daily, 0–100 index (Google normalised)");
      const dch = h("div");
      c2.appendChild(dch);
      const dpts = dailySeries(season, team, UI.demand);
      if (dpts.some((p) => p[1] != null))
        lineChart(dch, {
          height: 200,
          x: { domain: [x0, x1] },
          y: { format: (v) => fmt.num(v) },
          series: [{ label: "index", color: C.s1, points: dpts, area: true }],
          rules,
        });
      else
        dch.appendChild(
          h(
            "div",
            "empty",
            "No data for this team/series (local series were only pulled for playoff teams, Mar 20 onward, or the fetch is still running).",
          ),
        );
      const c3 = card(g2, "Attention: Wikipedia pageviews of the team article", "daily views (control series)");
      const wch = h("div");
      c3.appendChild(wch);
      lineChart(wch, {
        height: 200,
        x: { domain: [x0, x1] },
        y: { format: (v) => (v >= 1000 ? fmt.num(v / 1000) + "k" : fmt.num(v)) },
        series: [{ label: "views", color: C.s1, points: dailySeries(season, team, "wiki"), area: true }],
        rules,
      });
    }
    const g3 = h("div", "grid2 mt");
    frag.appendChild(g3);
    const tc = card(
      g3,
      team === "ALL" ? `All detected moves · ${season}` : `Detected moves · ${teamName(team)}`,
      `${sigs.filter((s) => s.passed).length} kept / ${sigs.length} shown`,
    );
    const sorted = [...sigs].sort((a, b) =>
      team === "ALL" ? Math.abs(b.move) - Math.abs(a.move) : a.emit_ts - b.emit_ts,
    );
    table(
      tc,
      [
        { label: "Emitted (ET)", get: (s) => s.emit.slice(0, 10) + " " + s.emit.slice(11) },
        ...(team === "ALL" ? [{ label: "Team", get: (s) => s.abbr }] : []),
        { label: "Class", get: (s) => s.cls_label },
        { label: "Odds", num: true, get: (s) => `${fmt.pct(s.p0, 1)}→${fmt.pct(s.p1, 1)}` },
        { label: "Move", num: true, get: (s) => fmt.pp(s.move) },
        { label: "Status", get: (s) => statusPill(s.passed ? "good" : "bad", s.passed ? "kept" : "rejected") },
      ],
      sorted.map((s) => ({ ...s, _cls: (s.sid === UI.sel ? "selected " : "") + (s.passed ? "" : "rejected") })),
      { onClick: (s) => select(s), maxHeight: "560px" },
    );
    const ic = card(g3, null);
    ic.classList.add("insight");
    const selSig = S.signals.find((s) => s.sid === UI.sel);
    if (selSig) insightCard(ic, selSig);
    else ic.appendChild(h("div", "empty", "Select a move (marker or row) to see its insight card."));
    body.style.opacity = 1;
  }
  function select(s) {
    UI.sel = s.sid;
    if (UI.team !== "ALL" && UI.team !== s.abbr) UI.team = s.abbr;
    if (UI.team === "ALL") {
      UI.team = s.abbr;
    }
    root.querySelectorAll("select")[2].value = UI.team;
    draw();
  }
  await draw();
}

export function insightCard(c, s) {
  c.replaceChildren();
  const head = h("div", "head");
  const left = h("div");
  left.appendChild(
    h("div", "small muted", `${teamName(s.abbr)} · emitted ${s.emit} ET · move began ${s.onset.slice(5)} ET`),
  );
  left.appendChild(h("div", "move", `${fmt.pct(s.p0, 1)} → ${fmt.pct(s.p1, 1)}`));
  left.appendChild(h("div", "secondary small", `title odds ${fmt.pp(s.move)} (${fmt.signed(s.dlogit, 2)} log-odds)`));
  head.appendChild(left);
  const right = h("div", "row");
  right.appendChild(statusPill(s.passed ? "good" : "bad", s.passed ? "Signal kept" : "Rejected as noise"));
  right.appendChild(statusPill("na", s.cls_label));
  head.appendChild(right);
  c.appendChild(head);
  const cause = h("p", "mt");
  cause.appendChild(h("strong", null, "What happened: "));
  cause.appendChild(document.createTextNode(s.cause));
  c.appendChild(cause);
  if (s.news_detail) {
    const nd = h("p", "small secondary", s.news_detail + " ");
    if (s.news_src) {
      const a = h("a", null, "source");
      a.href = s.news_src;
      a.target = "_blank";
      a.rel = "noopener";
      nd.appendChild(a);
    }
    if (s.news_conf) nd.appendChild(document.createTextNode(` · label confidence: ${s.news_conf}`));
    c.appendChild(nd);
  }
  if (!s.passed && s.reject) c.appendChild(h("p", "small", "Rejected because: " + s.reject + "."));
  const checks = h("div", "checks");
  for (const k of s.checks) {
    const it = h("div", "check-item");
    const ic = h(
      "span",
      "icon " + (k.ok === true ? "ok" : k.ok === false ? "no" : "na"),
      k.ok === true ? "✓" : k.ok === false ? "✕" : "–",
    );
    it.appendChild(ic);
    const tx = h("div");
    tx.appendChild(h("div", null, k.k));
    tx.appendChild(h("div", "tiny muted", k.v));
    it.appendChild(tx);
    checks.appendChild(it);
  }
  c.appendChild(checks);
  const pb = h("div", "playbook");
  const st = h("div", "row");
  st.appendChild(h("span", "stance", "Playbook: " + s.playbook.stance));
  st.appendChild(h("span", "tiny muted", "(what each merchant type should do, given its lead time)"));
  pb.appendChild(st);
  for (const [who, what] of s.playbook.actions) {
    const r = h("div", "pb-row");
    r.appendChild(h("div", "pb-who", who));
    r.appendChild(h("div", null, what));
    pb.appendChild(r);
  }
  c.appendChild(pb);
  if (s.merch || s.wiki) {
    const t = h("div", "chart-title mt");
    t.appendChild(h("h4", null, "What happened next (ex post, not known at signal time)"));
    t.appendChild(h("span", "note", "abnormal demand vs other teams, days from signal"));
    c.appendChild(t);
    const ch = h("div");
    c.appendChild(ch);
    const xs = Array.from({ length: 20 }, (_, i) => i - 5);
    const series = [];
    if (s.merch) series.push({ label: "Merch searches", color: C.s1, points: xs.map((x, i) => [x, s.merch.path[i]]) });
    if (s.wiki)
      series.push({ label: "Attention (Wikipedia)", color: C.s2, points: xs.map((x, i) => [x, s.wiki.path[i]]) });
    lineChart(ch, {
      height: 170,
      x: { type: "linear", domain: [-5, 14], format: (v) => (v > 0 ? "+" : "") + v + "d" },
      y: { format: fmt.logpct, zero: false, logPct: true },
      series,
      rules: [{ x: 0, label: "day 0" }],
      xTip: (x) => `day ${x > 0 ? "+" : ""}${x}`,
      snap: 0.5,
    });
    const kv = h("div", "small secondary mt");
    const parts = [];
    if (s.merch) parts.push(`merch, days 2–14: ${fmt.logpct(s.merch.car_2_14)} vs normal`);
    if (s.wiki) parts.push(`attention, days 2–14: ${fmt.logpct(s.wiki.car_2_14)}`);
    if (s.retained_72h != null) parts.push(`odds move still ${fmt.pct(s.retained_72h)} intact 72h later`);
    kv.textContent = parts.join(" · ");
    c.appendChild(kv);
  } else {
    c.appendChild(
      h(
        "p",
        "tiny muted mt",
        "No demand outcome for this move (team's search series too sparse, or outside the demand window).",
      ),
    );
  }
}

function avgByDir(cls) {
  const out = [];
  for (const [d, sym] of [
    [1, "▲"],
    [-1, "▼"],
  ]) {
    const xs = S.signals
      .filter((s) => s.passed && s.cls === cls && s.dir === d && s.merch)
      .map((s) => s.merch.car_2_14);
    if (xs.length) out.push(`${sym} ${fmt.logpct(xs.reduce((a, b) => a + b, 0) / xs.length)} (${xs.length})`);
  }
  return out.join("  ") || "–";
}
function ols(pts) {
  const n = pts.length;
  if (n < 3) return null;
  const mx = pts.reduce((a, p) => a + p.x, 0) / n,
    my = pts.reduce((a, p) => a + p.y, 0) / n;
  let sxy = 0,
    sxx = 0;
  for (const p of pts) {
    sxy += (p.x - mx) * (p.y - my);
    sxx += (p.x - mx) ** 2;
  }
  const b = sxy / sxx;
  return { a: my - b * mx, b };
}

function renderDenoise(root) {
  root.replaceChildren();
  root.appendChild(h("h1", null, `Denoising & classification · ${S.league}`));
  filterRow(root, [leagueCtl(() => renderDenoise(root))]);
  para(
    root,
    `${fmt.pct((S.meta.funnel.candidates - S.meta.funnel.passed) / S.meta.funnel.candidates)} of title-odds moves big enough to matter are not events: a single wallet pushing a thin book, a print that reverts, or Polymarket drifting while Kalshi doesn't move. The filters below use only information available when the signal fires. The proof that they work is that rejected moves carry no commerce information at all.`,
    "lede",
  );
  const f = S.meta.funnel;
  const g = h("div", "grid2");
  root.appendChild(g);
  const c1 = card(g, "Filter funnel", "all teams, both seasons");
  const fb = h("div");
  c1.appendChild(fb);
  hbars(fb, [
    {
      label: "Candidate moves (≥3pp & ≥0.2 log-odds in 24h, team ≥2%)",
      value: f.candidates,
      display: String(f.candidates),
    },
    { label: "…still ≥50% intact after 6h", value: f.persistent, display: String(f.persistent) },
    { label: "…and Kalshi agrees (where listed)", value: f.kalshi_ok, display: String(f.kalshi_ok) },
    { label: "…and enough trades, no lone whale → kept", value: f.passed, display: String(f.passed) },
  ]);
  const c2 = card(g, "Why moves were rejected", "a move can fail several checks");
  const rb = h("div");
  c2.appendChild(rb);
  const rr = Object.entries(S.meta.reject_reasons).sort((a, b) => b[1] - a[1]);
  hbars(
    rb,
    rr.map(([k, v]) => ({
      label: k[0].toUpperCase() + k.slice(1),
      value: v,
      display: String(v),
      color: "var(--muted-series)",
    })),
  );
  para(
    c2,
    "Single-wallet = the largest wallet supplied ≥60% of the move's volume with ≤15 wallets trading, and no game was being played. Kalshi is checked only once its market exists (Jan 2025 onward for 2024-25).",
    "tiny muted mt",
  );

  const c3 = card(
    root,
    "The test that matters: does the size of the move predict demand?",
    "each dot = one move; x = log-odds change at emission",
  );
  c3.classList.add("mt");
  const ctl = h("div", "row mb");
  const seg = (opts, cur, on) => {
    const sg = h("div", "seg");
    for (const [v, t] of opts) {
      const b = h("button", v === cur ? "on" : "", t);
      b.type = "button";
      b.addEventListener("click", () => on(v));
      sg.appendChild(b);
    }
    return sg;
  };
  ctl.appendChild(
    seg(
      [
        ["merch", "Merch searches"],
        ["wiki", "Attention"],
      ],
      UI.doseMetric,
      (v) => {
        UI.doseMetric = v;
        renderDenoise(root);
      },
    ),
  );
  ctl.appendChild(
    seg(
      [
        ["car_1_7", "Days 1–7"],
        ["car_2_14", "Days 2–14"],
      ],
      UI.doseWin,
      (v) => {
        UI.doseWin = v;
        renderDenoise(root);
      },
    ),
  );
  c3.appendChild(ctl);
  const pts = (passed) =>
    S.signals
      .filter((s) => s.passed === passed && s[UI.doseMetric])
      .map((s) => ({
        x: s.dlogit,
        y: s[UI.doseMetric][UI.doseWin],
        tip: [
          `${s.abbr} · ${s.emit.slice(0, 10)}`,
          [
            { value: `${fmt.pp(s.move)} (${fmt.signed(s.dlogit, 2)} log-odds)`, label: "odds" },
            { value: fmt.logpct(s[UI.doseMetric][UI.doseWin]), label: "abnormal demand" },
            { value: s.cls_label, label: s.passed ? "kept" : "rejected" },
          ],
        ],
      }));
  const pk = pts(true),
    rj = pts(false);
  const sc = h("div");
  c3.appendChild(sc);
  const r = S.meta.results[UI.doseMetric];
  const slopeKey = UI.doseWin === "car_2_14" ? "slope_2_14" : "slope_1_7";
  scatter(sc, {
    height: 320,
    x: { label: "Title-odds move (log-odds, signed)", format: (v) => fmt.signed(v, 1) },
    y: { label: "Abnormal demand vs other teams", format: fmt.logpct, logPct: true },
    groups: [
      {
        label: `Kept (n=${pk.length}, slope t = ${fmt.signed(r.passed[slopeKey].t, 1)})`,
        color: C.s1,
        points: pk,
        fit: ols(pk),
      },
      {
        label: `Rejected (n=${rj.length}, slope t = ${fmt.signed(r.rejected[slopeKey].t, 1)})`,
        color: C.muted,
        points: rj,
        fit: ols(rj),
        dim: true,
      },
    ],
  });
  para(
    c3,
    "Kept moves line up: the bigger the odds move, the bigger the demand response in the same direction. Rejected moves scatter around zero. That's the evidence that the filter removes noise rather than signal. (t-stats use heteroskedasticity-robust errors.)",
    "small secondary mt",
  );

  const g2 = h("div", "mt");
  root.appendChild(g2);
  const c4 = card(g2, "Taxonomy: what each class means for a merchant", "kept moves; demand = merch searches");
  const bc = S.meta.results.merch.by_class;
  const order = [
    "title_clinch",
    "series_clinch",
    "playoff_win",
    "playoff_loss",
    "elimination",
    "rival_game",
    "news",
    "regular_win",
    "regular_loss",
  ];
  table(
    c4,
    [
      { label: "Class", get: (x) => CLASS_LABEL[x.k] },
      { label: "n", num: true, get: (x) => x.v.n },
      { label: "Demand moved in odds' direction", num: true, get: (x) => fmt.pct(x.v.hit_1_7) },
      { label: "Avg demand change, days 2–14", num: true, get: (x) => avgByDir(x.k) },
      { label: "Meaning", get: (x) => CLASS_MEANING[x.k] || "" },
    ],
    order.filter((k) => bc[k]).map((k) => ({ k, v: bc[k] })),
  );
  para(
    c4,
    "Demand change = abnormal merch searches vs other teams, days 2–14 after the signal, split by whether the odds moved up (▲) or down (▼). Small classes (n < 5) are anecdotes, not evidence.",
    "tiny muted mt",
  );
  const c5 = card(g2, "Noise we caught: the biggest rejected moves", "what would have fooled a naive odds-watcher");
  const rej = S.signals
    .filter((s) => !s.passed)
    .sort((a, b) => Math.abs(b.move) - Math.abs(a.move))
    .slice(0, 14);
  table(
    c5,
    [
      { label: "When (ET)", get: (s) => s.emit.slice(0, 10) },
      { label: "Team", get: (s) => s.abbr },
      { label: "Move", num: true, get: (s) => `${fmt.pct(s.p0, 1)}→${fmt.pct(s.p1, 1)}` },
      { label: "Why rejected", get: (s) => s.reject },
      { label: "72h later", num: true, get: (s) => (s.retained_72h == null ? "–" : fmt.pct(s.retained_72h) + " left") },
    ],
    rej,
    {
      onClick: (s) => {
        UI.season = s.season;
        UI.team = s.abbr;
        UI.sel = s.sid;
        location.hash = "#backtest";
      },
    },
  );
  para(
    c5,
    'Click a row to open it in the backtester. "72h later" is ex post: how much of the move survived, which shows many of these really were transient.',
    "tiny muted mt",
  );
}

function renderEvidence(root) {
  root.replaceChildren();
  const R = S.meta.results;
  root.appendChild(h("h1", null, `Signal evidence: event study and lead tests · ${S.league}`));
  filterRow(root, [leagueCtl(() => renderEvidence(root))]);
  para(
    root,
    "Day 0 is the ET calendar day the signal fired, the first day a merchant could act. Demand is measured as abnormal log demand versus the median of other active teams on the same days, relative to the team's own days −11…−2. So league-wide effects (the playoffs themselves, holidays) cancel out.",
    "lede",
  );
  const ctl = h("div", "row mb");
  const sg = h("div", "seg");
  for (const [v, t] of [
    ["merch", "Merch searches"],
    ["wiki", "Attention (Wikipedia)"],
    ["watch", "Local bars / watch parties"],
    ["tickets", "Local ticket searches"],
    ["hotel", "City hotel searches"],
  ]) {
    if (!R[v]) continue;
    const b = h("button", v === UI.evCol ? "on" : "", t);
    b.type = "button";
    b.addEventListener("click", () => {
      UI.evCol = v;
      renderEvidence(root);
    });
    sg.appendChild(b);
  }
  ctl.appendChild(sg);
  root.appendChild(ctl);
  if (["watch", "tickets", "hotel"].includes(UI.evCol))
    ctl.appendChild(
      h(
        "span",
        "small muted",
        "Local series exist only for playoff teams from Mar 20, so these use playoff-time signals only (smaller n).",
      ),
    );
  const r = R[UI.evCol];
  const xs = Array.from({ length: 20 }, (_, i) => i - 5);
  const c0 = card(
    root,
    "Which businesses respond? (the original LA example: merch, restaurants, hotels, travel)",
    "kept signals; direction-adjusted effect = demand moved the way the odds did",
  );
  const SER = [
    ["merch", "Merch searches (national)", "Online fan merch"],
    ["tickets", "Ticket searches (team metro)", "Tickets / resale"],
    ["watch", "Watch party + sports bar (team metro)", "Bars & restaurants"],
    ["hotel", "City hotel searches (national)", "Hotels / travel"],
    ["wiki", "Wikipedia views", "Attention (control)"],
  ];
  table(
    c0,
    [
      { label: "Business", get: (x) => x[2] },
      { label: "Proxy", get: (x) => x[1] },
      { label: "n", num: true, get: (x) => R[x[0]].passed.car_2_14.n },
      {
        label: "Day 0",
        num: true,
        get: (x) => `${fmt.logpct(R[x[0]].passed.d0.obs)} (p ${fmt.p(R[x[0]].passed.d0.p)})`,
      },
      {
        label: "Days 2–14",
        num: true,
        get: (x) => `${fmt.logpct(R[x[0]].passed.car_2_14.obs)} (p ${fmt.p(R[x[0]].passed.car_2_14.p)})`,
      },
      { label: "Size → response t", num: true, get: (x) => fmt.signed(R[x[0]].passed.slope_2_14.t, 1) },
      {
        label: "After elimination",
        num: true,
        get: (x) => {
          const e = R[x[0]].by_class.elimination;
          return e ? fmt.logpct(-e.mean_dir_car_2_14) : "–";
        },
      },
      {
        label: "Rival-game hit rate",
        num: true,
        get: (x) => {
          const e = R[x[0]].by_class.rival_game;
          return e ? `${fmt.pct(e.hit_1_7)} (n=${e.n})` : "–";
        },
      },
    ],
    SER.filter((x) => R[x[0]]),
  );
  para(
    c0,
    "Read: fan merch and local bar/watch-party demand follow classified odds moves on the day and over the next two weeks, and collapse after eliminations. Local ticket searches react strongly on the day. City hotel searches barely move: hotels are a weak channel (consistent with reported Finals rates, e.g. Indianapolis Game 4 only +2% vs 30 days earlier). Local series exist only from Mar 20 and only dense-data metros are included, so n is smaller. Flights weren't testable without paid fare data.",
    "small secondary mt",
  );
  const c1 = card(root, "Average path after kept signals: odds up vs odds down", "90% bootstrap band");
  c1.classList.add("mt");
  const ch = h("div");
  c1.appendChild(ch);
  const series = [];
  if (r.path_up)
    series.push({
      label: `Odds up (n=${r.path_up.n})`,
      color: C.s1,
      points: xs.map((x, i) => [x, r.path_up.mean[i]]),
      band: { lo: r.path_up.lo, hi: r.path_up.hi },
    });
  if (r.path_down)
    series.push({
      label: `Odds down (n=${r.path_down.n})`,
      color: C.s2,
      points: xs.map((x, i) => [x, r.path_down.mean[i]]),
      band: { lo: r.path_down.lo, hi: r.path_down.hi },
    });
  lineChart(ch, {
    height: 280,
    x: { type: "linear", domain: [-5, 14], format: (v) => (v > 0 ? "+" : "") + v + "d" },
    y: { format: fmt.logpct, zero: false, logPct: true },
    series,
    rules: [{ x: 0, label: "signal day 0", strong: true }],
    xTip: (x) => `day ${x > 0 ? "+" : ""}${x}`,
    snap: 0.5,
  });
  para(
    c1,
    "Both lines jump on day 0, because every game night is a demand night, win or lose. Then they separate: after up-moves demand stays elevated for two weeks; after down-moves it fades and ends below normal. The down line stays high for the first few days because it includes mid-series losses, whose teams are still playing, which is why the class matters more than the arrow. The flat days before day 0 are the no-lookahead check.",
    "small secondary mt",
  );

  const c2 = card(root, "By class: average signed path", "kept signals; demand moved in odds' direction above zero");
  c2.classList.add("mt");
  const sm = h("div", "grid3");
  c2.appendChild(sm);
  for (const k of ["series_clinch", "playoff_win", "playoff_loss", "elimination", "rival_game", "news"]) {
    const v = r.by_class[k];
    if (!v) continue;
    const cell = h("div");
    cell.appendChild(h("h4", null, `${CLASS_LABEL[k]} · n=${v.n}`));
    const pth = v.mean_path_up && v.mean_path_down ? null : v.mean_path_up || v.mean_path_down;
    const sr = [];
    if (v.mean_path_up) sr.push({ label: "odds up", color: C.s1, points: xs.map((x, i) => [x, v.mean_path_up[i]]) });
    if (v.mean_path_down)
      sr.push({ label: "odds down", color: C.s2, points: xs.map((x, i) => [x, v.mean_path_down[i]]) });
    const d = h("div");
    cell.appendChild(d);
    sm.appendChild(cell);
    requestAnimationFrame(() =>
      lineChart(d, {
        height: 150,
        leftPad: 40,
        x: { type: "linear", domain: [-5, 14], format: (x) => (x > 0 ? "+" : "") + x },
        y: { format: fmt.logpct, zero: false, logPct: true },
        series: sr,
        rules: [{ x: 0 }],
        snap: 0.5,
        xTip: (x) => `day ${x}`,
      }),
    );
    cell.appendChild(h("div", "tiny muted", `demand followed the odds ${fmt.pct(v.hit_1_7)} of the time (days 1–7)`));
  }

  const g = h("div", "grid2 mt");
  root.appendChild(g);
  const c3 = card(g, "Direction test (permutation)", "observed mean of direction × abnormal demand");
  const rows = [];
  for (const grp of ["passed", "rejected", "all"])
    for (const [mk, lab] of [
      ["pre", "days −5…−2 (pre)"],
      ["d0", "day 0"],
      ["car_1_3", "days 1–3"],
      ["car_1_7", "days 1–7"],
      ["car_2_14", "days 2–14"],
    ]) {
      const x = r[grp][mk];
      rows.push({ grp: grp === "passed" ? "kept" : grp, lab, n: x.n, obs: x.obs, p: x.p, hit: x.hit_rate });
    }
  table(
    c3,
    [
      { label: "Signals", get: (x) => x.grp },
      { label: "Window", get: (x) => x.lab },
      { label: "n", num: true, get: (x) => x.n },
      { label: "Signed effect", num: true, get: (x) => fmt.logpct(x.obs) },
      { label: "p (shuffle)", num: true, get: (x) => fmt.p(x.p) },
      { label: "Hit rate", num: true, get: (x) => fmt.pct(x.hit) },
    ],
    rows,
    { maxHeight: "420px" },
  );
  para(
    c3,
    "p = share of 5,000 shuffles of up/down labels (within season × regular/playoff strata) that produce an effect at least this large. Shuffling within strata cancels the playoff drift that both directions share.",
    "tiny muted mt",
  );

  const c4 = card(g, "Is it leading, or echoing the news?", "two out-of-sample tests");
  const br = R.beyond_reaction;
  c4.appendChild(h("h4", null, "A. Event level: demand days 2–14 after kept signals"));
  table(
    c4,
    [
      { label: "Model (all inputs known by end of day 0)", get: (x) => x.lab },
      { label: "R²", num: true, get: (x) => fmt.num(x.r2, 3) },
      { label: "Odds coef. t", num: true, get: (x) => (x.t == null ? "–" : fmt.signed(x.t, 2)) },
    ],
    [
      { lab: "Odds move only", r2: br.odds_only.r2, t: br.odds_only.t.dlogit },
      { lab: "Same-day reaction only (search + attention, days −1, 0)", r2: br.reaction_only.r2, t: null },
      { lab: "Reaction + odds move", r2: br.reaction_plus_odds.r2, t: br.reaction_plus_odds.t.dlogit },
      {
        lab: "Reaction + event class + odds move",
        r2: br.reaction_class_plus_odds.r2,
        t: br.reaction_class_plus_odds.t.dlogit,
      },
    ],
  );
  para(
    c4,
    `Leave-one-team-out error: ${fmt.num(br.loto_rmse.reaction, 3)} → ${fmt.num(br.loto_rmse.reaction_plus_odds, 3)} when the odds move is added. Read: the odds move knows something the day-0 crowd doesn't show yet, but most of it is the event class (an elimination is an elimination). That's why classification is the product.`,
    "small secondary",
  );
  c4.appendChild(h("h4", "mt", "B. Daily panel: next-7-day demand growth, every team-day"));
  const inc = R.incremental_merch;
  const prow = [];
  for (const [scope, lab] of [
    ["all_days", "All days"],
    ["playoff_days", "Playoff days"],
  ])
    for (const [k, v] of Object.entries(inc[scope].oos))
      prow.push({
        lab,
        k: k.replace("train_", "train ").replace("_test_", " → test "),
        b: v.r2_base,
        o: v.r2_odds,
        n: v.n_test,
      });
  table(
    c4,
    [
      { label: "Days", get: (x) => x.lab },
      { label: "Split", get: (x) => x.k },
      { label: "R² base", num: true, get: (x) => fmt.num(x.b, 3) },
      { label: "R² + odds", num: true, get: (x) => fmt.num(x.o, 3) },
    ],
    prow,
  );
  para(
    c4,
    `Base = demand momentum, attention, odds level, recent wins/losses/clinches/eliminations, playoff flag, date fixed effects. Odds-change coefficient (clustered by team): t = ${fmt.signed(inc.all_days.t.dlogit3, 1)} all days, ${fmt.signed(inc.playoff_days.t.dlogit3, 1)} playoff days. Daily search data is noisy, so R² is small in absolute terms; the test is whether it rises out of sample. It does in ${prow.filter((x) => x.o > x.b).length} of ${prow.length} splits.`,
    "small secondary",
  );

  const rb = S.meta.robustness || [];
  if (rb.length) {
    const c6 = card(
      root,
      "Robustness: does it depend on the detector settings?",
      "merch demand, days 2–14, kept signals",
    );
    c6.classList.add("mt");
    table(
      c6,
      [
        { label: "Move threshold", get: (x) => `≥${Math.round(x.th_abs * 100)}pp` + (x.default ? " (default)" : "") },
        { label: "Hold", num: true, get: (x) => x.hold_h + "h" },
        { label: "Candidates → kept", num: true, get: (x) => `${x.candidates} → ${x.kept}` },
        { label: "Kept: size→demand t", num: true, get: (x) => fmt.signed(x.slope_kept_t, 1) },
        {
          label: "Rejected: t",
          num: true,
          get: (x) => (x.slope_rej_t == null ? "– (too few)" : fmt.signed(x.slope_rej_t, 1)),
        },
        { label: "Direction effect", num: true, get: (x) => fmt.logpct(x.effect) },
        { label: "p (shuffle)", num: true, get: (x) => fmt.p(x.perm_p) },
        { label: "Hit rate", num: true, get: (x) => fmt.pct(x.hit) },
      ],
      rb.map((x) => ({ ...x, _cls: x.default ? "selected" : "" })),
    );
    const ts = rb.map((x) => x.slope_kept_t),
      ps = rb.map((x) => x.perm_p);
    para(
      c6,
      `Across all nine settings, kept moves' size predicts demand (t from ${fmt.num(Math.min(...ts), 1)} to ${fmt.num(Math.max(...ts), 1)}) and the direction effect is significant (p ≤ ${fmt.p(Math.max(...ps))}); rejected moves never are. The default isn't the best-looking cell; it was fixed before this grid was run.`,
      "small secondary mt",
    );
  }
  const c5 = card(root, "Methods, assumptions and caveats", "read before quoting any number");
  c5.classList.add("mt");
  const ul = h("ul", "prose small");
  for (const t of [
    "Signal: hourly Polymarket price (causal 3-hour median). Trigger when 24h change ≥3pp and ≥0.2 log-odds for a team at ≥2%. Emitted 6h later only if ≥50% of the move held. One signal per move window per team.",
    "Classification: a move is game-driven only if it began between 1h before tip and 5h after (ESPN tip times). Otherwise it's news, or a rival's game if the team that moved most the other way was playing. News causes were labeled by hand-checked web research (sources in each card).",
    "Demand is a proxy. Google Trends merch searches (jersey, shirt, hat, hoodie and merch for the team, OR'd) stand in for Shopify orders; Wikipedia views stand in for attention. Trends is sampled and normalised per query; small-market teams are often too sparse and are excluded. The real test needs merchant order data (phase 2).",
    "Wikipedia days are UTC and Trends days are roughly ET; late games straddle midnight. That's why day 0 is the day the signal fired, not the game date.",
    `Two seasons, ${S.meta.funnel.passed} kept signals, ${R.merch.passed.car_2_14.n} with dense enough merch data (series need ≥60% non-zero days; local series ≥50%) is a small sample. Class-level results with n < 5 are anecdotes. Multipliers used by the merchant simulator are trained on the other season only.`,
    "The Kalshi gate is conservative. A few rejected moves were real playoff results where Polymarket was catching up to a price Kalshi already had; on local ticket searches even those carried some signal (small n).",
    "Polymarket's NBA champion markets had heavy wash or rewards volume in long shots (e.g. about $378M 'traded' on the Kings in 2024-25). Volume was never used as a signal; only price, persistence, wallet breadth and the second venue were.",
  ])
    ul.appendChild(h("li", null, t));
  c5.appendChild(ul);
}

(async function boot() {
  try {
    const [v2, merchant, research] = await Promise.all([
      j("data/v2.json"),
      j("data/NBA/merchant.json"),
      j("data/NBA/research.json"),
    ]);
    Object.assign(S, { v2, merchant, research });
    await useLeague("NBA");
    document.getElementById("footer").textContent =
      `Sources: Polymarket CLOB & data API, Kalshi historical API, ESPN scoreboards, Wikimedia pageviews, Google Trends. Pre-registration sha256 ${v2.scenarios.prereg_sha256.slice(0, 12)}…. Local research build: not investment advice, not a product.`;
    window.addEventListener("hashchange", route);
    route();
  } catch (e) {
    document
      .querySelector("main")
      .prepend(
        h(
          "div",
          "callout warn",
          "Failed to load data: " + e.message + ". Run the pipeline (see README) and serve the site folder.",
        ),
      );
    console.error(e);
  }
})();
