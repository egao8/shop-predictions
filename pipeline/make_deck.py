"""Generate site/deck.html from the backtest outputs."""

import json
import math
from pathlib import Path
from statistics import NormalDist

ROOT = Path(__file__).resolve().parents[1]
V2 = json.loads((ROOT / "site" / "data" / "v2.json").read_text())
SC, LG = V2["scenarios"], V2["leagues"]
MER = json.loads((ROOT / "site" / "data" / "NBA" / "merchant.json").read_text())["summary"]
P = SC["primary"]
D = SC["dollars_per_event_20u"]
CAT = SC["by_category"]
BL = SC["by_league"]
RB = SC.get("robustness_by_league", {})


def pct(x, d=0):
    return ("+" if x >= 0 else "−") + f"{abs(x) * 100:.{d}f}%"


def money(x):
    return ("−" if x < 0 else "") + f"${abs(x):,.0f}"


def p_(x):
    return "<0.001" if x < 0.001 else f"{x:.3f}"


econ = SC["economics"]
cu, co = econ["cu"], econ["co"]
z = NormalDist().inv_cdf(cu / (cu + co))
luka = next(e for e in SC["events"] if e["sid"] == "25-LAL-020213")
LQ = {m: 14 * math.exp(luka[f"{m}_mu"] + z * luka[f"{m}_sd"]) for m in ("m0", "m1", "m3")}
LQ["m4"] = luka["X"]
LP = {m: (cu * min(q, luka["X"]) - co * max(q - luka["X"], 0)) * 20 for m, q in LQ.items()}
cum, acc = [], 0
for v in luka["path"][7:]:
    acc += v or 0
    cum.append(acc)
sold_out_day = next((i for i, c in enumerate(cum) if c > LQ["m0"]), None)

funnel = {L: LG[L]["funnel"] for L in LG if LG[L]}
cand = sum(f["candidates"] for f in funnel.values())
kept = sum(f["passed"] for f in funnel.values())
nfl = BL["NFL"]
nfl_rob = [RB[k]["NFL"]["m3"] - RB[k]["NFL"]["m1"] for k in RB if "NFL" in RB[k]]
tq = SC["exploratory"]["top_quartile_shocks"]
bt = P["bootstrap"]


def hbar(rows, maxv=1.0, minv=0.0, width=620, rowh=46, label_w=230, fmt=pct):
    """Horizontal bars (SVG). rows: (label, value, color, note)."""
    span = maxv - minv
    plot = width - label_w - 90
    zero = label_w + (0 - minv) / span * plot
    h = rowh * len(rows) + 10
    out = [f'<svg viewBox="0 0 {width} {h}" width="{width}" height="{h}" class="bars">']
    if minv < 0:
        out.append(f'<line x1="{zero}" x2="{zero}" y1="0" y2="{h}" class="zero"/>')
    for i, (lab, v, col, note) in enumerate(rows):
        y = i * rowh + 8
        x0 = zero if v >= 0 else zero + v / span * plot
        w = max(2, abs(v) / span * plot)
        out.append(f'<text x="0" y="{y + 20}" class="bl">{lab}</text>')
        if note:
            out.append(f'<text x="0" y="{y + 37}" class="bn">{note}</text>')
        out.append(f'<rect x="{x0:.1f}" y="{y + 6}" width="{w:.1f}" height="20" rx="4" fill="{col}"/>')
        tx = (x0 + w + 8) if v >= 0 else (x0 - 8)
        anchor = "start" if v >= 0 else "end"
        out.append(f'<text x="{tx:.1f}" y="{y + 21}" class="bv" text-anchor="{anchor}">{fmt(v)}</text>')
    out.append("</svg>")
    return "".join(out)


BLUE, GRAY, RED, LIGHT = "#2a78d6", "#a9a8a1", "#e34948", "#cde2fb"

slides = []
S = slides.append

