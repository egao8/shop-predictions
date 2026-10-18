import { fmt, h } from "./charts.js";
import { S } from "./app.js";
import { aggregate, MERCH } from "./v2.js";

function sec(root, title) {
  root.appendChild(h("h2", null, title));
}
function p(root, parts, cls) {
  const el = h("p", cls);
  for (const x of [].concat(parts)) {
    if (typeof x === "string") el.appendChild(document.createTextNode(x));
    else if (x.b) el.appendChild(h("strong", null, x.b));
    else if (x.i) el.appendChild(h("em", null, x.i));
  }
  root.appendChild(el);
}
function list(root, items, ordered) {
  const l = h(ordered ? "ol" : "ul");
  for (const it of items) {
    const li = h("li");
    for (const x of [].concat(it)) {
      if (typeof x === "string") li.appendChild(document.createTextNode(x));
      else if (x.b) li.appendChild(h("strong", null, x.b));
    }
    l.appendChild(li);
  }
  root.appendChild(l);
}
const sp = (v) => (v == null || !isFinite(v) ? "–" : (v >= 0 ? "+" : "−") + Math.abs(v * 100).toFixed(0) + "%");

export function renderStrategy(root) {
  root.replaceChildren();
  const SC = S.v2.scenarios,
    P = SC.primary,
    B = P.bootstrap,
    M = S.merchant;
  const ev = SC.events.filter((e) => e.passed);
  const A = aggregate(ev);
  const cat = (c) => aggregate(ev.filter((e) => e.cat === c));
  const el = cat("eliminated"),
    gd = cat("good"),
    tt = cat("title");
  const tq = SC.exploratory?.top_quartile_shocks;
  const h1 = B.m3_minus_m1.p < 0.05,
    h2 = B.m3_minus_m2.p < 0.05;
  const lic = M.summary.licensed_reseller;
  const w = h("div", "prose");
  root.appendChild(w);
  w.appendChild(h("h1", null, "Strategy memo v2: what the three-merchant test means for the company"));

  const BL = SC.by_league,
    RB = SC.robustness_by_league || {};
  const strong = Object.entries(BL)
    .filter(
      ([L, v]) =>
        v.n >= 20 && v.bootstrap.m3_minus_m1.p < 0.05 && Object.values(RB).every((d) => d[L] && d[L].m3 > d[L].m1),
    )
    .map(([L]) => L);
  const lead = strong[0];
  const tl = h("div", "callout");
  tl.appendChild(h("strong", null, "TL;DR: "));
  tl.appendChild(
    document.createTextNode(
      `Yes, a merchant acting on our classified signal at T=0 makes more money than one doing nothing: Tipoff captured ${sp(P.captured.m3)} of the opportunity (90% CI ${sp(B.ci.m3.lo)} to ${sp(B.ci.m3.hi)}), about ${fmt.money(A.m.m3.profitVsM0PerEvent)} per event for a 20-unit/day store. ` +
        (h1
          ? `It also beats a well-informed merchant's gut feel overall (p = ${fmt.p(B.m3_minus_m1.p)}). `
          : `But the market's precise number only beats a well-informed merchant's gut feel in ${lead ? `one league, the ${lead}, where Tipoff captured ${sp(BL[lead].captured.m3)} vs ${sp(BL[lead].captured.m1)} and won under every robustness variant` : "no league robustly"}. Overall it's ${sp(P.captured.m3)} vs ${sp(P.captured.m1)}, p = ${fmt.p(B.m3_minus_m1.p)}. `) +
        `Most of the value is knowing what happened and acting on it, especially stopping after eliminations and acting on big repricings. ${lead ? `Start where the number itself pays: the ${lead}, forward-tested on the live season.` : ""}`,
    ),
  );
  w.appendChild(tl);

  sec(w, "1. The three scenarios, measured");
  list(w, [
    [
      { b: "Scenario 1 (do nothing special): " },
      `sold ${sp(A.m.m0.soldVsLastWeek)} vs the week before, against demand of ${sp(A.demandVsLastWeek)}. It stocks out on the big days and over-stocks after eliminations.`,
    ],
    [
      { b: "Scenario 2 (smart, gut feel): " },
      `sold ${sp(A.m.m1.soldVsLastWeek)}; captured ${sp(A.m.m1.captured)} of the profit opportunity.`,
    ],
    [
      { b: "Scenario 3 (Tipoff): " },
      `sold ${sp(A.m.m3.soldVsLastWeek)}; captured ${sp(A.m.m3.captured)}. Strict benchmark (class history without the market's number): ${sp(A.m.m2.captured)}.`,
    ],
    [
      { b: "Ceiling (perfect hindsight): " },
      `sold ${sp(A.m.m4.soldVsLastWeek)}, which is ${fmt.money(A.m.m4.profitVsM0PerEvent)} per event more than scenario 1 for a 20-unit/day store. That's the size of the prize; nobody gets all of it.`,
    ],
  ]);
  p(w, [
    'In sales terms (the original "+5%, then +2%, then +6%" framing), the event-aware merchants do sell more units. But in profit terms, units bought on a guess and left on the shelf erase much of the gain. ',
    { b: "Judge the product on profit, not GMV." },
  ]);

  sec(w, "2. Is the reframe right?");
  p(w, [
    '"Prediction markets quantify the significance of new information" holds in two of three senses. ',
    { b: "As a detector, yes:" },
    " kept moves predict which way demand goes, rejected moves mostly don't (thin MLB markets are the exception: the gates were tuned on the NBA and throw out some real moves there), and acting on the classified event beats doing nothing in the pre-registered test. ",
    { b: "As a filter for what's big, mostly yes:" },
    tq ? ` on the largest quarter of repricings Tipoff captured ${sp(tq.m3)} vs gut feel ${sp(tq.m1)}. ` : " ",
    { b: "As a precise ruler for order size, only in some markets:" },
    ` the strict test (does the market's number beat class history?) is p = ${fmt.p(B.m3_minus_m2.p)} overall${lead ? `, but p = ${fmt.p(BL[lead].bootstrap.m3_minus_m2.p)} in the ${lead}` : ""}. Title odds price championships, not this week's merch demand, so the number transfers to demand only where the two move together.`,
  ]);
  if (lead) {
    sec(w, `3. Why the ${lead} works (hypotheses to test, not proven)`);
    list(w, [
      [
        { b: "Every game moves the season. " },
        'With a 17-game season and single-elimination playoffs, each result shifts title odds a lot, and fans\' buying tracks "is this team for real?" closely.',
      ],
      [
        { b: "A weekly rhythm. " },
        "One decision per week per team, with 14-day windows covering about two games: the cadence a merchant actually plans around.",
      ],
      [
        { b: "The deepest market on both sides. " },
        "The biggest US licensed-merch category, and among the most liquid title markets in this study (about $1.15B and $704M traded on Polymarket).",
      ],
      [
        { b: "The season is live now. " },
        "The 2026 season is underway, so we can confirm (or kill) this result out of sample with design partners within weeks instead of waiting a year.",
      ],
    ]);
  }
  sec(w, `${lead ? "4" : "3"}. What the product should be: an act/stop radar (+ sizing where it's proven)`);
  list(w, [
    [
      { b: "Stop (highest value, ship first). " },
      el
        ? `After eliminations, demand fell ${sp(el.demandVsLastWeek)} vs the week before. Merchants who knew captured ${sp(el.m.m3.captured)} of the opportunity just by not restocking. Automate it: pause ads, cancel open POs, start markdowns the night the season ends (or when a star goes down for the year).`
        : "",
    ],
    [
      { b: "Act on the big ones only. " },
      "Alert when the repricing is large (top-quartile odds moves); stay silent on the rest. Fewer, better alerts also protect trust, since most odds moves don't justify an order.",
    ],
    [
      { b: "Size only where it's proven. " },
      lead
        ? `Quantified sizing in the ${lead}; elsewhere recommend direction and a bounded range ("order 20–40% more than last week") and learn each store's own response from its orders. That's where the data flywheel starts.`
        : 'Recommend direction and a bounded range ("order 20–40% more than last week"), then learn each store\'s own response from its orders.',
    ],
    [
      { b: "The championship spike is someone else's. " },
      tt
        ? `Title-win demand ${sp(tt.demandVsLastWeek)} vs the week before over 14 days. The spike is about 72 hours and Fanatics owns it; sell-through, not restock.`
        : "Short spike, pre-printed by Fanatics; sell-through, not restock.",
    ],
  ]);

  sec(w, `${lead ? "5" : "4"}. Business model`);
  p(w, [
    "Price on ",
    { b: "profit protected + profit gained" },
    ', not GMV. The event-aware merchants sell more units than business-as-usual (a GMV take-rate would look great on paper), but some of those units come with leftover stock. A merchant who pays us a GMV cut on sales that lost them money churns. A stop-loss product has the cleanest ROI story: "we stopped you buying X units the night your team was eliminated."',
  ]);
  p(w, [
    `Lead time still matters (from v1's latency simulation): with real delivery delays, signal-aware ordering added ${sp(lic.uplift_vs_reactive)} profit for 14-day-lead licensed sellers and about nothing for print-on-demand. The best customers are the ones who must commit early, and for them "stop" and "go big" decisions are worth the most.`,
  ]);

  sec(w, `${lead ? "6" : "5"}. What would change my mind`);
  list(w, [
    [
      { b: "Real orders. " },
      "Search interest is a noisy stand-in. If 3–5 stores' real order histories show tighter event responses, the sizing test could flip. That's the single most important experiment.",
    ],
    [
      { b: "A better market for the decision. " },
      'Title odds price championships, not "how many fans will buy this week". Series markets, player props (injury/return) and attendance-related markets may map more directly to demand. The ladder idea from v1 is still the right direction.',
    ],
    [
      { b: "Bigger, rarer shocks. " },
      "The exploratory result says value concentrates in big repricings. Macro markets (tariffs, de minimis, weather) are mostly big repricings with long lead times, which is the regime where this test shows the most promise.",
    ],
  ]);

  sec(w, `${lead ? "7" : "6"}. Next 30 days`);
  list(
    w,
    [
      lead
        ? `Week 1: pre-register a forward test on the live ${lead} season (same spec, same hash discipline) and start logging every signal and the order each merchant type would place. Ship the stop/act radar spec alongside.`
        : "Week 1: ship the stop/act radar spec (elimination and season-ending-injury kill switch; top-quartile move alerts) and a one-page ROI card per alert.",
      `Week 2: get 3–5 design partners${lead ? ` (${lead} fan-merch Shopify stores first)` : ""}. Pull their order history and re-run this exact pre-registered test on real orders.`,
      "Week 3: add series-winner and player markets to the ladder; re-test the strict benchmark (does the market's number beat class history?) on the market closest to each decision.",
      "Week 4: phase 1b on tariff/de-minimis markets vs import-heavy categories, the long-lead, big-shock regime.",
    ],
    true,
  );

  sec(w, `${lead ? "8" : "7"}. Open asks`);
  list(w, [
    [
      { b: "Design-partner order data. " },
      "Anonymised Shopify order exports. Nothing else will settle the sizing question.",
    ],
    [
      { b: "The existing Polymarket parquet backtester (not in this repo). " },
      "Full trade history for every move (the public API caps windows).",
    ],
    [
      { b: "A call: " },
      lead
        ? `start with the ${lead} (where the quantified signal itself pays, and the season is live) or stay multi-sport? Recommendation: ${lead} first, act/stop radar for every sport, sizing as the upsell wherever partner data proves it.`
        : "lead with the act/stop radar (provable now), or invest in proving precision sizing first (needs partners)? Recommendation: radar first.",
    ],
    [
      { b: "An Anthropic API key " },
      "for live news classification (injury reports, trade wires), which is where the stop signals come from fastest.",
    ],
  ]);
  w.appendChild(
    h(
      "p",
      "small muted mt2",
      "Numbers on this page are computed live from site/data/v2.json and site/data/NBA/merchant.json; re-running the pipeline updates them.",
    ),
  );
}
