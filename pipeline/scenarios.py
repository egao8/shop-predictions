"""Three-merchant backtest as specified in prereg_v2.json and prereg_v2_amendments.json."""

import hashlib
import json
from pathlib import Path
from statistics import NormalDist

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
PREREG = ROOT / "pipeline" / "prereg_v2.json"
LEAGUES = ["NBA", "NHL", "NFL", "MLB"]
H = 14
TRAIL = 7
RNG = np.random.default_rng(11)
AMEND_A1 = True
CATS = {"title_clinch": "title", "elimination": "eliminated"}


def norm_ppf(p):
    return NormalDist().inv_cdf(p)


def category(cls, direction):
    if cls in CATS:
        return CATS[cls]
    return "good" if direction > 0 else "bad"


def dense_teams(d, thr=0.6):
    nz = d[d.merch.notna()].groupby(["season", "abbr"]).merch.apply(lambda v: (v > 0).mean())
    return set(nz[nz >= thr].index)


def load_league(L):
    D = ROOT / "data" / "derived" / L
    if not (D / "signals.parquet").exists() or not (D / "daily.parquet").exists():
        return None, None
    s = pd.read_parquet(D / "signals.parquet")
    d = pd.read_parquet(D / "daily.parquet")
    if d.merch.notna().sum() == 0:
        return None, None
    s["league"], d["league"] = L, L
    return s, d


def windows(d, h=H, trail=TRAIL):
    """Per team-season arrays of the merch index, for fast window sums."""
    out = {}
    for (season, abbr), x in d.groupby(["season", "abbr"]):
        x = x.sort_values("date")
        out[(season, abbr)] = (pd.DatetimeIndex(x.date), x.merch.to_numpy(dtype=float))
    return out


def event_rows(s, d, h=H, trail=TRAIL):
    W = windows(d)
    dense = dense_teams(d)
    rows = []
    for r in s.itertuples():
        if (r.season, r.abbr) not in dense:
            continue
        idx, v = W[(r.season, r.abbr)]
        if r.day0 not in idx:
            continue
        i = idx.get_loc(r.day0)
        if i - trail < 0 or i + h > len(v):
            continue
        pre = v[i - trail : i]
        win = v[i : i + h]
        if np.isnan(pre).any() or np.isnan(win).any():
            continue
        R0 = pre.mean()
        if R0 < 1:
            continue
        X = win.sum() / R0
        p = min(max(r.p_emit, 1e-3), 1 - 1e-3)
        rows.append(
            dict(
                league=r.league,
                season=r.season,
                abbr=r.abbr,
                sid=r.sid,
                cls=r.cls,
                dir=int(r.direction),
                cat=category(r.cls, r.direction),
                passed=bool(r.passed),
                dlogit=float(r.dlogit),
                lvl=float(np.log(p / (1 - p))),
                p0=float(r.p_base),
                p1=float(r.p_emit),
                day0=r.day0.strftime("%Y-%m-%d"),
                cause=r.cls_detail,
                R0=float(R0),
                X=float(X),
                y=float(np.log(max(X, 1e-3) / h)),
                path=[None if np.isnan(a) else round(float(a / R0), 3) for a in v[max(0, i - trail) : i + h]],
            )
        )
    return pd.DataFrame(rows)


def all_day_y(d, h=H, trail=TRAIL):
    """y on every team-day (event-blind) - what a business-as-usual merchant has learned about its buffer."""
    W = windows(d)
    dense = dense_teams(d)
    out = []
    for (season, abbr), (idx, v) in W.items():
        if (season, abbr) not in dense:
            continue
        cs = np.concatenate([[0], np.nancumsum(np.nan_to_num(v))])
        for i in range(trail, len(v) - h + 1):
            R0 = (cs[i] - cs[i - trail]) / trail
            if R0 < 1:
                continue
            X = (cs[i + h] - cs[i]) / R0
            out.append(dict(league=d.league.iloc[0], season=season, y=np.log(max(X, 1e-3) / h)))
    return pd.DataFrame(out)