S(f"""
<section class="slide title">
  <div class="kicker">Tipoff · Phase 1 · v2 · October 2026</div>
  <h1>Where the model stands</h1>
  <p class="sub">Prediction-market signals → merchant decisions.<br>Backtested on {sum(v["n"] for v in BL.values())} real events across the NBA, NHL, NFL and MLB (two seasons each).</p>
  <div class="foot">Everything in this deck is generated from the backtest outputs (pre-registration sha256 {SC["prereg_sha256"][:12]}…). Demand is measured with search interest, not real orders.</div>
</section>""")

S(f"""
<section class="slide">
  <div class="kicker">The answer</div>
  <h2>Our signal makes merchants money. The market's number is the edge only in the NFL.</h2>
  <div class="three">
    <div class="big good"><div class="tag"><i></i>Proven in backtest</div><div class="num">{money(D["m3"])}</div><div class="lab">extra profit per event vs doing nothing<br><span>(store selling 20 units/day; {pct(P["captured"]["m3"])} of the maximum possible)</span></div></div>
    <div class="big warn"><div class="tag"><i></i>Partly</div><div class="num">{pct(nfl["captured"]["m3"])} vs {pct(nfl["captured"]["m1"])}</div><div class="lab">NFL: our signal vs a smart merchant's gut feel<br><span>Overall it's only {pct(P["captured"]["m3"])} vs {pct(P["captured"]["m1"])}, not a reliable edge</span></div></div>
    <div class="big good"><div class="tag"><i></i>Where the money is</div><div class="num">{pct(CAT["eliminated"]["captured"]["m3"])}</div><div class="lab">of the opportunity captured on <b>"stop"</b> calls after eliminations<br><span>Big repricings: {pct(tq["m3"])}. Ordinary good news: {pct(CAT["good"]["captured"]["m3"])}.</span></div></div>
  </div>
</section>""")

steps = [
    (
        "1",
        "Spike → real signal",
        "Proven",
        "good",
        f"{cand} odds moves → {kept} kept. Noise (single wallets, reverting prints, one-venue moves) filtered without hindsight.",
    ),
    (
        "2",
        "Signal → plain-English insight",
        "Proven",
        "good",
        "Every kept move gets a cause: series clinch, elimination, playoff win/loss, rival's game, trade or injury.",
    ),
    (
        "3",
        "Demand moves after the signal",
        "Proven",
        "good",
        "Fans' merch searches follow the signal's direction over the next two weeks (NBA, NFL, MLB).",
    ),
    (
        "4",
        "Merchant acts at T=0",
        "Simulated",
        "warn",
        "Five merchant policies replayed on every event. No real store has acted on a signal yet.",
    ),
    (
        "5",
        "Merchant makes more money",
        "Simulated",
        "warn",
        f"Yes vs doing nothing ({money(D['m3'])}/event). Vs a smart merchant: only clearly in the NFL.",
    ),
]
rows = "".join(
    f'<div class="step"><div class="n">{n}</div><div class="what"><b>{a}</b><span>{d}</span></div><div class="pill {k}"><i></i>{s}</div></div>'
    for n, a, s, k, d in steps
)
S(f"""
<section class="slide">
  <div class="kicker">What we set out to prove</div>
  <h2>The chain, and how far along each link is</h2>
  <div class="steps">{rows}</div>
  <div class="foot">"Proven" = shown in historical data with out-of-sample tests. "Simulated" = replayed with a model of merchant behaviour; needs real store orders to confirm.</div>
</section>""")

S(f"""
<section class="slide">
  <div class="kicker">How the model works</div>
  <h2>Five steps, all using only information available at the moment the signal fires</h2>
  <div class="pipe">
    <div><b>1 · Sense</b><span>Hourly title odds for every team, Polymarket + Kalshi (as a cross-check), 4 leagues × 2 seasons</span><em>{cand} candidate moves</em></div>
    <div><b>2 · Filter</b><span>Move must hold 6 hours, Kalshi must agree, enough trades, not driven by one wallet</span><em>{kept} kept</em></div>
    <div><b>3 · Classify</b><span>Which game or news caused it? Clinch, win, loss, elimination, title, rival's game, off-court news</span><em>8 event types</em></div>
    <div><b>4 · Forecast</b><span>Expected 14-day demand for this type of event, adjusted by how far the odds moved. Trained on the other season only</span><em>no lookahead</em></div>
    <div><b>5 · Act</b><span>Order size (or stop) at T=0, plus a playbook per merchant type</span><em>one decision per event</em></div>
  </div>
</section>""")

