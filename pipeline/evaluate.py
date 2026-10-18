"""Signal evidence: event study, direction permutation test, dose-response, incremental-information tests."""

import json
import re

import numpy as np
import pandas as pd

from common import DERIVED, RAW
from detect import TITLE_ROUND, series_phase

RNG = np.random.default_rng(7)
PRE = (-11, -2)
WIN = list(range(-5, 15))


def load():
    d = pd.read_parquet(DERIVED / "daily.parquet")
    s = pd.read_parquet(DERIVED / "signals.parquet")
    g = pd.read_parquet(RAW / "games.parquet")
    return d, s, g


def team_phases(g):
    """Per team-season: first playoff (incl. play-in) game date and last game date (ET)."""
    g = g.copy()
    g["date"] = g.tip_utc.dt.tz_convert("America/New_York").dt.tz_localize(None).dt.normalize()
    rows = []
    for season, gs in g.groupby("season"):
        po = gs[gs.season_type.isin([3, 5])]
        for a in set(gs.home) | set(gs.away):
            mine = po[(po.home == a) | (po.away == a)]
            rows.append(
                dict(
                    season=season,
                    abbr=a,
                    po_start=mine.date.min() if len(mine) else pd.NaT,
                    po_end=mine.date.max() if len(mine) else pd.NaT,
                    won_title=bool(len(mine))
                    and mine.iloc[-1].winner == a
                    and series_phase(mine.iloc[-1].note) == TITLE_ROUND,
                )
            )
    return pd.DataFrame(rows)


def matrices(d, col):
    m = {}
    for season, ds in d.groupby("season"):
        w = ds.pivot_table(index="date", columns="abbr", values=col)
        m[season] = np.log1p(w) if col != "wiki" else np.log(w.clip(lower=1))
    return m


def active_teams(d, col, min_mean=None):
    """Teams whose series is dense enough to measure: share of non-zero days among observed days.
    Scale-free (Google normalises each query differently), so it works on stitched series too."""
    if col == "wiki":
        return {s: set(g.abbr) for s, g in d.groupby("season")}
    thr = 0.6 if col == "merch" else 0.5
    nz = d[d[col].notna()].groupby(["season", "abbr"])[col].apply(lambda v: (v > 0).mean())
    return {s: set(nz.loc[s][nz.loc[s] >= thr].index) for s in nz.index.get_level_values(0).unique()}


def ar_path(M, active, season, abbr, day0, exclude=()):
    """Abnormal log demand path for one team around day0 (control = median of other active teams)."""
    w = M[season]
    if abbr not in w or day0 not in w.index:
        return None
    idx = w.index.get_loc(day0)
    lo, hi = idx + PRE[0], idx + WIN[-1]
    if lo < 0 or hi >= len(w):
        return None
    y = w[abbr]
    ctrl_cols = [c for c in active[season] if c != abbr and c not in exclude and c in w]
    if not ctrl_cols:
        return None
    ctrl = w[ctrl_cols].median(axis=1)
    base_y = y.iloc[idx + PRE[0] : idx + PRE[1] + 1].mean()
    base_c = ctrl.iloc[idx + PRE[0] : idx + PRE[1] + 1].mean()
    out = {}
    for k in WIN:
        out[k] = (y.iloc[idx + k] - base_y) - (ctrl.iloc[idx + k] - base_c)
    if np.isnan(list(out.values())).any():
        return None
    return out


def car(path, a, b):
    return float(np.mean([path[k] for k in range(a, b + 1)]))


