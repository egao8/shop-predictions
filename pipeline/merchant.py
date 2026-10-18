"""Latency simulation (NBA): daily order-up-to inventory replay per merchant archetype.

reactive: forecast = trailing 3-day demand. signal-aware: same, adjusted by the make-playoffs market and by
classified title-market signals; multipliers are fitted on the other season. hindsight: orders actual demand.
"""

import glob
import json

import numpy as np
import pandas as pd

from common import DERIVED, RAW, ROOT
from evaluate import team_phases

FALLBACK = {"pod": 1, "dtf_inhouse": 2, "screenprint_contract": 5, "licensed_reseller": 14}
SAFETY = 1.2


def load_archetypes():
    p = ROOT / "research" / "execution_leadtimes.json"
    out = {}
    js = json.loads(p.read_text()) if p.exists() else {"archetypes": [{"id": k, "name": k} for k in FALLBACK]}
    for a in js["archetypes"]:
        if a["id"] not in FALLBACK:
            continue
        cost, retail = a.get("unit_cost_usd_typical") or 8, a.get("retail_price_usd_typical") or 28
        out[a["id"]] = dict(
            id=a["id"],
            name=a["name"],
            lead=int(np.ceil(a.get("can_act_on_signal_within_days") or FALLBACK[a["id"]])),
            unit_cost=cost,
            retail=retail,
            salvage_pct=(a.get("overstock_salvage_pct") or 0),
            holds_inventory=a["id"] != "pod",
        )
    return out


def ladder_daily():
    """Daily close of P(make playoffs) per team-season (ET)."""
    rows = []
    for f in glob.glob(str(RAW / "polymarket_playoffs" / "*.parquet")):
        df = pd.read_parquet(f)
        season = f.split("/")[-1].rsplit("_", 1)[0]
        df["date"] = df.ts.dt.tz_convert("America/New_York").dt.tz_localize(None).dt.normalize()
        s = df.groupby("date").p.last()
        rows.append(pd.DataFrame({"season": season, "abbr": df.abbr.iloc[0], "date": s.index, "p_playoffs": s.values}))
    return pd.concat(rows, ignore_index=True)


def demand_runs(d, ph, min_nonzero=0.6):
    """Per playoff team-season: demand in baseline-days over [po_start-35, po_end+14].
    Only teams whose regular-season merch series is dense (>=60% non-zero days) -- sparse series can't be scaled."""
    runs = {}
    for r in ph[ph.po_start.notna()].itertuples():
        reg = d[
            (d.season == r.season) & (d.abbr == r.abbr) & (d.date < r.po_start - pd.Timedelta(days=5))
        ].merch.dropna()
        if not len(reg) or (reg > 0).mean() < min_nonzero:
            continue
        x = d[(d.season == r.season) & (d.abbr == r.abbr)].set_index("date").sort_index()
        m = x.merch.rolling(3, min_periods=1).mean()  # causal smoothing of Google's sampling noise
        base = m.loc[r.po_start - pd.Timedelta(days=75) : r.po_start - pd.Timedelta(days=36)].mean()
        if not base or np.isnan(base):
            continue
        w0, w1 = r.po_start - pd.Timedelta(days=35), r.po_end + pd.Timedelta(days=14)
        D = (m.loc[w0:w1] / base).clip(upper=120)
        runs[(r.season, r.abbr)] = dict(D=D, po_start=r.po_start, po_end=r.po_end, champion=bool(r.won_title))
    return runs


def class_multipliers(s, runs, season, L):
    """Median ratio of demand over the next L+1 days vs. the trailing 3 days after a signal of each class (one season)."""
    out = {}
    sub = s[(s.season == season) & s.passed]
    for c_, grp in sub.groupby("cls"):
        ratios = []
        for r in grp.itertuples():
            run = runs.get((r.season, r.abbr))
            if run is None:
                continue
            D = run["D"]
            if r.day0 not in D.index:
                continue
            i = D.index.get_loc(r.day0)
            past = D.iloc[max(0, i - 2) : i + 1].mean()
            fut = D.iloc[i + 1 : i + 2 + L].mean()
            if past > 0 and not np.isnan(fut):
                ratios.append(fut / past)
        if len(ratios) >= (1 if c_ == "title_clinch" else 2):  # one title per season by construction
            out[c_] = float(np.median(ratios))
    return out


