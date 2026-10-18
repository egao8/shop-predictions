"""Causal signal detection, denoising gates and event classification.

A candidate fires when P(title) moves >= th_abs (and >= th_logit in log-odds) over 24h for a team with
P >= p_min, and is emitted hold_h hours later only if >= `retain` of the move held. Columns prefixed
ex_post_ look past the emission time and are for evaluation only.
"""

import json
import re
from concurrent.futures import ThreadPoolExecutor

import numpy as np
import pandas as pd
import requests

from common import CFG, DERIVED, EAST, GAME_HOURS, RAW, SEASONS

ET = "America/New_York"
TRADES_CACHE = RAW / "pm_trades"
TRADES_CACHE.mkdir(exist_ok=True)

AMEND_A2 = True
DEFAULT = dict(th_abs=0.03, th_logit=0.20, p_min=0.02, hold_h=6, retain=0.5, cooldown_h=24)


def logit(p):
    p = np.clip(p, 1e-3, 1 - 1e-3)
    return np.log(p / (1 - p))


def load():
    pm = pd.read_parquet(DERIVED / "pm_hourly.parquet")
    kx = pd.read_parquet(DERIVED / "kx_hourly.parquet")
    games = pd.read_parquet(RAW / "games.parquet")
    return pm, kx, games


def candidates(pm, prm=DEFAULT):
    out = []
    for (season, abbr), g in pm.groupby(["season", "abbr"]):
        g = g.sort_values("h").reset_index(drop=True)
        g["p"] = g.p.rolling(3, min_periods=1).median()  # causal: kills single-print glitches
        g = g[g.h >= pd.Timestamp(SEASONS[season]["analysis_start"], tz="UTC") - pd.Timedelta(hours=24)].reset_index(
            drop=True
        )
        p = g.p.to_numpy()
        hrs = g.h.to_numpy()
        n = len(p)
        lg = logit(p)
        next_ok = 0
        H = prm["hold_h"]
        for i in range(24, n - H):
            if i < next_ok or np.isnan(p[i]) or np.isnan(p[i - 24]):
                continue
            d = p[i] - p[i - 24]
            if abs(d) < prm["th_abs"] or abs(lg[i] - lg[i - 24]) < prm["th_logit"]:
                continue
            if max(p[i], p[i - 24]) < prm["p_min"]:
                continue
            base = p[i - 24]
            # onset: start of the final leg = first hour after which >=25% of the move (signed) is held through h
            seg = (p[i - 24 : i + 1] - base) * np.sign(d)
            below = np.where(seg < 0.25 * abs(d))[0]
            onset_k = int(below[-1] + 1) if len(below) else 0
            onset = i - 24 + onset_k
            retained = (p[i + H] - base) / d
            settled = p[i + H] - base
            persistent = retained >= prm["retain"]
            whipsaw = False
            # In-game whipsaw (e.g. down big, then a win): if the settled move at emission qualifies on its own,
            # emit it in that direction. Still causal: only prices up to the emission hour are used.
            if not persistent and abs(settled) >= prm["th_abs"] and abs(lg[i + H] - lg[i - 24]) >= prm["th_logit"]:
                persistent, whipsaw = True, True
                d = settled
                retained = 1.0
            rec = dict(
                season=season,
                abbr=abbr,
                h_cross=pd.Timestamp(hrs[i]),
                h_onset=pd.Timestamp(hrs[onset]),
                h_emit=pd.Timestamp(hrs[i + H]),
                p_base=base,
                p_cross=p[i],
                p_emit=p[i + H],
                move_cross=d,
                retained_at_emit=retained,
                persistent=persistent,
                whipsaw=whipsaw,
            )
            # evaluation-only: how much of the move survived 24h / 72h / 7d after emission
            for lab, k in (("24h", 24), ("72h", 72), ("7d", 168)):
                j = i + H + k
                rec[f"ex_post_retained_{lab}"] = (p[j] - base) / d if j < n else np.nan
            out.append(rec)
            next_ok = i + H + prm["cooldown_h"]  # next window may not overlap this move
    c = pd.DataFrame(out)
    c["move"] = c.p_emit - c.p_base  # move as known at emission
    c["dlogit"] = logit(c.p_emit) - logit(c.p_base)
    c["direction"] = np.sign(c.move_cross).astype(int)
    return c


