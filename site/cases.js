import { lineChart, fmt, h } from "./charts.js";
import {
  S,
  C,
  card,
  para,
  richPara,
  table,
  teamName,
  dayMs,
  addDays,
  getOdds,
  dailySeries,
  insightCard,
  statusPill,
  CLASS_LABEL,
} from "./app.js";

let current = "luka";

const sig = (sid) => S.signals.find((s) => s.sid === sid);
function merchArr(season, abbr) {
  const d = S.daily[season + "_" + abbr];
  return d ? { d0: d.d0, v: d.merch } : null;
}
function idxOf(d0, day) {
  return Math.round((dayMs(day) - dayMs(d0)) / 864e5);
}
/** baseline = mean of days -14..-2; returns peak multiple, share of 0..14 excess after day 0, and decay */
export function excess(season, abbr, day0, horizon = 14) {
  const m = merchArr(season, abbr);
  if (!m) return null;
  const i = idxOf(m.d0, day0);
  const base = m.v.slice(Math.max(0, i - 14), i - 1).filter((x) => x != null);
  const b = base.reduce((a, x) => a + x, 0) / (base.length || 1);
  if (!b) return null;
  const win = m.v.slice(i, i + horizon + 1).map((x) => Math.max(0, (x ?? b) - b));
  const tot = win.reduce((a, x) => a + x, 0);
  const peak = Math.max(...m.v.slice(i - 1, i + horizon + 1).map((x) => x ?? 0));
  return {
    base: b,
    peakMult: peak / b,
    shareAfter0: tot ? (tot - win[0]) / tot : null,
    shareAfter: (L) => (tot ? win.slice(L).reduce((a, x) => a + x, 0) / tot : null),
  };
}
function pctOdds(s) {
  return s ? `${fmt.pct(s.p0, 1)} → ${fmt.pct(s.p1, 1)}` : "–";
}
function impacts(teams, from, to) {
  const ci = S.research.ground_truth_events?.commerce_impacts || [];
  return ci.filter((c) => c.teams.some((t) => teams.includes(t)) && c.date >= from && c.date <= to);
}
function events(teams, from, to) {
  const ev = S.research.ground_truth_events?.events || [];
  return ev.filter((e) => e.teams.some((t) => teams.includes(t)) && e.date >= from && e.date <= to);
}