def event_study(d, s, phases, col):
    M = matrices(d, col)
    act = active_teams(d, col)
    ph = phases.set_index(["season", "abbr"])
    rows = []
    for r in s.itertuples():
        if r.abbr not in act.get(r.season, set()):
            continue
        p = ar_path(M, act, r.season, r.abbr, r.day0, exclude=(r.counterparty,) if r.counterparty else ())
        if p is None:
            continue
        pinfo = ph.loc[(r.season, r.abbr)]
        phase = (
            "playoffs" if pd.notna(pinfo.po_start) and r.day0 >= pinfo.po_start - pd.Timedelta(days=1) else "regular"
        )
        rows.append(
            dict(
                sid=r.sid,
                season=r.season,
                abbr=r.abbr,
                cls=r.cls,
                passed=r.passed,
                direction=r.direction,
                dlogit=r.dlogit,
                move=r.move,
                phase=phase,
                day0=r.day0,
                pre=car(p, -5, -2),
                d0=p[0],
                dm1=p[-1],
                d01=(p[-1] + p[0]) / 2,
                car_1_3=car(p, 1, 3),
                car_1_7=car(p, 1, 7),
                car_2_14=car(p, 2, 14),
                path=[p[k] for k in WIN],
            )
        )
    return pd.DataFrame(rows)


def perm_test(es, metric="car_1_7", n=5000):
    """Mean of direction*CAR vs. the same statistic with directions shuffled within (season, phase)."""
    if len(es) < 4:
        return dict(n=len(es), obs=np.nan, p=np.nan, null_mean=np.nan, null_sd=np.nan)
    obs = float((es.direction * es[metric]).mean())
    groups = [g.index.to_numpy() for _, g in es.groupby(["season", "phase"])]
    dirs = es.direction.to_numpy()
    vals = es[metric].to_numpy()
    null = np.empty(n)
    for i in range(n):
        dd = dirs.copy()
        for gi in groups:
            dd[gi] = RNG.permutation(dd[gi])
        null[i] = (dd * vals).mean()
    return dict(
        n=len(es),
        obs=obs,
        p=float((null >= obs).mean()),
        null_mean=float(null.mean()),
        null_sd=float(null.std()),
        hit_rate=float((np.sign(es[metric]) == es.direction).mean()),
    )


def slope(es, y="car_1_7", x="dlogit"):
    if len(es) < 5:
        return dict(n=len(es), b=np.nan, t=np.nan, r=np.nan)
    X = es[x].to_numpy()
    Y = es[y].to_numpy()
    X1 = np.c_[np.ones_like(X), X]
    beta, *_ = np.linalg.lstsq(X1, Y, rcond=None)
    res = Y - X1 @ beta
    s2 = res @ res / max(len(Y) - 2, 1)
    # HC1 robust se
    XtX = np.linalg.pinv(X1.T @ X1)
    meat = (X1 * res[:, None] ** 2).T @ X1 * len(Y) / max(len(Y) - 2, 1)
    se = np.sqrt(np.diag(XtX @ meat @ XtX))
    return dict(n=len(es), b=float(beta[1]), t=float(beta[1] / se[1]), r=float(np.corrcoef(X, Y)[0, 1]), s2=float(s2))


def panel(d, g, phases, col="merch"):
    g = g.copy()
    g["date"] = g.tip_utc.dt.tz_convert("America/New_York").dt.tz_localize(None).dt.normalize()
    act = active_teams(d, col)
    rows = []
    for (season, a), x in d.groupby(["season", "abbr"]):
        if a not in act[season]:
            continue
        x = x.sort_values("date").set_index("date")
        y = np.log1p(x[col])
        lw = np.log(x.wiki.clip(lower=1))
        p = x.p_close.clip(1e-3, 1 - 1e-3)
        lp = np.log(p / (1 - p))
        mine = g[((g.home == a) | (g.away == a)) & (g.season == season)].set_index("date")
        res = pd.DataFrame(index=x.index)
        res["fut"] = y.shift(-1).rolling(7).mean().shift(-6) - y.rolling(7).mean()
        res["mom"] = y.rolling(3).mean() - y.shift(3).rolling(7).mean()
        res["att"] = lw - lw.shift(1).rolling(7).mean()
        res["att_mom"] = lw.rolling(3).mean() - lw.shift(3).rolling(7).mean()
        res["lvl"] = p
        res["dlogit3"] = lp - lp.shift(3)
        res["dp3"] = p - p.shift(3)
        wins = pd.Series(0.0, index=x.index)
        losses = pd.Series(0.0, index=x.index)
        clinch = pd.Series(0.0, index=x.index)
        elim = pd.Series(0.0, index=x.index)
        for dt_, gr in mine.iterrows():
            if dt_ not in wins.index:
                continue
            won = gr.winner == a
            wins[dt_] += won
            losses[dt_] += not won
            if re.search(r"\bwins? series", (gr.series_summary or "").lower()):
                clinch[dt_] += won
                elim[dt_] += not won
        res["w3"] = wins.rolling(3).sum()
        res["l3"] = losses.rolling(3).sum()
        res["clinch3"] = clinch.rolling(3).sum()
        res["elim3"] = elim.rolling(3).sum()
        ph = phases[(phases.season == season) & (phases.abbr == a)].iloc[0]
        res["po"] = (
            ((x.index >= ph.po_start) & (x.index <= ph.po_end + pd.Timedelta(days=1))).astype(float)
            if pd.notna(ph.po_start)
            else 0.0
        )
        res["season"], res["abbr"] = season, a
        rows.append(res.reset_index())
    P = pd.concat(rows, ignore_index=True).dropna()
    # remove common shocks: demean every variable by date (cross-team), i.e. date fixed effects
    num = [c for c in P.columns if c not in ("date", "season", "abbr")]
    P[num] = P[num] - P.groupby(["season", "date"])[num].transform("mean")
    return P