def add_kalshi(c, kx):
    kxi = kx.set_index(["season", "abbr", "h"]).sort_index()

    def kval(season, abbr, h):
        try:
            v = kxi.loc[(season, abbr, h)]
            return v.p, v.volume
        except KeyError:
            return np.nan, np.nan

    kb, ke, kvol = [], [], []
    for r in c.itertuples():
        b, _ = kval(r.season, r.abbr, r.h_cross - pd.Timedelta(hours=24))
        e, _ = kval(r.season, r.abbr, r.h_emit)
        sub = kxi.loc[(r.season, r.abbr)] if (r.season, r.abbr) in kxi.index.droplevel(2) else None
        if sub is not None:
            w = sub.loc[r.h_cross - pd.Timedelta(hours=24) : r.h_emit]
            pre = sub.loc[r.h_cross - pd.Timedelta(days=15) : r.h_cross - pd.Timedelta(hours=25)]
            vz = (w.volume.sum() / max(len(w), 1)) / max(pre.volume.mean(), 1e-9) if len(pre) else np.nan
        else:
            vz = np.nan
        kb.append(b)
        ke.append(e)
        kvol.append(vz)
    c["kx_base"], c["kx_emit"], c["kx_vol_ratio"] = kb, ke, kvol
    c["kx_move"] = c.kx_emit - c.kx_base
    has = c.kx_base.notna() & c.kx_emit.notna() & (c.kx_base > 0)
    c["kx_available"] = has
    c["kx_confirm"] = np.where(
        has, (np.sign(c.kx_move) == c.direction) & (c.kx_move.abs() >= 0.5 * c.move.abs()), np.nan
    )
    return c


def add_field(c, pm):
    """How the rest of the field repriced over the same window (real news redistributes probability)."""
    w = pm.pivot_table(index=["season", "h"], columns="abbr", values="p")
    absorb, mirror_team, mirror_move = [], [], []
    for r in c.itertuples():
        try:
            a = w.loc[(r.season, r.h_cross - pd.Timedelta(hours=24))]
            b = w.loc[(r.season, r.h_emit)]
        except KeyError:
            absorb.append(np.nan)
            mirror_team.append(None)
            mirror_move.append(np.nan)
            continue
        d = (b - a).drop(r.abbr)
        absorb.append(float(-d.sum() / r.move) if r.move else np.nan)
        j = (d * -r.direction).idxmax()  # team that moved most in the opposite direction
        mirror_team.append(j)
        mirror_move.append(float(d[j]))
    c["field_absorption"], c["mirror_team"], c["mirror_move"] = absorb, mirror_team, mirror_move
    return c


TITLE_ROUND = "Title round"


def series_phase(note: str):
    """Round name from ESPN's game note, across NBA / NHL / NFL / MLB."""
    n = (note or "").lower()
    if any(k in n for k in ("nba finals", "stanley cup final", "world series", "super bowl")):
        return TITLE_ROUND
    for key, lab in (
        ("play-in", "Play-In"),
        ("wild card", "Wild Card"),
        ("1st round", "First Round"),
        ("first round", "First Round"),
        ("semifinal", "Round 2"),
        ("2nd round", "Round 2"),
        ("second round", "Round 2"),
        ("division series", "Round 2"),
        ("divisional", "Divisional"),
        ("east final", "Conf. Final"),
        ("west final", "Conf. Final"),
        ("conference final", "Conf. Final"),
        ("championship series", "Conf. Final"),
        ("alcs", "Conf. Final"),
        ("nlcs", "Conf. Final"),
        ("afc championship", "Conf. Final"),
        ("nfc championship", "Conf. Final"),
    ):
        if key in n:
            return lab
    return "Playoffs"


def decided(x):
    """Did this postseason game end the series? (NFL playoff games are single elimination.)"""
    return CFG["single_game_playoffs"] or bool(re.search(r"\bwins? series", (x.series_summary or "").lower()))


POST_GAME_LAG_H = 3  # amendment A2: thin markets finish repricing a few hours after the game ends


def _series_lookup(pm):
    out = {}
    for (season, abbr), g in pm.groupby(["season", "abbr"]):
        out[(season, abbr)] = g.set_index("h").p.sort_index().rolling(3, min_periods=1).median()
    return out


def _share_in_window(ser, base_t, emit_t, w0, w1, move):
    """Share of the move (base_t -> emit_t) that happened inside [w0, w1] (causal: all times <= emit_t)."""
    a, b = max(base_t, w0), min(emit_t, w1)
    if a >= b or not move:
        return 0.0
    pa = ser.asof(a)
    pb = ser.asof(b)
    return float((pb - pa) / move)


