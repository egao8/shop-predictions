"""Wikipedia daily pageviews per team article (attention control series)."""

import time
from concurrent.futures import ThreadPoolExecutor

import pandas as pd
import requests

from common import RAW, SEASONS, TEAM


def pull(abbr):
    art = TEAM[abbr]["wiki"]
    start = min(c["market_start"] for c in SEASONS.values()).replace("-", "")
    end = max(c["analysis_end"] for c in SEASONS.values()).replace("-", "")
    url = f"https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user/{art}/daily/{start}/{end}"
    for i in range(6):
        r = requests.get(url, headers={"User-Agent": "fayizeddie-research/0.1"}, timeout=40)
        if r.status_code == 200:
            break
        time.sleep(2**i)
    if r.status_code != 200:
        print("  wiki missing:", art, r.status_code)
        return []
    js = r.json()
    return [dict(date=pd.Timestamp(i["timestamp"][:8]), abbr=abbr, views=i["views"]) for i in js["items"]]


if __name__ == "__main__":
    rows = []
    with ThreadPoolExecutor(1) as ex:
        for r in ex.map(pull, list(TEAM)):
            rows += r
    df = pd.DataFrame(rows)
    df.to_parquet(RAW / "wiki.parquet", index=False)
    print(df.groupby("abbr").views.sum().sort_values().tail(10))