BASE_X = ["mom", "att", "att_mom", "lvl", "w3", "l3", "clinch3", "elim3", "po"]
ODDS_X = ["dlogit3"]


def ols(P, xs, y="fut"):
    X = np.c_[np.ones(len(P)), P[xs].to_numpy()]
    b, *_ = np.linalg.lstsq(X, P[y].to_numpy(), rcond=None)
    return b


def r2(P, xs, b, y="fut"):
    X = np.c_[np.ones(len(P)), P[xs].to_numpy()]
    e = P[y].to_numpy() - X @ b
    return 1 - (e @ e) / ((P[y] - P[y].mean()) ** 2).sum()


def cluster_t(P, xs, y="fut", cluster="abbr"):
    X = np.c_[np.ones(len(P)), P[xs].to_numpy()]
    b, *_ = np.linalg.lstsq(X, P[y].to_numpy(), rcond=None)
    e = P[y].to_numpy() - X @ b
    XtX = np.linalg.pinv(X.T @ X)
    meat = np.zeros((X.shape[1], X.shape[1]))
    for _, ix in P.groupby(cluster).indices.items():
        sx = X[ix].T @ e[ix]
        meat += np.outer(sx, sx)
    G = P[cluster].nunique()
    V = XtX @ meat @ XtX * G / max(G - 1, 1)
    return dict(zip(["const"] + xs, b)), dict(zip(["const"] + xs, b / np.sqrt(np.diag(V))))


def incremental(P):
    out = {}
    seasons = sorted(P.season.unique())
    full = BASE_X + ODDS_X
    for scope, Q in (("all_days", P), ("playoff_days", P[P.po > 0])):
        res = {}
        for tr in seasons:
            te = [s for s in seasons if s != tr][0]
            A, B = Q[Q.season == tr], Q[Q.season == te]
            if len(A) < 50 or len(B) < 50:
                continue
            bA = ols(A, BASE_X)
            bB = ols(A, full)
            res[f"train_{tr}_test_{te}"] = dict(
                n_train=len(A), n_test=len(B), r2_base=float(r2(B, BASE_X, bA)), r2_odds=float(r2(B, full, bB))
            )
        coef, t = cluster_t(Q, full)
        out[scope] = dict(
            oos=res, coef={k: float(v) for k, v in coef.items()}, t={k: float(v) for k, v in t.items()}, n=len(Q)
        )
    return out


def capture_shares(es, d, lead_days):
    """For up-moves in the playoffs: share of positive excess (level) demand in days 0..14 arriving at/after day L."""
    out = {}
    up = es[(es.passed) & (es.direction > 0)]
    for name, L in lead_days.items():
        shares = []
        for r in up.itertuples():
            path = np.array(r.path)
            post = np.exp(path[5:]) - 1  # WIN starts at -5 -> index 5 is day 0
            post = np.clip(post, 0, None)
            tot = post.sum()
            if tot <= 0:
                continue
            Lc = int(np.ceil(L))
            shares.append(post[Lc:].sum() / tot if Lc < len(post) else 0.0)
        out[name] = dict(lead_days=L, mean_share=float(np.mean(shares)) if shares else np.nan, n=len(shares))
    return out