def fit_predict(train_ev, train_days, test_ev):
    """Returns yhat and sd per merchant for each test event."""
    out = pd.DataFrame(index=test_ev.index)
    # M0: event-blind buffer
    mu0, sd0 = train_days.y.mean(), train_days.y.std()
    out["m0_mu"], out["m0_sd"] = mu0, sd0
    # M1: headline category
    g = train_ev.groupby("cat").y
    cat_mu, cat_sd = g.mean(), g.std()
    allmu, allsd = train_ev.y.mean(), train_ev.y.std()
    out["m1_mu"] = test_ev.cat.map(cat_mu).fillna(allmu)
    out["m1_sd"] = test_ev.cat.map(cat_sd).fillna(allsd).fillna(allsd)
    # M2: full class stats with fallback to category when <5 training events
    gc = train_ev.groupby("cls").y
    n_c = gc.size()
    ok = set(n_c[n_c >= 5].index)
    cls_mu, cls_sd = gc.mean(), gc.std()
    out["m2_mu"] = [cls_mu[c] if c in ok else out.at[i, "m1_mu"] for i, c in zip(test_ev.index, test_ev.cls)]
    out["m2_sd"] = [cls_sd[c] if c in ok else out.at[i, "m1_sd"] for i, c in zip(test_ev.index, test_ev.cls)]

    # M3: class effects (same fallback) + odds-move size + odds level
    def design(ev):
        key = [c if c in ok else "cat_" + k for c, k in zip(ev.cls, ev.cat)]
        return key

    tr_key = design(train_ev)
    levels = sorted(set(tr_key))

    def X_of(ev, key):
        M = np.zeros((len(ev), len(levels) + 2))
        for j, k in enumerate(key):
            if k in levels:
                M[j, levels.index(k)] = 1.0
        M[:, -2] = ev.dlogit.to_numpy()
        M[:, -1] = ev.lvl.to_numpy()
        return M

    # Amendment A1 (documented in prereg_v2_amendments.json, added after the first NBA run):
    #  (a) never extrapolate: clip odds features to the training range;
    #  (b) a resolved market (odds >98% or <2% after the move) carries no magnitude information -> class-only forecast.
    if AMEND_A1:
        lo_d, hi_d = train_ev.dlogit.min(), train_ev.dlogit.max()
        lo_l, hi_l = train_ev.lvl.min(), train_ev.lvl.max()
        test_ev = test_ev.assign(dlogit=test_ev.dlogit.clip(lo_d, hi_d), lvl=test_ev.lvl.clip(lo_l, hi_l))
    Xtr = X_of(train_ev, tr_key)
    beta, *_ = np.linalg.lstsq(Xtr, train_ev.y.to_numpy(), rcond=None)
    resid = train_ev.y.to_numpy() - Xtr @ beta
    sd3 = float(np.sqrt(resid @ resid / max(len(resid) - Xtr.shape[1], 1)))
    te_key = design(test_ev)
    Xte = X_of(test_ev, te_key)
    # a test class never seen in training gets its category mean instead of a zero intercept
    unseen = [k not in levels for k in te_key]
    yhat = Xte @ beta
    for j, u in enumerate(unseen):
        if u:
            yhat[j] = (
                out.iloc[j]["m1_mu"]
                + beta[-2] * test_ev.dlogit.iloc[j]
                + beta[-1] * (test_ev.lvl.iloc[j] - train_ev.lvl.mean())
            )
    if AMEND_A1:
        resolved = ((test_ev.p1 > 0.98) | (test_ev.p1 < 0.02)).to_numpy()
        yhat = np.where(resolved, out["m2_mu"].to_numpy(), yhat)
    out["m3_mu"], out["m3_sd"] = yhat, sd3
    out["m3_b_dlogit"], out["m3_b_lvl"] = beta[-2], beta[-1]
    return out


def outcomes(ev, fc, cr, h=H):
    z = norm_ppf(cr)
    res = {}
    X = ev.X.to_numpy()
    for m in ("m0", "m1", "m2", "m3"):
        Q = h * np.exp(fc[f"{m}_mu"].to_numpy() + z * fc[f"{m}_sd"].to_numpy())
        res[m] = Q
    res["m4"] = X.copy()
    return res


def profit(Q, X, cu, co):
    return cu * np.minimum(Q, X) - co * np.maximum(Q - X, 0)


def summarize(ev, Qs, cu, co, idx=None, h=H):
    X = ev.X.to_numpy()
    if idx is not None:
        X = X[idx]
        Qs = {k: v[idx] for k, v in Qs.items()}
    P = {m: profit(Q, X, cu, co) for m, Q in Qs.items()}
    U = {m: np.minimum(Q, X) for m, Q in Qs.items()}
    gap = (P["m4"] - P["m0"]).sum()
    cap = {m: float((P[m] - P["m0"]).sum() / gap) if gap > 0 else np.nan for m in P}
    return dict(
        n=len(X),
        captured=cap,
        profit_per_event={m: float(P[m].mean()) for m in P},
        units_vs_m0={m: float(U[m].sum() / U["m0"].sum() - 1) for m in U},
        demand_vs_lastweek=float(X.sum() / (h * len(X)) - 1),
        sold_vs_lastweek={m: float(U[m].sum() / (h * len(X)) - 1) for m in U},
        win_m3_vs_m1=float((P["m3"] >= P["m1"] - 1e-9).mean()),
        win_m3_vs_m2=float((P["m3"] >= P["m2"] - 1e-9).mean()),
    )