const CASES = [
  {
    id: "luka",
    title: "The Luka trade: news at midnight, demand by breakfast",
    season: "2024-25",
    teams: ["LAL", "DAL"],
    primary: "LAL",
    window: ["2025-01-22", "2025-02-22"],
    key: "25-LAL-020213",
    tests:
      "Pure off-court news with no game being played. Does the signal fire before commerce reacts, and is anything left to capture once it fires?",
    story: (x) => {
      const s = sig("25-LAL-020213");
      const e = excess("2024-25", "LAL", s.day0);
      return [
        [
          `Shams Charania broke the Dončić-for-Davis trade at 12:16am ET on Feb 2, 2025. Polymarket repriced the Lakers' title odds within about two hours (${pctOdds(s)}, more than 3× in odds). Our detector held for 6 hours, saw Kalshi agree and ${fmt.num(s.n_wallets)} wallets on the move, and emitted at `,
          { b: s.emit + " ET" },
          ", labelled ",
          { b: "trade (high confidence)" },
          ".",
        ],
        [
          `Lakers merch searches went to about ${fmt.num(e?.peakMult, 0)}× normal on day 0 and stayed elevated for two weeks. `,
          { b: `${fmt.pct(e?.shareAfter0)} of the excess demand in days 0–14 arrived after day 0` },
          `: after a merchant could have read the signal over coffee.`,
        ],
        [
          "The signal didn't beat the news; it ",
          { b: "is" },
          ' the news, quantified at 2am. Its value is the magnitude ("a 3× change in title odds, not a rumor") and the two-week tail.',
        ],
      ];
    },
    lesson:
      "Fast merchants win here. A POD store with an unlicensed \"LA × 77\" design live by noon captures most of the tail; a licensed seller can't (Fanatics sold out of the only legal jersey). The product's job is to say how big the change is and how long the tail lasts, in plain English, before 9am.",
  },
  {
    id: "tatum",
    title: "Tatum's Achilles: a rival's injury becomes Knicks demand",
    season: "2024-25",
    teams: ["NYK", "BOS"],
    primary: "NYK",
    window: ["2025-05-01", "2025-06-01"],
    key: "25-NYK-051309",
    tests:
      'The classification problem in one game: the same "Knicks win Game 4" means something very different when the other team\'s best player is gone for the season.',
    story: () => {
      const a = sig("25-NYK-051309"),
        b = sig("25-BOS-051323"),
        c = sig("25-NYK-051708");
      const e = excess("2024-25", "NYK", c?.day0 || "2025-05-17");
      return [
        [
          `May 12, 2025, Game 4 at MSG: Jayson Tatum ruptured his Achilles late in a Knicks win. A normal Game 4 win moves a team's odds a few points. This one took the Knicks from `,
          { b: pctOdds(a) },
          ` while Boston fell `,
          { b: pctOdds(b) },
          ". The market priced the injury, not the box score.",
        ],
        [
          `The Knicks closed out Boston on May 16 (${pctOdds(c)}). Fanatics later reported Knicks product sales +80% vs the previous playoffs and Brunson the #1 jersey across all sports since May 5. NYCEDC put the value of each conference-finals home game at $91M. Our merch series peaked at about ${fmt.num(e?.peakMult, 0)}× its pre-clinch base.`,
        ],
        [
          "Our classifier labelled the first move a ",
          { b: "playoff win" },
          ". That's right, but not enough. The label a merchant needs is \"win + rival's star out for the season → the run likely gets longer\". That's the de-noising-to-meaning step from the original pitch (the Oilers example).",
        ],
      ];
    },
    lesson:
      "Size of move ÷ typical move for that class = surprise. A Game 4 win that moves odds 3× more than a normal Game 4 win is the signal; the classifier should flag it and pull the reason (injury report, live feed) into the card.",
  },
  {
    id: "pacers",
    title: "The Pacers: a small-market run the title market didn't see coming",
    season: "2024-25",
    teams: ["IND"],
    primary: "IND",
    window: ["2025-03-25", "2025-06-30"],
    key: "25-IND-051408",
    tests: "Can title odds lead a long-shot's demand ramp? (The ladder problem.)",
    story: () => {
      const run = S.merchant.runs.find((r) => r.season === "2024-25" && r.abbr === "IND");
      const first = S.signals.filter(
        (s) => s.season === "2024-25" && s.abbr === "IND" && s.passed && s.dir > 0 && s.day0 >= "2025-04-01",
      )[0];
      return [
        [
          `Indiana entered the playoffs at roughly 2–3% to win the title. That's too small for a title-odds move to clear the detector's 3-point bar until the second round (first kept up-signal: `,
          { b: first ? `${first.day0}, ${first.cls_label.toLowerCase()}` : "–" },
          "). The make-playoffs market had them at ≥90% from ",
          { b: run?.t_ladder || "early in the season" },
          ".",
        ],
        [
          "Merch demand started climbing in the first round and kept stepping up with every series win, through a 7-game Finals. Documented on the ground: local retailers \"selling out of gear in a matter of hours\", the Pacers Team Store taking ~1,000 online orders a day from 43+ states, Tom's Watch Bar sales roughly doubling on game nights, Indianapolis hotel rates +34% on home playoff nights, and Visit Indy's ~$20M impact tally.",
        ],
        [
          'For a long-shot, the title market is the wrong instrument. The demand driver is "are they still playing next week?", which is the series market.',
        ],
      ];
    },
    lesson:
      "Build the ladder: make-playoffs (season) → series winner (each round) → title (last four teams). The rung that matters is the next one to resolve. For underdogs like the Pacers, that's where both the money and the surprise are.",
  },
  {
    id: "okc",
    title: "The Thunder title: the biggest night of the year belongs to Fanatics",
    season: "2024-25",
    teams: ["OKC", "IND"],
    primary: "OKC",
    window: ["2025-05-20", "2025-07-05"],
    key: "25-OKC-062308",
    tests: "Is the single biggest demand spike (the championship) something a small merchant can act on?",
    story: () => {
      const s = sig("25-OKC-062308");
      const e = excess("2024-25", "OKC", s.day0, 10);
      return [
        [
          `Game 7, June 22, 2025: Tyrese Haliburton tore his Achilles in the first quarter. OKC went `,
          { b: pctOdds(s) },
          `. Thunder merch searches hit about ${fmt.num(e?.peakMult, 0)}× their pre-Finals base the next day, then decayed to under 2× within about 5 days.`,
        ],
        [
          "The title-night spike is pre-printed. Fanatics' printer runs \"locker-room\" gear for both finalists and ships at the buzzer, and DICK'S reopened four Oklahoma stores the night OKC clinched the West. A small merchant reacting the next morning is days late for a spike that lasts about 72 hours.",
        ],
        [
          "What was actionable: the six-week run-up (OKC was 40–90% to win throughout), local services (an OKC bar group reported business up about 50% during the Finals), and the newsvendor bet on championship designs. With the market at 75%, pre-printing a limited run is a positive-expected-value bet if salvage is decent.",
        ],
      ];
    },
    lesson:
      "Don't sell merchants the championship spike; they can't win it. Sell them the run-up and the pre-commitment decision (how many title designs to pre-print at 75% odds), which is a textbook newsvendor problem with the market as the probability input.",
  },
  {
    id: "knicks26",
    title: "Knicks 2026: odds rose while they sat idle",
    season: "2025-26",
    teams: ["NYK", "SAS"],
    primary: "NYK",
    window: ["2026-04-25", "2026-06-25"],
    key: "26-NYK-050319",
    tests: "Do rival results that raise a team's odds (with no action from the team itself) lead that team's demand?",
    story: () => {
      const r1 = sig("26-NYK-050319"),
        f1 = sig("26-NYK-060410"),
        f2 = sig("26-NYK-060610"),
        f3 = sig("26-NYK-060909");
      const bc = S.meta.results.merch.by_class.rival_game;
      return [
        [
          `May 2–3, 2026: Philadelphia eliminated Boston in Game 7 and the idle Knicks' title odds went `,
          { b: pctOdds(r1) },
          ". Clean test: Knicks fans did nothing, a rival vanished.",
        ],
        [
          `Across both seasons, kept rival-game moves were followed by the team's own merch demand moving the same way only ${fmt.pct(bc?.hit_1_7)} of the time (n=${bc?.n}). Fans don't buy because a rival lost. But future-dated inventory repriced immediately: potential Finals get-ins at MSG were already ~$2,500 by May 18.`,
        ],
        [
          "Through the Finals, the odds and the ticket market moved together. Game 1 win ",
          { b: pctOdds(f1) },
          " (MSG Game 3 get-in ~$4,200 → ~$8,200); Game 2 win ",
          { b: pctOdds(f2) },
          " (Game 3 get-in $10,085); Game 3 loss ",
          { b: pctOdds(f3) },
          " (Game 4 get-in −66% to $3,898). After the title, Fanatics logged 8,000+ orders a minute, a company record.",
        ],
      ];
    },
    lesson:
      "Segment by inventory horizon. Rival news is actionable for businesses selling future-dated capacity (tickets, hotel nights on game dates, watch-party bookings, bar staffing), not for merch. Merch sellers should wait for the team's own result.",
  },
  {
    id: "spurs",
    title: "Spurs 2026: an injury report swings a conference final",
    season: "2025-26",
    teams: ["SAS", "OKC"],
    primary: "SAS",
    window: ["2026-05-12", "2026-06-20"],
    key: "26-OKC-052508",
    tests: "Scheduled news (injury reports) arrives a day before games. Is that enough lead for local businesses?",
    story: () => {
      const a = sig("26-OKC-052508"),
        b = sig("26-SAS-053108");
      return [
        [
          "On the evening of May 23, 2026, the Thunder listed Ajay Mitchell out and Jalen Williams questionable for West Finals Game 4. Over the next morning OKC's title odds fell ",
          { b: pctOdds(a) },
          ", with no game being played (labelled injury, medium confidence). Six days later OKC ruled both players out of Game 7 about 22 hours before tip.",
        ],
        [
          "San Antonio won Game 7 (",
          { b: pctOdds(b) },
          "), and the city reacted: Academy stores stayed open until 3am, Bakwood BBQ reported demand +500% on Spurs nights, and Visit San Antonio put the playoff run at $36.2M. Spurs merch searches peaked on the clinch day, higher than any day of the Finals.",
        ],
        [
          "Limitation found: the detector's one-signal-per-24h rule merged the Game 7 injury-report move into the Game 7 result. A production system should treat official injury-report releases as their own event stream.",
        ],
      ];
    },
    lesson:
      "The NBA publishes injury reports on a schedule (the afternoon before and the day of games). For bars, restaurants and hotels, whose decisions are made the day before, that's the right lead time. Ingest the reports directly; use the market to tell you how much each one matters.",
  },
  {
    id: "noise",
    title: "The whale that wasn't news (and why naive alerts fail)",
    season: "2024-25",
    teams: ["IND"],
    primary: "IND",
    window: ["2024-10-14", "2024-11-10"],
    key: "25-IND-101601",
    tests: 'What would an un-filtered "odds spiked" alert have told merchants?',
    story: () => {
      const rej = S.signals.filter((s) => s.season === "2024-25" && s.abbr === "IND" && s.day0 <= "2024-11-10");
      const a = rej[0];
      return [
        [
          "In mid-October 2024, before the season had started, the Pacers' title odds jumped from ",
          { b: pctOdds(a) },
          `. ${a?.n_wallets ?? "A handful of"} wallet(s) traded, and the largest supplied ${fmt.pct(a?.top1)} of the move's volume. No game, no news.`,
        ],
        [
          `A naive alert ("Pacers title odds 3.8×!") would have told Indiana merchants to stock up for a run seven months early. Our filters rejected all ${rej.filter((s) => !s.passed).length} Pacers moves in this window (single wallet, too few trades, or reverted). Merch searches didn't move.`,
        ],
        [
          'This market was also full of wash or rewards volume: about $378M "traded" on the Sacramento Kings\' title contract in 2024-25. Volume-based signals are worthless here; price, persistence, breadth and a second venue are what work.',
        ],
      ];
    },
    lesson:
      "The free version of this product (an odds alert) is actively harmful. Denoising isn't a feature; it's the price of entry.",
  },
];