rej_rows = "".join(
    f"<tr><td>{L}</td><td>{LG[L]['funnel']['candidates']} → {LG[L]['funnel']['passed']}</td><td>{LG[L]['slope_kept_t']:+.1f}</td><td>{LG[L]['slope_rej_t']:+.1f}</td></tr>"
    for L in ("NFL", "MLB", "NBA", "NHL")
)
S(f"""
<section class="slide">
  <div class="kicker">Question 1</div>
  <h2>Can we tell real signals from noise? <span class="ans good">Yes</span></h2>
  <div class="two">
    <div>
      <p>If a move is real, its <b>size</b> should predict how much demand changes. If it's noise, it shouldn't.</p>
      <table class="t"><tr><th>League</th><th>Moves → kept</th><th>Kept: size predicts demand (t)</th><th>Rejected (t)</th></tr>{rej_rows}</table>
      <p class="small">t above ~2 = a real relationship. Kept moves pass in the NFL, MLB and NBA. Rejected moves are ~0 in the NBA (as they should be), but in thin MLB markets our filter also threw out some real moves: thresholds need tuning per market. NHL: too little demand data.</p>
    </div>
    <div class="callout">
      <b>Example of noise caught</b>
      <p>October 2024, before the season: one wallet pushed the Pacers' title odds from 1.6% to 6%. No game, no news. A naive "odds spiked" alert would have told Indiana merchants to stock up seven months early. Our filter rejected it, and fan demand never moved.</p>
    </div>
  </div>
</section>""")

S(f"""
<section class="slide">
  <div class="kicker">Question 2</div>
  <h2>Does demand actually move after a signal? <span class="ans good">Yes, and the type of event matters more than the arrow</span></h2>
  <div class="two">
    <div>{
    hbar(
        [
            ("After an elimination", CAT["eliminated"]["demand_vs_lastweek"], RED, f"{CAT['eliminated']['n']} events"),
            (
                "After good news",
                CAT["good"]["demand_vs_lastweek"],
                BLUE,
                f"{CAT['good']['n']} events (wins, clinches, good off-court news)",
            ),
            ("After a loss (team still alive)", CAT["bad"]["demand_vs_lastweek"], GRAY, f"{CAT['bad']['n']} events"),
            (
                "After winning the title",
                CAT["title"]["demand_vs_lastweek"],
                GRAY,
                f"{CAT['title']['n']} events (spike lasts ~3 days)",
            ),
        ],
        maxv=0.7,
        minv=-0.7,
    )
}
      <p class="small">Demand over the next 14 days vs the week before the signal.</p></div>
    <div>
      <p>Direction test (does demand follow the odds?): p = {p_(LG["NFL"]["dir_p"])} NFL, {
    p_(LG["MLB"]["dir_p"])
} MLB, {p_(LG["NBA"]["dir_p"])} NBA.</p>
      <p><b>The trap a raw odds alert falls into:</b> a playoff loss drops a team's title odds, but demand <b>doesn't</b> fall while the team is still playing. Only eliminations collapse demand. That's why we classify every move before acting.</p>
    </div>
  </div>
</section>""")

