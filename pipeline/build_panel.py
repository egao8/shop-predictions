"""Build hourly odds panels (Polymarket, Kalshi) and the daily demand panel per team-season."""

import glob

import numpy as np
import pandas as pd

from common import DERIVED, RAW, SEASONS, TEAM

ET = "America/New_York"


def hourly_pm():
    frames = []
    for f in glob.glob(str(RAW / "polymarket" / "*.parquet")):
        df = pd.read_parquet(f)
        season = f.split("/")[-1].rsplit("_", 1)[0]
        df["h"] = df.ts.dt.floor("h")
        s = df.groupby("h").p.last()
        cfg = SEASONS[season]
        idx = pd.date_range(
            pd.Timestamp(cfg["analysis_start"], tz="UTC") - pd.Timedelta(days=30),
            pd.Timestamp(cfg["analysis_end"], tz="UTC"),
            freq="h",
        )
        s = s.reindex(s.index.union(idx)).ffill().reindex(idx)
        frames.append(pd.DataFrame({"season": season, "abbr": df.abbr.iloc[0], "h": idx, "p": s.values}))
    return pd.concat(frames, ignore_index=True)


def hourly_kx():
    frames = []
    for f in glob.glob(str(RAW / "kalshi" / "*.parquet")):
        df = pd.read_parquet(f)
        season = f.split("/")[-1].rsplit("_", 1)[0]
        df["h"] = df.ts.dt.floor("h")
        mid = np.where(
            df.bid.notna() & df.ask.notna() & (df.ask > df.bid) & (df.bid > 0), (df.bid + df.ask) / 2, df.close
        )
        df["p"] = mid
        df["spread"] = df.ask - df.bid
        cfg = SEASONS[season]
        idx = pd.date_range(
            pd.Timestamp(cfg["analysis_start"], tz="UTC") - pd.Timedelta(days=30),
            pd.Timestamp(cfg["analysis_end"], tz="UTC"),
            freq="h",
        )
        g = df.groupby("h").agg(p=("p", "last"), spread=("spread", "last"), volume=("volume", "sum"))
        last = g.index.max()
        g = g.reindex(g.index.union(idx))
        g[["p", "spread"]] = g[["p", "spread"]].ffill()
        g.loc[g.index > last + pd.Timedelta(hours=6), ["p", "spread"]] = np.nan  # market closed/settled: no quote
        g["volume"] = g["volume"].fillna(0)
        g = g.reindex(idx)
        g["season"], g["abbr"] = season, df.abbr.iloc[0]
        frames.append(g.rename_axis("h").reset_index())
    return pd.concat(frames, ignore_index=True)


def trends_daily():
    frames = []
    for f in glob.glob(str(RAW / "trends" / "*.parquet")):
        df = pd.read_parquet(f)
        if df.empty:
            continue
        frames.append(df)
    if not frames:
        return pd.DataFrame(columns=["season", "abbr", "date", "series", "value"])
    t = pd.concat(frames, ignore_index=True)
    t["date"] = pd.to_datetime(t["date"]).dt.tz_localize(None)
    # each pull is separately normalised; rescale pulls to a common mean over their overlap, then average
    out = []
    for (season, abbr, series), g in t.groupby(["season", "abbr", "series"]):
        w = g.pivot_table(index="date", columns="pull", values="value")
        if w.shape[1] > 1:
            common = w.dropna()
            base = common[1].mean()
            for c in w.columns:
                m = common[c].mean()
                if m > 0:
                    w[c] = w[c] * base / m
        v = w.mean(axis=1)
        out.append(pd.DataFrame({"season": season, "abbr": abbr, "series": series, "date": v.index, "value": v.values}))
    res = pd.concat(out, ignore_index=True)
    # The regular-season pull has finer resolution (its own 0-100 scale). Rescale it onto the season series
    # over the overlap and use it for those dates, so a big playoff spike doesn't flatten the baseline to ~1.
    stitched = []
    for (season, abbr), g in res.groupby(["season", "abbr"]):
        full = g[g.series == "merch"].set_index("date").value
        reg = g[g.series == "merchreg"].set_index("date").value
        if len(full) and len(reg):
            ov = full.index.intersection(reg.index)
            if full.loc[ov].sum() > 0 and reg.loc[ov].sum() > 0:
                k = full.loc[ov].sum() / reg.loc[ov].sum()
                full = full.copy()
                full.loc[ov] = reg.loc[ov] * k
                stitched.append(
                    pd.DataFrame(
                        {"season": season, "abbr": abbr, "series": "merch", "date": full.index, "value": full.values}
                    )
                )
    if stitched:
        st = pd.concat(stitched, ignore_index=True)
        keys = set(zip(st.season, st.abbr))
        res = res[~((res.series == "merch") & [k in keys for k in zip(res.season, res.abbr)])]
        res = pd.concat([res, st], ignore_index=True)
    return res[res.series != "merchreg"]


def daily_panel(pm):
    wiki = pd.read_parquet(RAW / "wiki.parquet")
    wiki["date"] = pd.to_datetime(wiki["date"])
    tr = trends_daily()
    trw = (
        tr.pivot_table(index=["season", "abbr", "date"], columns="series", values="value").reset_index()
        if len(tr)
        else None
    )
    pm = pm.copy()
    pm["date"] = pm.h.dt.tz_convert(ET).dt.tz_localize(None).dt.normalize()
    pclose = pm.groupby(["season", "abbr", "date"]).p.last().rename("p_close").reset_index()
    rows = []
    for season, cfg in SEASONS.items():
        dates = pd.date_range(cfg["analysis_start"], cfg["analysis_end"], freq="D")
        for a in TEAM:
            rows.append(pd.DataFrame({"season": season, "abbr": a, "date": dates}))
    d = pd.concat(rows, ignore_index=True)
    d = d.merge(wiki[["abbr", "date", "views"]].rename(columns={"views": "wiki"}), on=["abbr", "date"], how="left")
    if trw is not None:
        d = d.merge(trw, on=["season", "abbr", "date"], how="left")
    for c in ["merch", "tickets", "watch", "hotel"]:
        if c not in d:
            d[c] = np.nan
    d = d.merge(pclose, on=["season", "abbr", "date"], how="left")
    return d


if __name__ == "__main__":
    pm = hourly_pm()
    kx = hourly_kx()
    pm.to_parquet(DERIVED / "pm_hourly.parquet", index=False)
    kx.to_parquet(DERIVED / "kx_hourly.parquet", index=False)
    d = daily_panel(pm)
    d.to_parquet(DERIVED / "daily.parquet", index=False)
    print(pm.shape, kx.shape, d.shape)
    print(d.notna().groupby(d.season).mean().round(2))