def classify(c, games, pm=None):
    g = games.copy()
    S_ = _series_lookup(pm) if pm is not None else {}
    rows = []
    for r in c.itertuples():
        if AMEND_A2 and (r.season, r.abbr) in S_:
            # amendment A2: a game explains the move if >=50% of the move happened inside its window
            ser = S_[(r.season, r.abbr)]
            base_t = r.h_cross - pd.Timedelta(hours=24)
            move = r.p_emit - r.p_base
            # only games that were over before the signal fired (their result was public at emission)
            cand = g[
                (g.tip_utc >= base_t - pd.Timedelta(hours=GAME_HOURS + POST_GAME_LAG_H))
                & (g.tip_utc + pd.Timedelta(hours=3.5) <= r.h_emit)
            ]
            cand = cand.assign(
                share=[
                    _share_in_window(
                        ser,
                        base_t,
                        r.h_emit,
                        t - pd.Timedelta(hours=1),
                        t + pd.Timedelta(hours=GAME_HOURS + POST_GAME_LAG_H),
                        move,
                    )
                    for t in cand.tip_utc
                ]
            )
            win = cand[cand.share >= 0.5]
        else:
            # original rule: the move must have started while a game was being played (or <2h after)
            win = g[
                (g.tip_utc - pd.Timedelta(hours=1) <= r.h_onset)
                & (r.h_onset <= g.tip_utc + pd.Timedelta(hours=GAME_HOURS))
            ]
        own = win[(win.home == r.abbr) | (win.away == r.abbr)]
        if len(own):
            x = own.iloc[-1]
            won = x.winner == r.abbr
            o = x.away if x.home == r.abbr else x.home
            summ = x.series_summary or ""
            if x.season_type == 3:
                ph = series_phase(x.note)
                wins_series = decided(x)
                tag = f" ({summ})" if summ else f" ({x.note})" if x.note else ""
                if wins_series and won and ph == TITLE_ROUND:
                    k, dsc = "title_clinch", f"Won the {CFG['cup']} vs {o}{tag}"
                elif wins_series and won:
                    k, dsc = "series_clinch", f"Won {ph} vs {o}{tag}"
                elif wins_series and not won:
                    k, dsc = "elimination", f"Eliminated in {ph} by {o}{tag}"
                else:
                    k, dsc = ("playoff_win" if won else "playoff_loss"), f"{ph} {'W' if won else 'L'} vs {o} ({summ})"
            elif x.season_type == 5:
                k, dsc = ("playin_win" if won else "playin_loss"), f"Play-in {'W' if won else 'L'} vs {o}"
            else:
                k, dsc = (
                    ("regular_win" if won else "regular_loss"),
                    f"Regular season {'W' if won else 'L'} vs {o} {x.home_score}-{x.away_score}",
                )
            rows.append((k, dsc, x.game_id, o))
            continue
        # rival game: a team that moved opposite to us played in the window
        rv = win[(win.home == r.mirror_team) | (win.away == r.mirror_team)] if r.mirror_team else win.iloc[0:0]
        if len(rv) and abs(r.mirror_move or 0) >= 0.4 * abs(r.move):
            x = rv.iloc[-1]
            won = x.winner == r.mirror_team
            summ = x.series_summary or ""
            elim = (x.season_type == 3 and decided(x)) and not won
            vs = x.away if x.home == r.mirror_team else x.home
            dsc = (
                f"{r.mirror_team} {'W' if won else 'L'} vs {vs}"
                + (f" ({summ})" if summ else "")
                + (" - rival eliminated" if elim else "")
            )
            rows.append(("rival_game", dsc, x.game_id, r.mirror_team))
            continue
        rows.append(("news", "No game in window - off-court news (injury / trade / other)", None, None))
    c["cls"], c["cls_detail"], c["game_id"], c["counterparty"] = map(list, zip(*rows))
    return c


def _condition_ids():
    m = json.loads((RAW / "polymarket" / "markets_meta.json").read_text())
    return {(s, x["abbr"]): x["condition"] for s, xs in m.items() for x in xs}


def trades_window(season, abbr, cond, t0, t1):
    key = TRADES_CACHE / f"{season}_{abbr}_{int(t0.timestamp())}_{int(t1.timestamp())}.json"
    if key.exists():
        return json.loads(key.read_text())
    rows, offset = [], 0
    while offset <= 9500:
        for k in range(5):
            try:
                r = requests.get(
                    "https://data-api.polymarket.com/trades",
                    params=dict(
                        market=cond,
                        start=int(t0.timestamp()),
                        end=int(t1.timestamp()),
                        limit=500,
                        offset=offset,
                        takerOnly="false",
                    ),
                    timeout=40,
                )
                if r.status_code == 200:
                    break
            except Exception:
                pass
            import time

            time.sleep(2**k)
        else:
            break
        batch = r.json() if r.status_code == 200 else []
        rows += [
            dict(
                w=x["proxyWallet"],
                side=x["side"],
                o=x.get("outcome"),
                size=x["size"],
                price=x["price"],
                t=x["timestamp"],
            )
            for x in batch
        ]
        if len(batch) < 500:
            break
        offset += 500
    key.write_text(json.dumps(rows))
    return rows