def cluster_boot(ev, Qs, cu, co, n=2000):
    clusters = ev.groupby(["league", "season", "abbr"]).indices
    keys = list(clusters)
    d31, d32, caps = [], [], []
    X = ev.X.to_numpy()
    P = {m: profit(Q, X, cu, co) for m, Q in Qs.items()}
    for _ in range(n):
        pick = RNG.integers(0, len(keys), len(keys))
        ix = np.concatenate([clusters[keys[k]] for k in pick])
        gap = (P["m4"][ix] - P["m0"][ix]).sum()
        if gap <= 0:
            continue
        c = {m: (P[m][ix] - P["m0"][ix]).sum() / gap for m in ("m1", "m2", "m3")}
        caps.append(c)
        d31.append(c["m3"] - c["m1"])
        d32.append(c["m3"] - c["m2"])
    caps = pd.DataFrame(caps)

    def q(a, p_):
        return float(np.percentile(a, p_))

    return dict(
        m3_minus_m1=dict(lo=q(d31, 5), hi=q(d31, 95), p=float(np.mean(np.array(d31) <= 0))),
        m3_minus_m2=dict(lo=q(d32, 5), hi=q(d32, 95), p=float(np.mean(np.array(d32) <= 0))),
        ci={m: dict(lo=q(caps[m], 5), hi=q(caps[m], 95)) for m in caps},
    )


def run_split(EV, DAYS, pooled=False, h=H):
    """Leave-one-season-out within league (primary) or pooled across leagues (secondary)."""
    parts = []
    for (L, season), te in EV.groupby(["league", "season"]):
        if pooled:
            tr = EV[~((EV.league == L) & (EV.season == season))]
            trd = DAYS[~((DAYS.league == L) & (DAYS.season == season))]
        else:
            tr = EV[(EV.league == L) & (EV.season != season)]
            trd = DAYS[(DAYS.league == L) & (DAYS.season != season)]
        tr = tr[tr.passed]
        if len(tr) < 10:
            continue
        fc = fit_predict(tr.reset_index(drop=True), trd, te)
        parts.append(pd.concat([te, fc], axis=1))
    return pd.concat(parts) if parts else pd.DataFrame()


def placebo(EV, DAYS, cu, co, cr, n=500):
    """Shuffle odds-move size (and level) among events of the same class, re-fit, re-score M3."""
    ev = EV[EV.passed].copy()
    caps = []
    for _ in range(n):
        sh = ev.copy()
        for _, ix in sh.groupby(["league", "cls"]).indices.items():
            perm = RNG.permutation(ix)
            sh.iloc[ix, sh.columns.get_loc("dlogit")] = ev.iloc[perm]["dlogit"].to_numpy()
            sh.iloc[ix, sh.columns.get_loc("lvl")] = ev.iloc[perm]["lvl"].to_numpy()
        full = pd.concat([sh, EV[~EV.passed]])
        F = run_split(full, DAYS)
        F = F[F.passed]
        Q = outcomes(F, F, cr)
        caps.append(summarize(F, Q, cu, co)["captured"]["m3"])
    return caps


def exploratory(kept, EV):
    """NOT pre-registered; descriptive only, never used for a headline."""
    from scipy.stats import spearmanr

    out = {}
    k = EV[EV.passed]
    for c_ in ("good", "bad"):
        g = k[k.cat == c_]
        if len(g) >= 10:
            rho, p = spearmanr(g.dlogit.abs(), g.y)
            out[f"spearman_absdlogit_vs_demand_{c_}"] = dict(n=len(g), rho=float(rho), p=float(p))

    # in-sample ceiling: how much of y does class explain, and how much more does the odds number add?
    def r2(cols):
        X = pd.get_dummies(k.cls).astype(float)
        X = X.assign(**{c: k[c] for c in cols}) if cols else X
        b, *_ = np.linalg.lstsq(X.to_numpy(), k.y.to_numpy(), rcond=None)
        e = k.y.to_numpy() - X.to_numpy() @ b
        return float(1 - e @ e / ((k.y - k.y.mean()) ** 2).sum())

    out["in_sample_r2_class"] = r2([])
    out["in_sample_r2_class_plus_odds"] = r2(["dlogit", "lvl"])
    # biggest shocks: top quartile of |odds move| among kept events
    q = kept.dlogit.abs().quantile(0.75)
    big = kept[kept.dlogit.abs() >= q]
    return out, big.index.to_numpy()