def beyond_reaction(es_m, es_w):
    """CAR[2,14] (merch) ~ dlogit + day-0 merch reaction + day-0 & day1-3 attention + class dummies (passed signals).
    If dlogit survives, the odds move carries information beyond the public reaction to the same news."""
    # controls must be observable when the merchant acts (end of day 0): demand & attention on days -1 and 0 only
    w = es_w.set_index("sid")[["d0", "dm1"]].rename(columns={"d0": "att_d0", "dm1": "att_dm1"})
    m = es_m[es_m.passed].set_index("sid").join(w, how="inner").reset_index()
    if len(m) < 15:
        return {}
    for c_ in ["playoff_win", "playoff_loss", "elimination", "series_clinch", "news", "rival_game"]:
        m[f"is_{c_}"] = (m.cls == c_).astype(float)
    out = {}
    specs = {
        "odds_only": ["dlogit"],
        "reaction_only": ["d0", "dm1", "att_d0", "att_dm1"],
        "reaction_plus_odds": ["d0", "dm1", "att_d0", "att_dm1", "dlogit"],
        "reaction_class_plus_odds": [
            "d0",
            "dm1",
            "att_d0",
            "att_dm1",
            "is_playoff_win",
            "is_playoff_loss",
            "is_elimination",
            "is_series_clinch",
            "is_news",
            "dlogit",
        ],
    }
    for name, xs in specs.items():
        xs = [x for x in xs if m[x].std() > 0]
        coef, t = cluster_t(m, xs, y="car_2_14", cluster="abbr")
        X = np.c_[np.ones(len(m)), m[xs].to_numpy()]
        b, *_ = np.linalg.lstsq(X, m["car_2_14"].to_numpy(), rcond=None)
        e = m["car_2_14"].to_numpy() - X @ b
        out[name] = dict(
            n=len(m),
            r2=float(1 - e @ e / ((m.car_2_14 - m.car_2_14.mean()) ** 2).sum()),
            coef={k: float(v) for k, v in coef.items()},
            t={k: float(v) for k, v in t.items()},
        )
    # leave-one-team-out predictive check: does adding dlogit reduce out-of-sample error?
    errs = {"reaction": [], "reaction_plus_odds": []}
    for a in m.abbr.unique():
        tr, te = m[m.abbr != a], m[m.abbr == a]
        for name, xs in (
            ("reaction", ["d0", "dm1", "att_d0", "att_dm1"]),
            ("reaction_plus_odds", ["d0", "dm1", "att_d0", "att_dm1", "dlogit"]),
        ):
            b = ols(tr, xs, "car_2_14")
            X = np.c_[np.ones(len(te)), te[xs].to_numpy()]
            errs[name] += list(te["car_2_14"].to_numpy() - X @ b)
    out["loto_rmse"] = {k: float(np.sqrt(np.mean(np.square(v)))) for k, v in errs.items()}
    return out