S(f"""
<section class="slide">
  <div class="kicker">Question 3 · the three scenarios</div>
  <h2>If a merchant got our signal at T=0, would they make more money? <span class="ans good">Yes</span></h2>
  <table class="t big3">
    <tr><th>Merchant</th><th>What they do at T=0</th><th>Units sold vs last week</th><th>Extra profit per event</th><th>Share of the max possible</th></tr>
    <tr><td><b>1 · Does nothing</b></td><td>Re-orders 2 weeks at last week's pace</td><td>{pct(P["sold_vs_lastweek"]["m0"])}</td><td>baseline</td><td>0%</td></tr>
    <tr><td><b>2 · Smart merchant</b></td><td>Knows the headline, orders what that kind of news usually means</td><td>{pct(P["sold_vs_lastweek"]["m1"])}</td><td>{money(D["m1"])}</td><td>{pct(P["captured"]["m1"])}</td></tr>
    <tr class="hl"><td><b>3 · Tipoff</b></td><td>Our event type + how far the odds moved</td><td>{pct(P["sold_vs_lastweek"]["m3"])}</td><td><b>{money(D["m3"])}</b></td><td><b>{pct(P["captured"]["m3"])}</b></td></tr>
    <tr class="dim"><td>Perfect hindsight</td><td>Knew exactly what demand would be</td><td>{pct(P["sold_vs_lastweek"]["m4"])}</td><td>{money(D["m4"])}</td><td>100%</td></tr>
  </table>
  <p class="small">{sum(v["n"] for v in BL.values())} events. One order at T=0 covering 14 days, delivered instantly, no top-ups. Store sells 20 units/day; $30 retail, $12 cost, 30% recovered on leftovers. Tipoff's 90% confidence range: {pct(bt["ci"]["m3"]["lo"])} to {pct(bt["ci"]["m3"]["hi"])} of the max, entirely above zero. Demand over these windows ran {pct(P["demand_vs_lastweek"])} vs the week before; "does nothing" ran out of stock on the big days and over-stocked after eliminations.</p>
</section>""")

S(f"""
<section class="slide">
  <div class="kicker">Worked example · Luka Dončić traded to the Lakers, Feb 2, 2025</div>
  <h2>The signal fired at 8am. Demand came in at {luka["X"] / 14:.1f}× the previous week's pace.</h2>
  <div class="two">
    <div>{
    hbar(
        [
            (
                "Does nothing",
                LQ["m0"] / 14,
                GRAY,
                f"sold out on day {sold_out_day}" if sold_out_day is not None else "",
            ),
            ("Smart merchant", LQ["m1"] / 14, GRAY, ""),
            ("Tipoff", LQ["m3"] / 14, BLUE, ""),
            ("Perfect hindsight", LQ["m4"] / 14, LIGHT, ""),
        ],
        maxv=7,
        fmt=lambda v: f"{v:.1f}× last week",
    )
}
      <p class="small">How much stock each merchant ordered at T=0, as a multiple of what they sold the week before (scaled to 14 days).</p></div>
    <div>
      <table class="t"><tr><th>Merchant</th><th>Profit (14 days)</th></tr>
      <tr><td>Does nothing</td><td>{money(LP["m0"])}</td></tr><tr><td>Smart merchant</td><td>{money(LP["m1"])}</td></tr>
      <tr class="hl"><td>Tipoff</td><td>{money(LP["m3"])}</td></tr><tr class="dim"><td>Perfect hindsight</td><td>{
    money(LP["m4"])
}</td></tr></table>
      <p><b>Honest read:</b> everyone under-ordered. Tipoff beat doing nothing by {
    money(LP["m3"] - LP["m0"])
} but ordered less than the smart merchant. Rare shocks this big are the hardest thing to size: there are too few of them to learn from.</p>
    </div>
  </div>
</section>""")