def main(quick=False):
    prereg_hash = hashlib.sha256(PREREG.read_bytes()).hexdigest()
    spec = json.loads(PREREG.read_text())
    econ = spec["economics_default"]
    cu = econ["retail"] - econ["unit_cost"]
    co = econ["unit_cost"] * (1 - econ["salvage_pct_of_cost"] / 100)
    cr = cu / (cu + co)
    evs, days, coverage, raw = [], [], {}, []
    for L in LEAGUES:
        s, d = load_league(L)
        if s is not None:
            raw.append((s, d))
        if s is None:
            coverage[L] = "no demand data yet"
            continue
        e = event_rows(s, d)
        if e.empty:
            coverage[L] = "no events with usable demand"
            continue
        evs.append(e)
        days.append(all_day_y(d))
        coverage[L] = dict(
            kept_signals=int(s.passed.sum()),
            events_with_demand=int(e.passed.sum()),
            rejected_with_demand=int((~e.passed).sum()),
            teams=int(e.abbr.nunique()),
        )
    EV = pd.concat(evs, ignore_index=True)
    DAYS = pd.concat(days, ignore_index=True)
    res = dict(prereg_sha256=prereg_hash, economics=dict(cu=cu, co=co, cr=cr, **econ), coverage=coverage)

    global AMEND_A1
    AMEND_A1 = False
    F0 = run_split(EV, DAYS)
    k0 = F0[F0.passed].reset_index(drop=True)
    res["original_spec"] = summarize(k0, outcomes(k0, k0, cr), cu, co)
    AMEND_A1 = True
    res["amendments"] = json.loads((ROOT / "pipeline" / "prereg_v2_amendments.json").read_text())
    F = run_split(EV, DAYS)
    kept = F[F.passed].reset_index(drop=True)
    rej = F[~F.passed].reset_index(drop=True)
    Qk = outcomes(kept, kept, cr)
    res["primary"] = summarize(kept, Qk, cu, co)
    res["primary"]["bootstrap"] = cluster_boot(kept, Qk, cu, co, n=500 if quick else 2000)
    res["by_league"] = {}
    for L, g in kept.groupby("league"):
        ix = g.index.to_numpy()
        sm = summarize(kept, Qk, cu, co, idx=ix)
        sub = kept.loc[ix].reset_index(drop=True)
        sm["bootstrap"] = cluster_boot(sub, {m: v[ix] for m, v in Qk.items()}, cu, co, n=300 if quick else 1000)
        sm["b_dlogit"] = float(g.m3_b_dlogit.mean())
        res["by_league"][L] = sm
    res["by_category"] = {}
    for c_, g in kept.groupby("cat"):
        ix = g.index.to_numpy()
        res["by_category"][c_] = summarize(kept, Qk, cu, co, idx=ix)
    if len(rej):
        Qr = outcomes(rej, rej, cr)
        P0 = profit(Qr["m0"], rej.X.to_numpy(), cu, co)
        P3 = profit(Qr["m3"], rej.X.to_numpy(), cu, co)
        res["noise"] = dict(
            n=len(rej), m3_minus_m0_per_event=float((P3 - P0).mean()), m3_worse_share=float((P3 < P0).mean())
        )
    # robustness
    rob = {}
    rob_league = {}

    def by_league(k_, Q_, cu_, co_, h_=H):
        return {
            L: summarize(k_, Q_, cu_, co_, idx=g.index.to_numpy(), h=h_)["captured"] for L, g in k_.groupby("league")
        }

    rob_league["default"] = by_league(kept, Qk, cu, co)
    for crx in (0.5, 0.8):
        cux, cox = crx, 1 - crx
        Qx = outcomes(kept, kept, crx)
        rob[f"cr_{crx}"] = summarize(kept, Qx, cux, cox)["captured"]
        rob_league[f"cr_{crx}"] = by_league(kept, Qx, cux, cox)
    Fp = run_split(EV, DAYS, pooled=True)
    kp = Fp[Fp.passed].reset_index(drop=True)
    rob["pooled_training"] = summarize(kp, outcomes(kp, kp, cr), cu, co)["captured"]
    rob_league["pooled_training"] = by_league(kp, outcomes(kp, kp, cr), cu, co)
    for hh in (7, 21):  # pre-registered window robustness
        EVh = pd.concat([event_rows(s_, d_, h=hh) for s_, d_ in raw], ignore_index=True)
        EVh["y"] = np.log(EVh.X.clip(lower=1e-3) / hh)
        DAYSh = pd.concat([all_day_y(d_, h=hh) for _, d_ in raw], ignore_index=True)
        Fh = run_split(EVh, DAYSh)
        kh = Fh[Fh.passed].reset_index(drop=True)
        Qh = outcomes(kh, kh, cr, h=hh)
        rob[f"window_{hh}d"] = summarize(kh, Qh, cu, co, h=hh)["captured"]
        rob_league[f"window_{hh}d"] = by_league(kh, Qh, cu, co, hh)
    res["robustness"] = rob
    res["robustness_by_league"] = rob_league
    # dollars per event vs business as usual, 20-unit/day store, default economics
    Xk = kept.X.to_numpy()
    Pk = {m: profit(Qk[m], Xk, cu, co) for m in Qk}
    res["dollars_per_event_20u"] = {m: float((Pk[m] - Pk["m0"]).mean() * 20) for m in Pk}
    ex, big_ix = exploratory(kept, EV)
    if len(big_ix) >= 8:
        ex["top_quartile_shocks"] = summarize(kept, Qk, cu, co, idx=big_ix)["captured"] | {"n": int(len(big_ix))}
    res["exploratory"] = ex
    if not quick:
        pl = placebo(EV, DAYS, cu, co, cr, n=200)
        res["placebo"] = dict(
            n=len(pl),
            mean=float(np.mean(pl)),
            p95=float(np.percentile(pl, 95)),
            actual=res["primary"]["captured"]["m3"],
            p=float(np.mean(np.array(pl) >= res["primary"]["captured"]["m3"])),
        )
    # per-event export (forecasts let the page recompute any economics)
    cols = [
        "league",
        "season",
        "abbr",
        "sid",
        "cls",
        "cat",
        "dir",
        "passed",
        "dlogit",
        "p0",
        "p1",
        "day0",
        "cause",
        "X",
        "path",
        "m0_mu",
        "m0_sd",
        "m1_mu",
        "m1_sd",
        "m2_mu",
        "m2_sd",
        "m3_mu",
        "m3_sd",
    ]
    res["events"] = F[cols].assign(X=lambda x: x.X.round(4)).to_dict(orient="records")
    out = ROOT / "data" / "derived" / "scenarios.json"
    out.write_text(json.dumps(res, default=lambda o: None if (isinstance(o, float) and np.isnan(o)) else str(o)))
    return res


