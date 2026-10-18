"""Google Trends daily merch-search series per team. Checkpointed per request; Google rate-limits aggressively."""

import json
import random
import sys
import time

import pandas as pd
from pytrends.request import TrendReq

from common import DERIVED, LEAGUE, RAW, SEASONS, TEAM

OUT = RAW / "trends"
OUT.mkdir(exist_ok=True)


def merch_kw(a):
    """Longest OR-composite that fits Google's ~100-char keyword limit."""
    t = TEAM[a]["merch"]
    parts = [f"{t} {w}" for w in ["jersey", "shirt", "hat", "hoodie", "merch"]]
    while len(" + ".join(parts)) > 95:
        parts.pop()
    return " + ".join(parts)


def national_geo(a):
    if LEAGUE == "NBA":
        return "US"
    return "CA" if TEAM[a]["geo"] == "CA" else "US"


def team_list():
    """Non-NBA leagues: only teams that ever produced a candidate odds move (written by detect.py)."""
    p = DERIVED / "trends_teams.json"
    if LEAGUE != "NBA" and p.exists():
        return json.loads(p.read_text())
    return {s: list(TEAM) for s in SEASONS}


def playoff_teams(season):
    g = pd.read_parquet(RAW / "games.parquet")
    g = g[(g.season == season) & (g.season_type == 3)]
    return sorted(set(g.home) | set(g.away))


def jobs():
    out = []
    teams = team_list()
    for season, cfg in SEASONS.items():
        tf = f"{cfg['analysis_start']} {cfg['analysis_end']}"
        for a in teams.get(season, []):
            out.append((season, a, "merch", 1, merch_kw(a), national_geo(a), tf))
        # regular-season-only window: full resolution for the baseline (stitched onto the season series later)
        for a in teams.get(season, []):
            out.append(
                (season, a, "merchreg", 1, merch_kw(a), national_geo(a), f"{cfg['analysis_start']} {cfg['reg_end']}")
            )
        if LEAGUE != "NBA":
            continue
        # NBA only: an independent second sample, and local series for playoff teams
        a0 = pd.Timestamp(cfg["analysis_start"]) - pd.Timedelta(days=3)
        a1 = pd.Timestamp(cfg["analysis_end"]) - pd.Timedelta(days=3)
        for a in TEAM:
            out.append((season, a, "merch", 2, merch_kw(a), "US", f"{a0:%Y-%m-%d} {a1:%Y-%m-%d}"))
        yr = cfg["analysis_end"][:4]
        ptf = f"{yr}-03-20 {cfg['analysis_end']}"
        for a in playoff_teams(season):
            t = TEAM[a]
            out.append((season, a, "tickets", 1, f"{t['nick']} tickets", t["geo"], ptf))
            out.append((season, a, "watch", 1, "watch party + sports bar", t["geo"], ptf))
            out.append((season, a, "hotel", 1, f"{t['city']} hotel + {t['city']} hotels", "US", ptf))
    return out


def run():
    todo = [j for j in jobs() if not (OUT / f"{j[0]}_{j[1]}_{j[2]}_{j[3]}.parquet").exists()]
    todo.sort(key=lambda j: (j[3], j[2] not in ("merch", "merchreg"), j[2] == "merchreg"))
    print(f"{len(todo)} trends jobs to run", flush=True)
    py = TrendReq(hl="en-US", tz=300, timeout=(10, 30))
    fails = 0
    for i, (season, a, series, pull, kw, geo, tf) in enumerate(todo):
        path = OUT / f"{season}_{a}_{series}_{pull}.parquet"
        if path.exists():
            continue
        for attempt in range(6):
            try:
                py.build_payload([kw], timeframe=tf, geo=geo)
                df = py.interest_over_time()
                if df.empty:
                    df = pd.DataFrame({kw: []})
                df = df.rename(columns={kw: "value"})[["value"]].reset_index()
                df["season"], df["abbr"], df["series"], df["pull"], df["kw"], df["geo"] = (
                    season,
                    a,
                    series,
                    pull,
                    kw,
                    geo,
                )
                df.to_parquet(path, index=False)
                print(i, season, a, series, pull, len(df), flush=True)
                fails = 0
                break
            except Exception as e:
                fails += 1
                wait = min(600, 30 * (2**attempt)) + random.uniform(0, 10)
                print(f"  retry {a} {series} in {wait:.0f}s: {repr(e)[:120]}", flush=True)
                time.sleep(wait)
                py = TrendReq(hl="en-US", tz=300, timeout=(10, 30))
        time.sleep(random.uniform(6, 11))


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "list":
        for j in jobs():
            print(j)
    else:
        run()