def run():
    d, s, g = load()
    phases = team_phases(g)
    results = {"generated": pd.Timestamp.now().isoformat(), "params": {}}
    es_all = {}
    for col in ["merch", "wiki", "tickets", "watch", "hotel"]:
        es = event_study(d, s, phases, col)
        if es.empty:
            continue
        es_all[col] = es
        r = {"n_teams": int(es.abbr.nunique())}
        for lab, sub in (("passed", es[es.passed]), ("rejected", es[~es.passed]), ("all", es)):
            r[lab] = {m: perm_test(sub.reset_index(drop=True), m) for m in ["d0", "car_1_3", "car_1_7", "car_2_14"]}
            r[lab]["slope_1_7"] = slope(sub)
            r[lab]["slope_2_14"] = slope(sub, "car_2_14")
            r[lab]["pre"] = perm_test(sub.reset_index(drop=True), "pre")
        byc = {}
        for c_, sub in es[es.passed].groupby("cls"):
            byc[c_] = dict(
                n=len(sub),
                mean_dir_car_1_7=float((sub.direction * sub.car_1_7).mean()),
                mean_dir_car_2_14=float((sub.direction * sub.car_2_14).mean()),
                hit_1_7=float((np.sign(sub.car_1_7) == sub.direction).mean()),
                mean_path_up=np.mean(np.stack(sub[sub.direction > 0].path), axis=0).tolist()
                if (sub.direction > 0).any()
                else None,
                mean_path_down=np.mean(np.stack(sub[sub.direction < 0].path), axis=0).tolist()
                if (sub.direction < 0).any()
                else None,
            )
        r["by_class"] = byc
        for lab, sub in (("up", es[es.passed & (es.direction > 0)]), ("down", es[es.passed & (es.direction < 0)])):
            if len(sub):
                P = np.stack(sub.path)
                boots = np.stack([P[RNG.integers(0, len(P), len(P))].mean(axis=0) for _ in range(2000)])
                r[f"path_{lab}"] = dict(
                    n=len(sub),
                    mean=P.mean(axis=0).tolist(),
                    lo=np.percentile(boots, 5, axis=0).tolist(),
                    hi=np.percentile(boots, 95, axis=0).tolist(),
                )
        results[col] = r
    if "merch" in es_all and "wiki" in es_all:
        results["beyond_reaction"] = beyond_reaction(es_all["merch"], es_all["wiki"])
    P = panel(d, g, phases, "merch")
    results["incremental_merch"] = incremental(P)
    lead = (
        json.loads((RAW.parent.parent / "research" / "execution_leadtimes.json").read_text())
        if (RAW.parent.parent / "research" / "execution_leadtimes.json").exists()
        else None
    )
    lead_days = (
        {a["id"]: a.get("can_act_on_signal_within_days") for a in lead["archetypes"]}
        if lead
        else {"pod": 1, "dtf_inhouse": 2, "screenprint_contract": 5, "licensed_reseller": 14}
    )
    lead_days = {k: v for k, v in lead_days.items() if v is not None}
    if "merch" in es_all:
        results["capture_merch"] = capture_shares(es_all["merch"], d, lead_days)
        es_all["merch"].to_parquet(DERIVED / "event_study_merch.parquet", index=False)
    if "wiki" in es_all:
        es_all["wiki"].to_parquet(DERIVED / "event_study_wiki.parquet", index=False)
    P.to_parquet(DERIVED / "panel_merch.parquet", index=False)
    (DERIVED / "results.json").write_text(json.dumps(results, indent=1, default=float))
    return results


if __name__ == "__main__":
    r = run()
    for col in ["merch", "wiki"]:
        if col not in r:
            continue
        print(f"== {col}")
        for lab in ["passed", "rejected", "all"]:
            x = r[col][lab]
            print(
                f"  {lab:9s} n={x['car_1_7']['n']:3d}  d0 {x['d0']['obs']:+.3f} (p={x['d0']['p']:.3f})  "
                f"CAR1-7 {x['car_1_7']['obs']:+.3f} (p={x['car_1_7']['p']:.3f}, hit {x['car_1_7']['hit_rate']:.2f})  "
                f"CAR2-14 {x['car_2_14']['obs']:+.3f} (p={x['car_2_14']['p']:.3f})  pre {x['pre']['obs']:+.3f} (p={x['pre']['p']:.2f})  "
                f"slope1-7 b={x['slope_1_7']['b']:+.3f} t={x['slope_1_7']['t']:+.2f}"
            )
        for c_, v in r[col]["by_class"].items():
            print(
                f"    {c_:14s} n={v['n']:3d} dirCAR1-7 {v['mean_dir_car_1_7']:+.3f} dirCAR2-14 {v['mean_dir_car_2_14']:+.3f} hit {v['hit_1_7']:.2f}"
            )
    print(json.dumps(r["incremental_merch"], indent=1)[:2500])
    print(r.get("capture_merch"))
    print(json.dumps(r.get("beyond_reaction"), indent=1)[:3000])