def playoff_start_mult(runs, season):
    vals = [
        run["D"].loc[run["po_start"] : run["po_start"] + pd.Timedelta(days=13)].mean()
        for (s_, a), run in runs.items()
        if s_ == season
    ]
    return float(np.median(vals)) if vals else 2.0


def simulate(D, L, forecast_fn, holds_inventory=True):
    dates = list(D.index)
    n = len(dates)
    dem = D.to_numpy()
    arrivals = np.zeros(n + L + 1)
    on_hand = float(dem[:3].mean() * (L + 1))  # start with a normal cover of stock
    pipeline = 0.0
    sold = lost = ordered = 0.0
    for t in range(n):
        on_hand += arrivals[t]
        pipeline -= arrivals[t]
        s_ = min(dem[t], on_hand) if holds_inventory else dem[t]
        sold += s_
        lost += dem[t] - s_
        on_hand -= s_
        if holds_inventory:
            f = forecast_fn(t, dem)
            target = f * (L + 1) * SAFETY
            q = max(0.0, target - on_hand - pipeline)
            if t + L < len(arrivals):
                arrivals[t + L] += q
                pipeline += q
                ordered += q
    # stranded = stock beyond the normal working cover a store holds anyway at baseline demand (1.0/day)
    leftover = max(0.0, on_hand + pipeline - (L + 1) * SAFETY) if holds_inventory else 0.0
    return dict(sold=float(sold), lost=float(lost), leftover=float(leftover), demand=float(dem.sum()))


