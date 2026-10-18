"""Export the cross-league three-merchant results to site/data/v2.json."""

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LEAGUES = ["NBA", "NHL", "NFL", "MLB"]


def league_summary(L):
    d = ROOT / "site" / "data" / L / "meta.json"
    if not d.exists():
        return None
    m = json.loads(d.read_text())
    r = m.get("results", {})
    mer = r.get("merch", {})
    out = dict(funnel=m.get("funnel"), seasons=list(m.get("seasons", {}).keys()), generated=m.get("generated"))
    if mer:
        out.update(
            n_es=mer["passed"]["car_2_14"]["n"],
            slope_kept_t=mer["passed"]["slope_2_14"]["t"],
            slope_rej_t=mer["rejected"]["slope_2_14"]["t"],
            dir_effect=mer["passed"]["car_2_14"]["obs"],
            dir_p=mer["passed"]["car_2_14"]["p"],
            hit=mer["passed"]["car_2_14"]["hit_rate"],
            d0_effect=mer["passed"]["d0"]["obs"],
            d0_p=mer["passed"]["d0"]["p"],
            pre_p=mer["passed"]["pre"]["p"],
            elim=mer.get("by_class", {}).get("elimination"),
        )
    br = r.get("beyond_reaction") or {}
    if br:
        out["beyond"] = dict(
            r2_react=br["reaction_only"]["r2"],
            r2_odds=br["reaction_plus_odds"]["r2"],
            t_odds=br["reaction_plus_odds"]["t"].get("dlogit"),
        )
    return out


if __name__ == "__main__":
    sc = json.loads((ROOT / "data" / "derived" / "scenarios.json").read_text())
    # human-readable causes (incl. hand-labelled news) from each league's exported signals
    causes = {}
    for L in LEAGUES:
        p = ROOT / "site" / "data" / L / "signals.json"
        if p.exists():
            for x in json.loads(p.read_text()):
                causes[(L, x["sid"])] = x["cause"]
    for e in sc["events"]:
        e["cause"] = causes.get((e["league"], e["sid"]), e["cause"])
    prereg = json.loads((ROOT / "pipeline" / "prereg_v2.json").read_text())
    v2 = dict(scenarios=sc, prereg=prereg, leagues={L: league_summary(L) for L in LEAGUES})
    out = ROOT / "site" / "data" / "v2.json"
    out.write_text(json.dumps(v2, separators=(",", ":")))
    print(out, f"{out.stat().st_size / 1024:.0f} KB", "events:", len(sc["events"]))
