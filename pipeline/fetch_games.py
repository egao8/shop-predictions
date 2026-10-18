"""ESPN scoreboard: every completed game with tip time, result and playoff series state."""

import datetime as dt
from concurrent.futures import ThreadPoolExecutor

import pandas as pd

from common import RAW, SEASONS, SPORT, http_json, team_from_text


def day(d):
    js = http_json(f"https://site.api.espn.com/apis/site/v2/sports/{SPORT}/scoreboard?dates={d:%Y%m%d}&limit=100")
    rows = []
    for e in js.get("events", []):
        comp = e["competitions"][0]
        st = comp.get("status", {}).get("type", {})
        if not st.get("completed"):
            continue
        teams = {}
        for c in comp["competitors"]:
            teams[c["homeAway"]] = dict(
                abbr=team_from_text(c["team"]["displayName"]),
                score=int(c.get("score") or 0),
                winner=bool(c.get("winner")),
            )
        if not teams.get("home") or not teams.get("away") or not teams["home"]["abbr"] or not teams["away"]["abbr"]:
            continue  # all-star / exhibition vs non-league team
        notes = " | ".join(n.get("headline", "") for n in comp.get("notes", []))
        series = comp.get("series") or {}
        rows.append(
            dict(
                game_id=e["id"],
                tip_utc=pd.Timestamp(e["date"]),
                season_type=e.get("season", {}).get("type"),
                home=teams["home"]["abbr"],
                away=teams["away"]["abbr"],
                home_score=teams["home"]["score"],
                away_score=teams["away"]["score"],
                winner=teams["home"]["abbr"] if teams["home"]["winner"] else teams["away"]["abbr"],
                note=notes,
                series_summary=series.get("summary", ""),
                series_completed=bool(series.get("completed")),
            )
        )
    return rows


if __name__ == "__main__":
    allrows = []
    for season, cfg in SEASONS.items():
        d0 = dt.date.fromisoformat(cfg["espn_start"])
        d1 = dt.date.fromisoformat(cfg["espn_end"])
        days = [d0 + dt.timedelta(i) for i in range((d1 - d0).days + 1)]
        with ThreadPoolExecutor(10) as ex:
            for rows in ex.map(day, days):
                for r in rows:
                    r["season"] = season
                allrows += rows
        print(season, len(allrows), flush=True)
    df = pd.DataFrame(allrows).drop_duplicates("game_id").sort_values("tip_utc")
    df["end_utc"] = df["tip_utc"] + pd.Timedelta(minutes=180)
    df.to_parquet(RAW / "games.parquet", index=False)
    print(df.groupby(["season", "season_type"]).size())
    print(df[df.season_type == 3].tail(8)[["tip_utc", "home", "away", "winner", "note", "series_summary"]].to_string())
