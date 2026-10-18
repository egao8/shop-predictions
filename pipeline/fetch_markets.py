"""Hourly title odds for every team: Polymarket CLOB price history and Kalshi candlesticks."""

import json
from concurrent.futures import ThreadPoolExecutor

import pandas as pd

from common import CFG, RAW, SEASONS, TEAM, http_json, team_from_text, to_ts

PM_DIR = RAW / "polymarket"
KX_DIR = RAW / "kalshi"
PM_DIR.mkdir(exist_ok=True)
KX_DIR.mkdir(exist_ok=True)
WINDOW = 10 * 86400


def pm_markets(season):
    cfg = SEASONS[season]
    ev = http_json(f"https://gamma-api.polymarket.com/events?slug={cfg['pm_slug']}")[0]
    (PM_DIR / f"event_{season}.json").write_text(json.dumps(ev))
    out = []
    for m in ev["markets"]:
        abbr = team_from_text(m.get("groupItemTitle") or m.get("question"))
        if not abbr:
            print("  unmapped polymarket market:", m.get("groupItemTitle") or m.get("question"))
            continue
        outcomes = json.loads(m["outcomes"])
        toks = json.loads(m["clobTokenIds"])
        yes_tok = toks[outcomes.index("Yes")]
        out.append(
            dict(
                abbr=abbr,
                token=yes_tok,
                condition=m["conditionId"],
                volume=float(m.get("volume") or 0),
                resolved_yes=json.loads(m["outcomePrices"])[outcomes.index("Yes")] == "1",
            )
        )
    return out


def pm_history(season, mk):
    cfg = SEASONS[season]
    start, end = to_ts(cfg["market_start"]), to_ts(cfg["market_end"]) + 86400
    rows = []
    t = start  # closed markets only return history when startTs/endTs are given
    while t < end:
        t2 = min(t + WINDOW, end)
        d = http_json(
            f"https://clob.polymarket.com/prices-history?market={mk['token']}&startTs={t}&endTs={t2}&fidelity=60"
        )
        rows += d.get("history", [])
        t = t2
    df = pd.DataFrame(rows)
    if df.empty:
        return mk["abbr"], 0
    df = df.drop_duplicates("t").sort_values("t")
    df["ts"] = pd.to_datetime(df["t"], unit="s", utc=True)
    df["abbr"] = mk["abbr"]
    df[["ts", "abbr", "p"]].to_parquet(PM_DIR / f"{season}_{mk['abbr']}.parquet", index=False)
    return mk["abbr"], len(df)


def kalshi_markets(season):
    ev = SEASONS[season]["kalshi_event"]
    if not ev:
        return []
    out, cursor = [], ""
    while True:
        d = http_json(
            f"https://api.elections.kalshi.com/trade-api/v2/historical/markets?event_ticker={ev}&limit=200&cursor={cursor}"
        )
        out += d["markets"]
        cursor = d.get("cursor") or ""
        if not cursor or not d["markets"]:
            break
    (KX_DIR / f"markets_{season}.json").write_text(json.dumps(out))
    return out


def kalshi_history(season, m):
    ticker = m["ticker"]
    suffix = ticker.split("-")[-1]
    abbr = CFG["kalshi_alias"].get(suffix, suffix)
    if abbr not in TEAM:
        return ticker, 0
    open_ts = int(pd.Timestamp(m["open_time"]).timestamp())
    close_ts = int(pd.Timestamp(m["close_time"]).timestamp())
    rows, t = [], open_ts
    while t < close_ts:
        t2 = min(t + 30 * 86400, close_ts)
        try:
            d = http_json(
                f"https://api.elections.kalshi.com/trade-api/v2/historical/markets/{ticker}/candlesticks?start_ts={t}&end_ts={t2}&period_interval=60"
            )
        except Exception:
            d = {}
        for c in d.get("candlesticks", []):
            pr = c.get("price") or {}
            bid = (c.get("yes_bid") or {}).get("close")
            ask = (c.get("yes_ask") or {}).get("close")
            rows.append(
                dict(
                    t=c["end_period_ts"],
                    close=pr.get("close"),
                    mean=pr.get("mean"),
                    bid=bid,
                    ask=ask,
                    volume=c.get("volume"),
                    oi=c.get("open_interest"),
                )
            )
        t = t2
    df = pd.DataFrame(rows)
    if df.empty:
        return ticker, 0
    for c in ["close", "mean", "bid", "ask", "volume", "oi"]:
        df[c] = pd.to_numeric(df[c], errors="coerce")
    df = df.drop_duplicates("t").sort_values("t")
    df["ts"] = pd.to_datetime(df["t"], unit="s", utc=True)
    df["abbr"] = abbr
    df.drop(columns="t").to_parquet(KX_DIR / f"{season}_{abbr}.parquet", index=False)
    return ticker, len(df)


if __name__ == "__main__":
    meta = {}
    for season in SEASONS:
        mks = pm_markets(season)
        meta[season] = mks
        with ThreadPoolExecutor(8) as ex:
            for abbr, n in ex.map(lambda mk: pm_history(season, mk), mks):
                print("pm", season, abbr, n, flush=True)
        kms = kalshi_markets(season)
        with ThreadPoolExecutor(6) as ex:
            for tk, n in ex.map(lambda m: kalshi_history(season, m), kms):
                print("kx", season, tk, n, flush=True)
    (PM_DIR / "markets_meta.json").write_text(json.dumps(meta, indent=1))