def breadth(c):
    conds = _condition_ids()

    def one(r):
        cond = conds.get((r.season, r.abbr))
        t0 = r.h_onset - pd.Timedelta(hours=1)
        t1 = r.h_cross + pd.Timedelta(hours=1)
        rows = trades_window(r.season, r.abbr, cond, t0, t1)
        if not rows:
            return dict(n_trades=0, n_wallets=0, notional=0.0, top1_share=np.nan, top3_share=np.nan, capped=False)
        df = pd.DataFrame(rows)
        df["usd"] = df["size"] * df["price"]
        # direction of each fill in YES terms: BUY Yes / SELL No push P(yes) up
        yes_up = ((df.side == "BUY") & (df.o == "Yes")) | ((df.side == "SELL") & (df.o == "No"))
        df["dir"] = np.where(yes_up, 1, -1)
        with_move = df[df.dir == r.direction]
        by_w = with_move.groupby("w").usd.sum().sort_values(ascending=False)
        tot = by_w.sum()
        return dict(
            n_trades=len(df),
            n_wallets=df.w.nunique(),
            notional=float(df.usd.sum()),
            top1_share=float(by_w.iloc[0] / tot) if tot > 0 else np.nan,
            top3_share=float(by_w.iloc[:3].sum() / tot) if tot > 0 else np.nan,
            capped=len(df) >= 9900,
        )

    with ThreadPoolExecutor(6) as ex:
        res = list(ex.map(one, c.itertuples()))
    return pd.concat([c.reset_index(drop=True), pd.DataFrame(res)], axis=1)


def gate(c):
    """Denoising decision using only info available at emission."""
    reasons = []
    keep = []
    for r in c.itertuples():
        why = []
        if not r.persistent:
            why.append("reverted before confirmation")
        if r.kx_available and r.kx_confirm == 0:
            why.append("Kalshi did not confirm")
        whale = (r.top1_share >= 0.6) and (r.n_wallets <= 15)
        if whale and r.cls == "news":
            why.append("single-wallet move with no on-court event")
        if r.n_trades < 5:
            why.append("too few trades")
        keep.append(len(why) == 0)
        reasons.append("; ".join(why))
    c["passed"] = keep
    c["reject_reason"] = reasons
    c["whale_flag"] = (c.top1_share >= 0.6) & (c.n_wallets <= 15)
    return c


def run(prm=DEFAULT, with_breadth=True):
    pm, kx, games = load()
    c = candidates(pm, prm)
    c = add_kalshi(c, kx)
    c = add_field(c, pm)
    c = classify(c, games, pm)
    if with_breadth:
        c = breadth(c)
    else:
        for k in ("n_trades", "n_wallets", "notional", "top1_share", "top3_share"):
            c[k] = np.nan
        c["n_trades"] = 99
    c = gate(c)
    c["emit_et"] = c.h_emit.dt.tz_convert(ET)
    c["day0"] = c.emit_et.dt.tz_localize(None).dt.normalize()
    c["conf"] = np.where(c.abbr.isin(EAST), "East", "West")
    c["sid"] = c.season.str[-2:] + "-" + c.abbr + "-" + c.h_emit.dt.strftime("%m%d%H")
    return c


if __name__ == "__main__":
    import sys

    c = run(with_breadth="--no-breadth" not in sys.argv)
    c.to_parquet(DERIVED / "signals.parquet", index=False)
    teams = {s_: sorted(g_.abbr.unique()) for s_, g_ in c.groupby("season")}
    (DERIVED / "trends_teams.json").write_text(json.dumps(teams))
    pd.set_option("display.width", 220)
    print(len(c), "candidates;", int(c.passed.sum()), "passed")
    print(c.groupby(["season", "cls"]).agg(n=("sid", "size"), passed=("passed", "sum")))
    print(c.reject_reason.value_counts().head(10))
    big = c[c.passed].reindex(c[c.passed].move.abs().sort_values(ascending=False).index).head(25)
    print(big[["sid", "p_base", "p_emit", "cls", "cls_detail", "kx_confirm", "n_wallets", "top1_share"]].to_string())