def run():
    d = pd.read_parquet(DERIVED / "daily.parquet")
    s = pd.read_parquet(DERIVED / "signals.parquet")
    g = pd.read_parquet(RAW / "games.parquet")
    ph = team_phases(g)
    lad = ladder_daily()
    arch = load_archetypes()
    runs = demand_runs(d, ph)
    seasons = sorted({k[0] for k in runs})
    other = {a: b for a, b in zip(seasons, seasons[::-1])}
    league_po_start = {sn: ph[ph.season == sn].po_start.min() for sn in seasons}

    results = []
    for (season, abbr), run in runs.items():
        D = run["D"]
        dates = list(D.index)
        tr = other[season]
        sig = s[(s.season == season) & (s.abbr == abbr) & s.passed].sort_values("h_emit")
        lp = lad[(lad.season == season) & (lad.abbr == abbr)].set_index("date").p_playoffs
        # rung 1: first day P(make playoffs) closed >= 90%
        hit = lp[lp >= 0.9]
        t_ladder = hit.index[0] if len(hit) else None
        rec = dict(
            season=season,
            abbr=abbr,
            champion=run["champion"],
            po_start=run["po_start"].strftime("%Y-%m-%d"),
            po_end=run["po_end"].strftime("%Y-%m-%d"),
            dates=[t.strftime("%Y-%m-%d") for t in dates],
            demand=[round(float(v), 3) for v in D],
            t_ladder=t_ladder.strftime("%Y-%m-%d") if t_ladder is not None else None,
            p_playoffs=[None if pd.isna(lp.get(t)) else round(float(lp.get(t)), 3) for t in dates],
            signals=[
                dict(
                    day0=r.day0.strftime("%Y-%m-%d"),
                    cls=r.cls,
                    dir=int(r.direction),
                    p0=round(r.p_base, 3),
                    p1=round(r.p_emit, 3),
                )
                for r in sig.itertuples()
            ],
            archetypes={},
        )
        # trigger timing (diagnostic)
        D3 = D.rolling(3).mean()
        above = D3[D3 >= 1.5]
        ups = sig[(sig.direction > 0)]
        rec["t_react"] = above.index[0].strftime("%Y-%m-%d") if len(above) else None
        rec["t_first_title_signal"] = ups.day0.iloc[0].strftime("%Y-%m-%d") if len(ups) else None
        for aid, a in arch.items():
            L = a["lead"]
            cm = class_multipliers(s, runs, tr, L)
            po_mult = playoff_start_mult(runs, tr)
            sig_by_day = {r.day0: r for r in sig.itertuples()}
            state = {"mult": 1.0, "until": -1, "dead": False}

            def reactive(t, dem):
                return float(dem[max(0, t - 2) : t + 1].mean())

            def aware(t, dem, state=state):
                base_f = reactive(t, dem)
                day = dates[t]
                r_ = sig_by_day.get(day)
                if r_ is not None:
                    if r_.cls == "elimination":
                        state["dead"] = True
                    elif r_.cls in cm:
                        state["mult"], state["until"] = cm[r_.cls], t + L
                if state["dead"]:
                    return 1.0
                f = base_f * (state["mult"] if t <= state["until"] else 1.0)
                # rung 1: playoff-bound + the (public) league calendar says playoffs start within L+7 days
                if (
                    t_ladder is not None
                    and day >= t_ladder
                    and day >= league_po_start[season] - pd.Timedelta(days=L + 7)
                ):
                    f = max(f, po_mult)
                return f

            def oracle(t, dem):
                return float(dem[min(t + L, len(dem) - 1)]) / SAFETY

            res = {}
            for pol, fn in (("reactive", reactive), ("signal", aware), ("hindsight", oracle)):
                state.update(mult=1.0, until=-1, dead=False)
                res[pol] = simulate(D, L, fn, a["holds_inventory"])
            res["multipliers"] = dict(classes=cm, playoff_start=po_mult, trained_on=tr)
            rec["archetypes"][aid] = res
        results.append(rec)

    summary = {}
    for aid, a in arch.items():
        agg = {pol: dict(sold=0.0, lost=0.0, leftover=0.0, demand=0.0) for pol in ("reactive", "signal", "hindsight")}
        better = 0
        for r in results:
            for pol in agg:
                for k in agg[pol]:
                    agg[pol][k] += r["archetypes"][aid][pol][k]
            m = a["retail"] - a["unit_cost"]
            loss = a["unit_cost"] * (1 - a["salvage_pct"] / 100)
            pr = {
                pol: r["archetypes"][aid][pol]["sold"] * m - r["archetypes"][aid][pol]["leftover"] * loss
                for pol in ("reactive", "signal")
            }
            better += pr["signal"] > pr["reactive"]
        m = a["retail"] - a["unit_cost"]
        loss = a["unit_cost"] * (1 - a["salvage_pct"] / 100)
        prof = {pol: agg[pol]["sold"] * m - agg[pol]["leftover"] * loss for pol in agg}
        summary[aid] = dict(
            n_runs=len(results),
            runs_signal_more_profitable=int(better),
            agg=agg,
            fill_rate={pol: agg[pol]["sold"] / agg[pol]["demand"] for pol in agg},
            profit_per_baseline_unit=prof,
            uplift_vs_reactive=(prof["signal"] - prof["reactive"]) / abs(prof["reactive"])
            if prof["reactive"]
            else None,
        )
    timing = [
        (pd.Timestamp(r["t_react"]) - pd.Timestamp(r["t_first_title_signal"])).days
        for r in results
        if r["t_react"] and r["t_first_title_signal"]
    ]
    ladder_vs_react = [
        (pd.Timestamp(r["t_react"]) - pd.Timestamp(r["t_ladder"])).days
        for r in results
        if r["t_react"] and r["t_ladder"]
    ]
    out = dict(
        archetypes=arch,
        runs=results,
        summary=summary,
        timing=dict(
            title_signal_minus_react=timing,
            ladder_minus_react=ladder_vs_react,
            median_title_signal_lead=float(np.median(timing)) if timing else None,
            median_ladder_lead=float(np.median(ladder_vs_react)) if ladder_vs_react else None,
        ),
    )
    (DERIVED / "merchant.json").write_text(json.dumps(out, default=str))
    return out


if __name__ == "__main__":
    o = run()
    print(
        "runs",
        len(o["runs"]),
        "| days the trigger leads 'own demand +50%':",
        "title-signal median",
        o["timing"]["median_title_signal_lead"],
        "| ladder(make-playoffs>=90%) median",
        o["timing"]["median_ladder_lead"],
    )
    for k, v in o["summary"].items():
        fr = v["fill_rate"]
        pr = v["profit_per_baseline_unit"]
        print(
            f"{k:22s} fill R {fr['reactive']:.0%} S {fr['signal']:.0%} H {fr['hindsight']:.0%} | leftover R {v['agg']['reactive']['leftover']:.0f} S {v['agg']['signal']['leftover']:.0f} "
            f"| profit R {pr['reactive']:.0f} S {pr['signal']:.0f} H {pr['hindsight']:.0f} | uplift {v['uplift_vs_reactive']:+.1%} | S better in {v['runs_signal_more_profitable']}/{v['n_runs']}"
        )
    for r in o["runs"]:
        print(
            r["season"],
            r["abbr"],
            "champ" if r["champion"] else "     ",
            "ladder",
            r["t_ladder"],
            "react",
            r["t_react"],
            "title-sig",
            r["t_first_title_signal"],
            "peak",
            max(r["demand"]),
        )
