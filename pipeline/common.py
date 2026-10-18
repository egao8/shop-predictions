"""Shared config for the selected league (LEAGUE env var, default NBA): teams, seasons, paths, HTTP helper."""

import json
import os
import re
import time
import urllib.error
import urllib.request
from pathlib import Path

from leagues import LEAGUES, merch_term

LEAGUE = os.environ.get("LEAGUE", "NBA").upper()
CFG = LEAGUES[LEAGUE]

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw" / LEAGUE
DERIVED = ROOT / "data" / "derived" / LEAGUE
SITE_DATA = ROOT / "site" / "data" / LEAGUE
SITE_ROOT_DATA = ROOT / "site" / "data"
for p in (RAW, DERIVED, SITE_DATA):
    p.mkdir(parents=True, exist_ok=True)

SEASONS = CFG["seasons"]
SPORT = CFG["sport"]
GAME_HOURS = CFG["game_hours"]
EAST = CFG["east"]
TEAM = {
    t[0]: dict(
        abbr=t[0],
        name=t[1],
        nick=t[2],
        wiki=t[3],
        city=t[4],
        geo=t[5],
        aliases=list(t[6]),
        merch=merch_term(LEAGUE, t[0], t[1], t[2]),
    )
    for t in CFG["teams"]
}


def team_from_text(s: str):
    """Map free text (Polymarket groupItemTitle, ESPN displayName) to this league's abbr."""
    s = (s or "").lower().replace("é", "e").strip()
    for abbr, t in TEAM.items():  # exact city labels, e.g. Kalshi-style "Los Angeles C"
        if any(a.startswith("=") and s == a[1:] for a in t["aliases"]):
            return abbr
    if LEAGUE == "NBA":
        if "clipper" in s:
            return "LAC"
        if "laker" in s:
            return "LAL"
    for abbr, t in TEAM.items():
        if t["name"].lower().replace("é", "e") in s:
            return abbr
    for abbr, t in TEAM.items():
        for a in (x for x in t["aliases"] if not x.startswith("=")):
            if re.search(rf"(^|\b){re.escape(a)}(\b|$)", s):
                return abbr
    for abbr, t in TEAM.items():  # word-boundary match so "Hornets" never hits "Nets"
        if re.search(rf"\b{re.escape(t['nick'].lower())}\b", s):
            return abbr
    return None


def http_json(url, data=None, headers=None, retries=5, timeout=40):
    h = {"User-Agent": "Mozilla/5.0 (research; fayizeddie)", "Accept": "application/json"}
    if data is not None:
        h["Content-Type"] = "application/json"
    if headers:
        h.update(headers)
    last = None
    for i in range(retries):
        try:
            req = urllib.request.Request(url, data=data, headers=h)
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            last = e
            if e.code == 404:
                raise
            time.sleep(min(60, 2**i + (5 if e.code == 429 else 0)))
        except Exception as e:
            last = e
            time.sleep(min(30, 2**i))
    raise last


def to_ts(date_str: str) -> int:
    import datetime as dt

    return int(dt.datetime.strptime(date_str, "%Y-%m-%d").replace(tzinfo=dt.timezone.utc).timestamp())