lrows = [
    (
        f"{L}",
        BL[L]["captured"]["m3"],
        BLUE,
        f"gut feel {pct(BL[L]['captured']['m1'])} · p = {p_(BL[L]['bootstrap']['m3_minus_m1']['p'])}",
    )
    for L in ("NFL", "MLB", "NBA")
]
S(f"""
<section class="slide">
  <div class="kicker">Question 4 · the reframe</div>
  <h2>Is the market's number better than a smart merchant's gut? <span class="ans warn">Only in the NFL</span></h2>
  <div class="two">
    <div>{hbar(lrows, maxv=0.45, minv=-0.1)}
      <p class="small">Tipoff's share of the max possible profit, by league. NHL: too few events with usable data (US merch searches are sparse).</p></div>
    <div>
      <p><b>Overall:</b> Tipoff {pct(P["captured"]["m3"])} vs smart merchant {pct(P["captured"]["m1"])} (p = {p_(bt["m3_minus_m1"]["p"])}): not a reliable edge.</p>
      <p><b>NFL:</b> Tipoff {pct(nfl["captured"]["m3"])} vs {pct(nfl["captured"]["m1"])} (p = {p_(nfl["bootstrap"]["m3_minus_m1"]["p"])}), ahead in all {len(nfl_rob)} robustness variants (+{min(nfl_rob) * 100:.0f} to +{max(nfl_rob) * 100:.0f} points).</p>
      <p><b>Why it might be the NFL:</b> 17 games, so every result moves the season; one decision a week; the biggest merch market. This was not a pre-registered hypothesis, so it needs confirming on the live 2026 season.</p>
    </div>
  </div>
</section>""")

S(f"""
<section class="slide">
  <div class="kicker">Where the money is</div>
  <h2>"Stop" and "big moves" pay most. Ordinary good news pays less.</h2>
  <div class="two">
    <div>{
    hbar(
        [
            (
                "Stop after elimination",
                CAT["eliminated"]["captured"]["m3"],
                BLUE,
                f"{CAT['eliminated']['n']} events · demand {pct(CAT['eliminated']['demand_vs_lastweek'])}",
            ),
            ("Biggest 25% of odds moves", tq["m3"], BLUE, f"{tq['n']} events (exploratory)"),
            (
                "Ordinary good news",
                CAT["good"]["captured"]["m3"],
                BLUE,
                f"{CAT['good']['n']} events · demand {pct(CAT['good']['demand_vs_lastweek'])}",
            ),
            ("Loss, team still alive", CAT["bad"]["captured"]["m3"], BLUE, f"{CAT['bad']['n']} events"),
        ],
        maxv=0.8,
    )
}
      <p class="small">Tipoff's share of the max possible profit, by type of event.</p></div>
    <div>
      <p><b>Stop:</b> when a team is eliminated, demand falls about 60% within two weeks. A merchant who simply stops restocking that night captures most of the opportunity. That's the easiest win to automate and to sell.</p>
      <p><b>Big moves:</b> the market is best at telling you <i>which</i> news is big enough to act on.</p>
      <p><b>Ordinary good news:</b> bump sizes vary too much from event to event to size precisely from search data.</p>
    </div>
  </div>
</section>""")

S(f"""
<section class="slide">
  <div class="kicker">Integrity</div>
  <h2>How we kept ourselves from fooling ourselves</h2>
  <div class="grid">
    <div><b>Locked the test before seeing results</b><span>Design written and fingerprinted (sha256 {SC["prereg_sha256"][:10]}…) before the first v2 run.</span></div>
    <div><b>No peeking ahead</b><span>Signals use only prices up to the moment they fire; every forecast is trained on the other season.</span></div>
    <div><b>Two fixes, both disclosed</b><span>A model blow-up on title wins (original spec: Tipoff {pct(SC["original_spec"]["captured"]["m3"])}) and game moves mislabelled as news. Before/after shown on the site.</span></div>
    <div><b>Honest uncertainty</b><span>Confidence ranges resample whole team-seasons, because one team's playoff signals are related.</span></div>
    <div><b>Placebo test</b><span>Shuffling the odds numbers mostly erases Tipoff's edge ({pct(SC["placebo"]["mean"])} vs {pct(SC["placebo"]["actual"])}, p = {p_(SC["placebo"]["p"])}): borderline, not conclusive.</span></div>
    <div><b>Robustness</b><span>Results re-run with 7- and 21-day windows, different margins, pooled training. Overall conclusions hold; NFL edge holds in every variant.</span></div>
  </div>
</section>""")