if __name__ == "__main__":
    import sys

    r = main(quick="--quick" in sys.argv)
    print("coverage", json.dumps(r["coverage"]))
    p = r["primary"]
    print(f"KEPT n={p['n']}  captured: " + "  ".join(f"{m}={v:+.1%}" for m, v in p["captured"].items()))
    print(
        "  units vs M0:",
        {m: f"{v:+.1%}" for m, v in p["units_vs_m0"].items()},
        " demand vs last week",
        f"{p['demand_vs_lastweek']:+.1%}",
    )
    print("  sold vs last week:", {m: f"{v:+.1%}" for m, v in p["sold_vs_lastweek"].items()})
    print("  win M3>=M1", f"{p['win_m3_vs_m1']:.0%}", "M3>=M2", f"{p['win_m3_vs_m2']:.0%}")
    print("  bootstrap", json.dumps(p["bootstrap"]))
    for L, v in r["by_league"].items():
        print(
            f"  {L}: n={v['n']} "
            + " ".join(f"{m}={c:+.0%}" for m, c in v["captured"].items())
            + f" | M3-M1 p={v['bootstrap']['m3_minus_m1']['p']:.3f} M3-M2 p={v['bootstrap']['m3_minus_m2']['p']:.3f} b_dlogit={v['b_dlogit']:+.3f}"
        )
    for c_, v in r["by_category"].items():
        print(f"  [{c_}] n={v['n']} " + " ".join(f"{m}={c:+.0%}" for m, c in v["captured"].items()))
    print("noise", r.get("noise"), "\nrobust", json.dumps(r["robustness"]), "\nplacebo", r.get("placebo"))