export async function renderCases(root) {
  root.replaceChildren();
  root.appendChild(h("h1", null, "Case studies"));
  para(
    root,
    "Each case pairs our detected signals and demand series with independently documented commerce evidence (press, ticketing data and city tallies, cited). They were chosen to test specific failure modes, not to show off.",
    "lede",
  );
  const nav = h("div", "case-nav");
  for (const c of CASES) {
    const b = h("button", "chip" + (c.id === current ? " on" : ""), c.title.split(":")[0]);
    b.type = "button";
    b.addEventListener("click", () => {
      current = c.id;
      renderCases(root);
    });
    nav.appendChild(b);
  }
  root.appendChild(nav);
  const c = CASES.find((x) => x.id === current);
  const body = h("div");
  root.appendChild(body);
  body.appendChild(h("h2", null, c.title));
  const tq = h("p", "secondary");
  tq.appendChild(h("strong", null, "What it tests: "));
  tq.appendChild(document.createTextNode(c.tests));
  body.appendChild(tq);

  const g = h("div", "grid2");
  body.appendChild(g);
  const left = h("div", "stack");
  g.appendChild(left);
  const story = card(left, "What happened");
  for (const parts of c.story()) richPara(story, parts);
  const les = h("div", "callout");
  les.appendChild(h("strong", null, "Lesson for the product: "));
  les.appendChild(document.createTextNode(c.lesson));
  story.appendChild(les);

  const right = h("div", "stack");
  g.appendChild(right);
  const x0 = dayMs(c.window[0]),
    x1 = dayMs(c.window[1]);
  const oc = card(right, "Title odds (Polymarket)", "markers = detected moves; hollow = rejected");
  const och = h("div");
  oc.appendChild(och);
  const colors = [C.s1, C.s2];
  const series = [];
  for (const [i, t] of c.teams.entries()) {
    const o = await getOdds(c.season, t);
    series.push({
      label: teamName(t),
      color: colors[i],
      points: o.pm.filter((p) => p[0] >= x0 - 864e5 && p[0] <= x1 + 864e5),
    });
  }
  const sigs = S.signals.filter(
    (s) => s.season === c.season && c.teams.includes(s.abbr) && dayMs(s.day0) >= x0 && dayMs(s.day0) <= x1,
  );
  lineChart(och, {
    height: 230,
    x: { domain: [x0, x1] },
    y: { format: (v) => fmt.pct(v), tipFormat: (v) => fmt.pct(v, 1) },
    series,
    xTip: (t) => fmt.datetime(t),
    markers: sigs.map((s) => ({
      x: s.emit_ts * 1000,
      y: s.p1,
      shape: s.passed ? (s.dir > 0 ? "up" : "down") : "ring",
      muted: !s.passed,
      selected: s.sid === c.key,
      tip: [
        `${s.emit} ET · ${s.abbr}`,
        [
          { value: pctOdds(s), label: s.cls_label },
          { value: s.cause.slice(0, 60), label: "" },
        ],
      ],
    })),
  });
  const dc = card(
    right,
    c.teams.length > 1 ? "Merch search interest" : `${teamName(c.primary)} merch search interest`,
    "Google Trends, daily",
  );
  const dch = h("div");
  dc.appendChild(dch);
  const ds = c.teams
    .map((t, i) => ({
      label: teamName(t),
      color: colors[i],
      points: dailySeries(c.season, t, "merch").filter((p) => p[0] >= x0 && p[0] <= x1),
    }))
    .filter((s) => s.points.some((p) => p[1] != null));
  const key = sig(c.key);
  if (ds.length)
    lineChart(dch, {
      height: 190,
      x: { domain: [x0, x1] },
      y: { format: (v) => fmt.num(v) },
      series: ds,
      rules: key ? [{ x: dayMs(key.day0), label: "key signal", strong: true }] : [],
    });
  else dch.appendChild(h("div", "empty", "Merch series too sparse for this team."));
  para(
    dc,
    "Google normalises each query to its own peak (100), so compare shapes within a team, not levels across teams.",
    "tiny muted",
  );

  // merchant timing for the key signal
  if (key && key.passed && S.merchant) {
    const e = excess(c.season, c.primary, key.day0);
    const tc = card(
      body,
      "If a merchant had acted on the key signal",
      `signal emitted ${key.emit} ET · lead times from the execution research`,
    );
    tc.classList.add("mt");
    const rows = Object.values(S.merchant.archetypes).map((a) => ({
      a,
      ready: addDays(key.day0, a.lead),
      share: e ? e.shareAfter(a.lead) : null,
    }));
    table(
      tc,
      [
        { label: "Merchant type", get: (r) => r.a.name.split("(")[0].trim() },
        { label: "Lead time", num: true, get: (r) => r.a.lead + "d" },
        { label: "Ready on", get: (r) => r.ready },
        {
          label: "Share of next-14-day excess demand still ahead",
          num: true,
          get: (r) => (r.share == null ? "–" : fmt.pct(r.share)),
        },
      ],
      rows,
    );
    para(
      tc,
      "Excess demand = merch searches above the team's own days −14…−2 average, days 0–14 after the signal. Ex post, for illustration.",
      "tiny muted mt",
    );
  }

  const ev = impacts(c.teams, c.window[0], addDays(c.window[1], 60));
  const g2 = h("div", "grid2 mt");
  body.appendChild(g2);
  const ec = card(g2, "Documented commerce evidence", `${ev.length} cited data points`);
  if (ev.length)
    table(
      ec,
      [
        { label: "Date", get: (x) => x.date },
        { label: "Sector", get: (x) => x.sector.replace("_", " ") },
        { label: "Metric → value", get: (x) => `${x.metric}: ${x.value}` },
        {
          label: "Source",
          get: (x) => {
            const a = h("a", "src", "link");
            a.href = x.source_url;
            a.target = "_blank";
            a.rel = "noopener";
            return a;
          },
        },
      ],
      ev,
      { maxHeight: "420px" },
    );
  else
    ec.appendChild(h("div", "empty", "No documented commerce data for this window (that's the point of this case)."));
  const tl = card(g2, "Timeline", "events (cited) + our kept signals");
  const items = [
    ...events(c.teams, c.window[0], c.window[1]).map((e) => ({
      when: e.date + (e.time_et ? " " + e.time_et : ""),
      what: e.headline,
      tag: e.category.replace(/_/g, " "),
    })),
    ...sigs
      .filter((s) => s.passed)
      .map((s) => ({ when: s.emit, what: `${s.abbr} ${pctOdds(s)} · ${s.cls_label}`, tag: "signal" })),
  ].sort((a, b) => (a.when < b.when ? -1 : 1));
  const ul = h("ul", "timeline");
  for (const it of items.slice(0, 40)) {
    const li = h("li");
    li.appendChild(h("span", "when", it.when.slice(0, 16)));
    const w = h("span", "what");
    w.appendChild(document.createTextNode(it.what + " "));
    w.appendChild(h("span", "tiny muted", "· " + it.tag));
    li.appendChild(w);
    ul.appendChild(li);
  }
  tl.appendChild(ul);
  if (key) {
    const kc = card(body, "Insight card for the key signal (as the product would have shown it)");
    kc.classList.add("mt", "insight");
    insightCard(kc, key);
  }
}