S("""
<section class="slide">
  <div class="kicker">What's NOT proven yet</div>
  <h2>The gaps, in order of importance</h2>
  <ol class="gaps">
    <li><b>Search interest is not sales.</b> Every demand number is Google search volume for team merch. Real Shopify orders could move every result, up or down. <em>Biggest gap.</em></li>
    <li><b>No real merchant has acted on a signal.</b> The merchant behaviour is simulated.</li>
    <li><b>Delivery delays were ignored</b> (a deliberate simplification). Our v1 test with real lead times: signals help slow-ordering stores most and fast print-on-demand stores least.</li>
    <li><b>The NFL edge was found, not predicted.</b> It needs an out-of-sample confirmation.</li>
    <li><b>Thin markets.</b> NHL demand data is too sparse to score; MLB's noise filter is too strict.</li>
    <li><b>Small sample of rare shocks.</b> Trades and season-ending injuries (the Luka type) are too few to size well.</li>
  </ol>
</section>""")

S(f"""
<section class="slide">
  <div class="kicker">What it means for the startup</div>
  <h2>The reframe is half right, and that's enough to build on</h2>
  <div class="two">
    <div>
      <p><b>The market as a detector: works.</b> It tells you something happened, which way it cuts, and whether it's big.</p>
      <p><b>The market as a ruler for order size: works in the NFL,</b> not (yet) in the NBA or MLB.</p>
      <p><b>So the product is an act/stop radar:</b></p>
      <ul><li>Stop: pause ads, cancel orders, mark down the night a season ends</li><li>Act: alert only on big repricings</li><li>Size precisely where proven (NFL first); elsewhere give a direction and a range</li></ul>
    </div>
    <div>
      <p><b>Price on profit, not sales.</b> Signal-following merchants sell about {pct(P["units_vs_m0"]["m3"])} more units, but some of that comes with leftover stock. A cut of sales would look good while costing the merchant money.</p>
      <p><b>Best customers: stores that commit early.</b> With real lead times (v1), signals added {pct(MER["licensed_reseller"]["uplift_vs_reactive"])} profit for 14-day-lead licensed sellers and about nothing for print-on-demand.</p>
      <p><b>Bigger prize later:</b> long-lead decisions (imports, tariffs) where big repricings are the norm.</p>
    </div>
  </div>
</section>""")

S("""
<section class="slide">
  <div class="kicker">Next 30 days</div>
  <h2>Turn "simulated" into "proven"</h2>
  <div class="two">
    <div>
      <ol class="gaps">
        <li><b>Week 1:</b> lock a forward test on the live 2026 NFL season, with the same pre-registration discipline. Log every signal and the order each merchant type would place.</li>
        <li><b>Week 2:</b> sign 3–5 design-partner stores (NFL fan merch first), pull their order history, and re-run this exact test on real orders.</li>
        <li><b>Week 3:</b> add series and player markets; tune the noise filter per market liquidity.</li>
        <li><b>Week 4:</b> ship the act/stop radar MVP to partners; measure the actions they take and the dollars saved.</li>
      </ol>
    </div>
    <div class="callout">
      <b>What we need</b>
      <ul><li>Design-partner store orders (anonymised Shopify exports)</li><li>The existing Polymarket parquet backtester (full trade history)</li><li>A decision: NFL-first?</li><li>An Anthropic API key for live news classification</li></ul>
    </div>
  </div>
</section>""")

