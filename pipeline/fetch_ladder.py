"""Polymarket 'make the playoffs' markets (NBA only), hourly."""

import json
from concurrent.futures import ThreadPoolExecutor

import pandas as pd

from common import RAW, http_json, team_from_text, to_ts

OUT = RAW / "polymarket_playoffs"
OUT.mkdir(exist_ok=True)
EVENTS = {"2024-25": "which-teams-will-make-the-nba-playoffs", "2025-26": "which-teams-will-make-the-nba-playoffs-138"}


def markets(season):
    ev = http_json(f"https://gamma-api.polymarket.com/events?slug={EVENTS[season]}")[0]
    (OUT / f"event_{season}.json").write_text(json.dumps(ev))
    out = []
    for m in ev["markets"]:
        a = team_from_text(m.get("groupItemTitle") or m.get("question"))
        if not a:
            continue
        oc = json.loads(m["outcomes"])
        out.append(
            dict(
                abbr=a,
                token=json.loads(m["clobTokenIds"])[oc.index("Yes")],
                start=(m.get("startDate") or ev["startDate"])[:10],
                end=(m.get("closedTime") or m.get("endDate") or ev["endDate"])[:10],
                resolved_yes=json.loads(m["outcomePrices"])[oc.index("Yes")] == "1",
            )
        )
    return out


def hist(season, mk):
    t0, t1 = to_ts(mk["start"]), to_ts(mk["end"]) + 2 * 86400
    rows, t = [], t0
    while t < t1:
        t2 = min(t + 10 * 86400, t1)
        rows += http_json(
            f"https://clob.polymarket.com/prices-history?market={mk['token']}&startTs={t}&endTs={t2}&fidelity=60"
        ).get("history", [])
        t = t2
    df = pd.DataFrame(rows)
    if df.empty:
        return mk["abbr"], 0
    df = df.drop_duplicates("t").sort_values("t")
    df["ts"] = pd.to_datetime(df.t, unit="s", utc=True)
    df["abbr"] = mk["abbr"]
    df[["ts", "abbr", "p"]].to_parquet(OUT / f"{season}_{mk['abbr']}.parquet", index=False)
    return mk["abbr"], len(df)


if __name__ == "__main__":
    meta = {}
    for season in EVENTS:
        mks = markets(season)
        meta[season] = mks
        print(season, len(mks), sorted(m["abbr"] for m in mks if m["resolved_yes"]))
        with ThreadPoolExecutor(8) as ex:
            res = list(ex.map(lambda m: hist(season, m), mks))
        print(res)
    (OUT / "meta.json").write_text(json.dumps(meta, indent=1))
