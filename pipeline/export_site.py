"""Export per-league site data to site/data/<LEAGUE>/."""

import glob
import json
import math

import numpy as np
import pandas as pd

from common import DERIVED, LEAGUE, RAW, ROOT, SEASONS, SITE_DATA, TEAM
from evaluate import team_phases
from merchant import class_multipliers, demand_runs, playoff_start_mult

ET = "America/New_York"
ODDS_DIR = SITE_DATA / "odds"
ODDS_DIR.mkdir(parents=True, exist_ok=True)

CLASS_LABEL = {
    "title_clinch": "Title clinch",
    "series_clinch": "Series clinch",
    "elimination": "Elimination",
    "playoff_win": "Playoff win (series alive)",
    "playoff_loss": "Playoff loss (series alive)",
    "regular_win": "Regular-season win",
    "regular_loss": "Regular-season loss",
    "playin_win": "Play-in win",
    "playin_loss": "Play-in loss",
    "rival_game": "Rival's game",
    "news": "Off-court news",
}


def clean(o):
    if isinstance(o, dict):
        return {k: clean(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [clean(v) for v in o]
    if isinstance(o, (np.floating, float)):
        return None if (o is None or math.isnan(o) or math.isinf(o)) else round(float(o), 5)
    if isinstance(o, (np.integer,)):
        return int(o)
    if isinstance(o, (np.bool_,)):
        return bool(o)
    if isinstance(o, pd.Timestamp):
        return None if pd.isna(o) else o.isoformat()
    return o


def write(name, obj):
    (SITE_DATA / name).write_text(json.dumps(clean(obj), separators=(",", ":")))


def odds_files():
    pm = pd.read_parquet(DERIVED / "pm_hourly.parquet")
    kx = pd.read_parquet(DERIVED / "kx_hourly.parquet")
    po = []
    for f in glob.glob(str(RAW / "polymarket_playoffs" / "*.parquet")):
        df = pd.read_parquet(f)
        df["season"] = f.split("/")[-1].rsplit("_", 1)[0]
        df["h"] = df.ts.dt.floor("h")
        po.append(df.groupby(["season", "abbr", "h"]).p.last().reset_index())
    po = pd.concat(po) if po else pd.DataFrame(columns=["season", "abbr", "h", "p"])
    for (season, abbr), g in pm.groupby(["season", "abbr"]):
        cfg = SEASONS[season]
        lo = pd.Timestamp(cfg["analysis_start"], tz="UTC")
        g = g[g.h >= lo].iloc[::2]  # 2-hourly is plenty for display
        k = kx[(kx.season == season) & (kx.abbr == abbr) & (kx.h >= lo)].iloc[::2]
        q = po[(po.season == season) & (po.abbr == abbr) & (po.h >= lo)]
        q = q.set_index("h").p.resample("2h").last().dropna() if len(q) else pd.Series(dtype=float)
        obj = dict(
            t0=int(g.h.iloc[0].timestamp()),
            step=7200,
            pm=[None if pd.isna(v) else round(float(v), 4) for v in g.p],
            kx_t0=int(k.h.iloc[0].timestamp()) if len(k) else None,
            kx=[None if pd.isna(v) or v <= 0 else round(float(v), 4) for v in k.p] if len(k) else [],
            po_t0=int(q.index[0].timestamp()) if len(q) else None,
            po=[round(float(v), 4) for v in q.values] if len(q) else [],
        )
        (ODDS_DIR / f"{season}_{abbr}.json").write_text(json.dumps(obj, separators=(",", ":")))


def daily_file():
    d = pd.read_parquet(DERIVED / "daily.parquet")
    out = {}
    for (season, abbr), x in d.groupby(["season", "abbr"]):
        x = x.sort_values("date")
        out[f"{season}_{abbr}"] = dict(
            d0=x.date.iloc[0].strftime("%Y-%m-%d"),
            merch=[None if pd.isna(v) else round(float(v), 2) for v in x.merch],
            wiki=[None if pd.isna(v) else int(v) for v in x.wiki],
            tickets=[None if pd.isna(v) else round(float(v), 1) for v in x.tickets],
            watch=[None if pd.isna(v) else round(float(v), 1) for v in x.watch],
            hotel=[None if pd.isna(v) else round(float(v), 1) for v in x.hotel],
        )
    write("daily.json", out)


def playbook(r, by_class):
    """Human-readable action plan per archetype, keyed to the signal class and direction."""
    up = r.direction > 0
    c = r.cls
    hist = by_class.get(c)
    if c == "elimination":
        return dict(
            stance="Wind down",
            tone="down",
            actions=[
                (
                    "Print-on-demand",
                    "Tonight: pause team ad sets and swap the storefront hero. No inventory to unwind.",
                ),
                (
                    "In-house DTF/DTG",
                    "Cancel blank re-orders before the 4pm cutoff; stop pressing team designs; run a 72-hour clearance.",
                ),
                (
                    "Contract screen print",
                    "Call the printer today to stop any run that hasn't started; anything delivered goes to bundles or markdown.",
                ),
                (
                    "Licensed reseller",
                    "Cancel open at-once orders; mark down within the week (salvage falls quickly once the season ends).",
                ),
                ("Bars / restaurants", "Cut the extra staff and food orders scheduled for the next home game."),
                ("Hotels / STR", "Release playoff-date rate floors and minimum-stay rules."),
            ],
        )
    if c == "title_clinch":
        return dict(
            stance="Sell through, don't chase",
            tone="flat",
            actions=[
                (
                    "Print-on-demand",
                    "Within hours: publish a champions design and push email/SMS; the spike lasts about 72 hours.",
                ),
                ("In-house DTF/DTG", "Press only from blanks on hand; a 2-day restock lands as the spike fades."),
                (
                    "Contract screen print",
                    "Don't place a new run at spike rates; it arrives after demand has collapsed. Sell pre-orders only.",
                ),
                (
                    "Licensed reseller",
                    "Don't reorder: Fanatics owns the title-night spike and your order lands weeks late. Sell through and plan the parade/banner-night items.",
                ),
                ("Bars / restaurants", "Staff up for the parade and banner night: those dates are known now."),
            ],
        )
    if c == "playoff_loss":
        return dict(
            stance="Hold - don't over-react",
            tone="flat",
            actions=[
                (
                    "All merch sellers",
                    "Keep current orders. Across both seasons, a loss mid-series was followed by lower team merch demand only "
                    f"{(1 - (hist or {}).get('hit_1_7', 0.8)) * 100:.0f}% of the time - demand keeps building while the series is alive.",
                ),
                (
                    "Licensed / screen print",
                    "Don't add long-lead orders on this signal; wait for the series to resolve.",
                ),
                ("Bars / restaurants", "Keep the next home game's staffing plan."),
            ],
        )
    if up and c in ("series_clinch", "playoff_win", "news", "rival_game", "regular_win", "playin_win"):
        rnd = {
            "series_clinch": "a next-round design",
            "news": "a design tied to the news (new star, comeback, rival out)",
        }.get(c, "a playoff-run design")
        return dict(
            stance="Lean in" if c in ("series_clinch", "playoff_win") else "Prepare",
            tone="up",
            actions=[
                (
                    "Print-on-demand",
                    f"Today: publish {rnd} (live within hours) and move budget to the team's ad sets. "
                    "Customers wait 7-12 days for delivery, so promise dates carefully.",
                ),
                (
                    "In-house DTF/DTG",
                    "Order blanks before the supplier's 4pm cutoff (SanMar/S&S deliver in 1-2 days) and transfers the same day; ready in about 2 days.",
                ),
                (
                    "Contract screen print",
                    "Only if the run looks likely to last (title odds rising for a second time): rush order (+25-60% cost, 4-5 days) or open pre-orders now.",
                ),
                (
                    "Licensed reseller",
                    "Can't add new SKUs in time (2-24 week lead). Re-allocate ads to what's in stock; re-order only fast-turn items.",
                ),
                (
                    "Bars / restaurants",
                    "Add staff and place a next-day food order for upcoming home games; consider a ticketed watch party.",
                ),
                ("Hotels / STR", "Raise rate floors and minimum stays for likely home-game dates."),
            ]
            if c != "rival_game"
            else [
                (
                    "All merch sellers",
                    "The team's own fans didn't do anything - a rival stumbled. Historically these moves don't lift the team's merch demand by themselves; "
                    "prepare (designs, creative) but don't order inventory until the team's own result confirms it.",
                ),
                (
                    "Bars / restaurants / hotels",
                    "Pencil in the extra dates the run could add; commit after the next own-team result.",
                ),
            ],
        )
    if not up and c in ("news", "rival_game", "regular_loss", "playin_loss"):
        return dict(
            stance="Trim exposure",
            tone="down",
            actions=[
                ("Long-lead sellers", "Pause new long-lead orders (screen print, licensed) until the picture clears."),
                ("Fast sellers", "Keep selling; shift ad spend toward evergreen or non-team items."),
            ],
        )
    return dict(stance="Monitor", tone="flat", actions=[("All", "No action - informational.")])


def signals_file(news_labels):
    s = pd.read_parquet(DERIVED / "signals.parquet")
    res = json.loads((DERIVED / "results.json").read_text())
    by_class = res.get("merch", {}).get("by_class", {})
    esm = (
        pd.read_parquet(DERIVED / "event_study_merch.parquet").set_index("sid")
        if (DERIVED / "event_study_merch.parquet").exists()
        else None
    )
    esw = (
        pd.read_parquet(DERIVED / "event_study_wiki.parquet").set_index("sid")
        if (DERIVED / "event_study_wiki.parquet").exists()
        else None
    )
    out = []
    for r in s.sort_values("h_emit").itertuples():
        lab = news_labels.get(r.sid)
        cause = r.cls_detail
        if lab:
            cause = lab["headline"]
        elif r.cls == "news":
            cause = "Off-court news (not yet labeled)"
        checks = [
            dict(k="Held after 6h", ok=bool(r.persistent), v=f"{r.retained_at_emit * 100:.0f}% of move retained"),
            dict(
                k="Kalshi agrees",
                ok=None if not r.kx_available else bool(r.kx_confirm),
                v=("n/a (no Kalshi market yet)" if not r.kx_available else f"Kalshi moved {r.kx_move * 100:+.1f}pp"),
            ),
            dict(
                k="Broad participation",
                ok=None if not r.n_trades else not bool(r.whale_flag),
                v=f"{int(r.n_wallets or 0)} wallets, top wallet {0 if pd.isna(r.top1_share) else r.top1_share * 100:.0f}% of volume",
            ),
            dict(
                k="Enough trades",
                ok=bool((r.n_trades or 0) >= 5),
                v=f"{int(r.n_trades or 0)} trades in the move window",
            ),
        ]
        pb = playbook(r, by_class)
        rec = dict(
            sid=r.sid,
            season=r.season,
            abbr=r.abbr,
            team=TEAM[r.abbr]["name"],
            cls=r.cls,
            cls_label=CLASS_LABEL.get(r.cls, r.cls),
            news_cat=lab["category"] if lab else None,
            news_conf=lab["confidence"] if lab else None,
            news_src=lab.get("source_url") if lab else None,
            news_detail=lab.get("detail") if lab else None,
            cause=cause,
            detail=r.cls_detail,
            passed=bool(r.passed),
            reject=r.reject_reason,
            onset=r.h_onset.tz_convert(ET).strftime("%Y-%m-%d %H:%M"),
            emit=r.h_emit.tz_convert(ET).strftime("%Y-%m-%d %H:%M"),
            emit_ts=int(r.h_emit.timestamp()),
            onset_ts=int(r.h_onset.timestamp()),
            day0=r.day0.strftime("%Y-%m-%d"),
            p0=r.p_base,
            p1=r.p_emit,
            move=r.move,
            dlogit=r.dlogit,
            dir=int(r.direction),
            kx_move=r.kx_move if r.kx_available else None,
            n_wallets=r.n_wallets,
            top1=r.top1_share,
            n_trades=r.n_trades,
            notional=r.notional,
            retained_24h=r.ex_post_retained_24h,
            retained_72h=r.ex_post_retained_72h,
            checks=checks,
            playbook=pb,
        )
        if esm is not None and r.sid in esm.index:
            e = esm.loc[r.sid]
            rec["merch"] = dict(path=list(e.path), car_2_14=e.car_2_14, car_1_7=e.car_1_7, d0=e.d0)
        if esw is not None and r.sid in esw.index:
            e = esw.loc[r.sid]
            rec["wiki"] = dict(path=list(e.path), car_2_14=e.car_2_14, car_1_7=e.car_1_7, d0=e.d0)
        out.append(rec)
    write("signals.json", out)
    return s


def merchant_file():
    """Inputs for the in-browser simulator: demand runs, signals, ladder dates, multipliers for every lead time."""
    m = json.loads((DERIVED / "merchant.json").read_text())
    d = pd.read_parquet(DERIVED / "daily.parquet")
    s = pd.read_parquet(DERIVED / "signals.parquet")
    g = pd.read_parquet(RAW / "games.parquet")
    ph = team_phases(g)
    runs = demand_runs(d, ph)
    seasons = sorted({k[0] for k in runs})
    other = {a: b for a, b in zip(seasons, seasons[::-1])}
    mult = {}
    for sn in seasons:
        tr = other[sn]
        mult[sn] = dict(
            trained_on=tr,
            po_mult=playoff_start_mult(runs, tr),
            classes={str(L): class_multipliers(s, runs, tr, L) for L in range(0, 22)},
        )
    league_po = {sn: ph[ph.season == sn].po_start.min().strftime("%Y-%m-%d") for sn in seasons}
    write(
        "merchant.json",
        dict(
            archetypes=m["archetypes"],
            summary=m["summary"],
            timing=m["timing"],
            runs=[{k: v for k, v in r.items() if k != "archetypes"} | {"python": r["archetypes"]} for r in m["runs"]],
            multipliers=mult,
            league_po_start=league_po,
        ),
    )


def research_file():
    r = {}
    for name in ("execution_leadtimes", "ground_truth_events", "news_labels"):
        p = ROOT / "research" / f"{name}.json"
        if p.exists():
            r[name] = json.loads(p.read_text())
    write("research.json", r)
    return r


def meta_file(s):
    res = json.loads((DERIVED / "results.json").read_text())
    funnel = dict(
        candidates=len(s),
        persistent=int(s.persistent.sum()),
        kalshi_ok=int((s.persistent & (s.kx_confirm.fillna(1) == 1)).sum()),
        passed=int(s.passed.sum()),
    )
    reasons = {}
    for x in s.reject_reason[s.reject_reason != ""]:
        for part in x.split("; "):
            reasons[part] = reasons.get(part, 0) + 1
    write(
        "meta.json",
        dict(
            generated=pd.Timestamp.now(tz=ET).strftime("%Y-%m-%d %H:%M ET"),
            seasons=SEASONS,
            teams=TEAM,
            funnel=funnel,
            reject_reasons=reasons,
            results=res,
            trends_files=len(glob.glob(str(RAW / "trends" / "*.parquet"))),
            robustness=json.loads((DERIVED / "robustness.json").read_text())
            if (DERIVED / "robustness.json").exists()
            else [],
        ),
    )


if __name__ == "__main__":
    research = research_file() if LEAGUE == "NBA" else {}
    labels = {x["sid"]: x for x in research.get("news_labels", {}).get("labels", [])}
    odds_files()
    daily_file()
    s = signals_file(labels)
    if LEAGUE == "NBA":
        merchant_file()
    meta_file(s)
    for f in sorted(SITE_DATA.glob("*.json")):
        print(f.name, f"{f.stat().st_size / 1024:.0f} KB")
    print("odds files:", len(list(ODDS_DIR.glob("*.json"))))