CSS = """
:root { --ink:#0b0b0b; --ink2:#52514e; --mute:#898781; --line:#e1e0d9; --bg:#f9f9f7; --card:#fcfcfb; --blue:#2a78d6; --wash:rgba(42,120,214,.08);
        --good:#0ca30c; --warn:#fab219; --bad:#d03b3b; }
* { box-sizing: border-box; }
html, body { margin: 0; background: #e9e8e3; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; color: var(--ink); }
.deck { display: flex; flex-direction: column; align-items: center; gap: 28px; padding: 28px 0 80px; }
.slide { width: 1280px; height: 720px; background: var(--bg); position: relative; padding: 56px 72px; overflow: hidden; box-shadow: 0 4px 24px rgba(0,0,0,.08);
         display: flex; flex-direction: column; transform-origin: top center; }
.kicker { font-size: 15px; font-weight: 600; color: var(--blue); text-transform: uppercase; letter-spacing: .06em; margin-bottom: 10px; }
h1 { font-size: 64px; margin: 0 0 18px; letter-spacing: -.02em; }
h2 { font-size: 34px; line-height: 1.2; margin: 0 0 26px; letter-spacing: -.01em; max-width: 1120px; }
p { font-size: 20px; line-height: 1.45; margin: 0 0 14px; color: var(--ink); }
.small { font-size: 15px; color: var(--ink2); line-height: 1.45; }
.sub { font-size: 26px; color: var(--ink2); }
.title { justify-content: center; }
.foot { position: absolute; left: 72px; right: 72px; bottom: 34px; font-size: 14px; color: var(--mute); }
.slide::after { content: attr(data-n); position: absolute; right: 36px; bottom: 30px; font-size: 13px; color: var(--mute); }
.ans { display: inline-block; font-size: 20px; padding: 4px 14px; border-radius: 999px; vertical-align: middle; margin-left: 10px; border: 1px solid var(--line); background: var(--card); font-weight: 650; }
.ans::before { content: ""; display: inline-block; width: 10px; height: 10px; border-radius: 50%; margin-right: 8px; vertical-align: 1px; background: var(--c); }
.ans.good { --c: var(--good); } .ans.warn { --c: var(--warn); } .ans.bad { --c: var(--bad); }
.three { display: grid; grid-template-columns: repeat(3, 1fr); gap: 22px; margin-top: 10px; }
.big { background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 26px; }
.big .num { font-size: 52px; font-weight: 750; letter-spacing: -.02em; margin: 10px 0 8px; }
.big .lab { font-size: 19px; line-height: 1.4; }
.big .lab span { color: var(--ink2); font-size: 16px; }
.tag, .pill { display: inline-flex; align-items: center; gap: 8px; font-size: 14px; font-weight: 650; padding: 3px 12px; border-radius: 999px; border: 1px solid var(--line); background: #fff; }
.tag i, .pill i { width: 9px; height: 9px; border-radius: 50%; background: var(--c); }
.good { --c: var(--good); } .warn { --c: var(--warn); } .bad { --c: var(--bad); }
.steps { display: flex; flex-direction: column; gap: 12px; }
.step { display: grid; grid-template-columns: 44px 1fr 150px; gap: 18px; align-items: center; background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 14px 20px; }
.step .n { width: 36px; height: 36px; border-radius: 50%; background: var(--wash); color: var(--blue); font-weight: 750; display: grid; place-items: center; font-size: 18px; }
.step .what b { display: block; font-size: 21px; } .step .what span { font-size: 16px; color: var(--ink2); }
.step .pill { justify-self: end; }
.pipe { display: grid; grid-template-columns: repeat(5, 1fr); gap: 14px; margin-top: 20px; }
.pipe div { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 20px; display: flex; flex-direction: column; gap: 10px; min-height: 300px; }
.pipe b { font-size: 21px; } .pipe span { font-size: 16px; color: var(--ink2); line-height: 1.45; flex: 1; } .pipe em { font-style: normal; font-weight: 700; color: var(--blue); font-size: 18px; }
.two { display: grid; grid-template-columns: 1.05fr 1fr; gap: 48px; align-items: start; }
.callout { background: var(--wash); border-left: 4px solid var(--blue); border-radius: 0 12px 12px 0; padding: 20px 24px; }
.callout b { font-size: 19px; display: block; margin-bottom: 8px; } .callout p, .callout li { font-size: 18px; }
table.t { border-collapse: collapse; width: 100%; font-size: 18px; margin: 6px 0 16px; }
table.t th { text-align: left; font-size: 14px; color: var(--ink2); font-weight: 600; padding: 8px 10px; border-bottom: 1px solid var(--line); }
table.t td { padding: 10px; border-bottom: 1px solid var(--line); font-variant-numeric: tabular-nums; }
table.t tr.hl td { background: var(--wash); } table.t tr.dim td { color: var(--mute); }
table.big3 td { font-size: 19px; padding: 14px 10px; }
.grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px; }
.grid div { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 20px; }
.grid b { display: block; font-size: 19px; margin-bottom: 8px; } .grid span { font-size: 16px; color: var(--ink2); line-height: 1.45; }
ol.gaps, ul { margin: 0; padding-left: 24px; } ol.gaps li, ul li { font-size: 19px; line-height: 1.45; margin-bottom: 10px; } ol.gaps em { color: var(--bad); font-style: normal; font-weight: 650; }
svg.bars .bl { font-size: 17px; fill: var(--ink); font-weight: 600; } svg.bars .bn { font-size: 13px; fill: var(--mute); }
svg.bars .bv { font-size: 16px; fill: var(--ink); font-weight: 650; font-variant-numeric: tabular-nums; } svg.bars .zero { stroke: #c3c2b7; stroke-width: 1; }
.nav { position: fixed; bottom: 16px; left: 50%; transform: translateX(-50%); background: #fff; border: 1px solid var(--line); border-radius: 999px; padding: 6px 14px; font-size: 13px; color: var(--ink2); display: flex; gap: 12px; align-items: center; box-shadow: 0 2px 10px rgba(0,0,0,.08); }
.nav a { color: var(--blue); text-decoration: none; font-weight: 600; }
body.present .deck { padding: 0; gap: 0; } body.present .slide { display: none; box-shadow: none; position: fixed; top: 50%; left: 50%; }
body.present .slide.on { display: flex; }
@media print { html, body { background: none; } .deck { padding: 0; gap: 0; display: block; }
  .slide { box-shadow: none; page-break-after: always; break-after: page; transform: none !important; margin: 0 !important; position: relative !important; top: auto !important; left: auto !important; display: flex !important; }
  .nav { display: none; } @page { size: 1280px 720px; margin: 0; } }
"""

JS = """
const slides = [...document.querySelectorAll('.slide')];
slides.forEach((s, i) => s.dataset.n = `${i + 1} / ${slides.length}`);
let cur = 0, present = false;
function fit() {
  const sc = Math.min(innerWidth / 1280, innerHeight / 720);
  slides.forEach((s) => { s.style.transform = present ? `translate(-50%,-50%) scale(${sc})` : (innerWidth < 1320 ? `scale(${(innerWidth - 24) / 1280})` : ''); if (!present) s.style.marginBottom = innerWidth < 1320 ? `${-720 * (1 - (innerWidth - 24) / 1280)}px` : ''; });
}
function show(i) { cur = Math.max(0, Math.min(slides.length - 1, i)); slides.forEach((s, k) => s.classList.toggle('on', k === cur)); document.getElementById('pos').textContent = `${cur + 1} / ${slides.length}`; }
function toggle() { present = !present; document.body.classList.toggle('present', present); show(cur); fit(); }
addEventListener('keydown', (e) => { if (e.key === 'p' || e.key === 'f') toggle(); if (!present) return; if (['ArrowRight', ' ', 'PageDown'].includes(e.key)) show(cur + 1); if (['ArrowLeft', 'PageUp'].includes(e.key)) show(cur - 1); if (e.key === 'Escape') toggle(); });
addEventListener('click', (e) => { if (present && !e.target.closest('.nav')) show(cur + (e.clientX > innerWidth / 3 ? 1 : -1)); });
addEventListener('resize', fit); fit(); show(0);
"""

html = f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Tipoff · State of the model</title><style>{CSS}</style></head>
<body><div class="deck">{"".join(slides)}</div>
<div class="nav"><span id="pos"></span><a href="#" onclick="toggle();return false">Present (P)</a><a href="Tipoff-state-of-the-model.pdf">PDF</a><a href="./#answer">Full site</a></div>
<script>{JS}</script></body></html>"""
(ROOT / "site" / "deck.html").write_text(html)
print("wrote site/deck.html with", len(slides), "slides")
