"""Sensitivity of the headline results to detector settings (threshold x hold time)."""

import json

import pandas as pd

import detect
from common import DERIVED, RAW
from evaluate import event_study, perm_test, slope, team_phases


def run():
    d = pd.read_parquet(DERIVED / "daily.parquet")
    g = pd.read_parquet(RAW / "games.parquet")
    ph = team_phases(g)
    rows = []
    for th in (0.02, 0.03, 0.05):
        for H in (3, 6, 12):
            prm = dict(detect.DEFAULT, th_abs=th, hold_h=H)
            c = detect.run(prm)
            es = event_study(d, c, ph, "merch")
            kept, rej = es[es.passed].reset_index(drop=True), es[~es.passed].reset_index(drop=True)
            pt = perm_test(kept, "car_2_14", n=2000)
            rows.append(
                dict(
                    th_abs=th,
                    hold_h=H,
                    candidates=len(c),
                    kept=int(c.passed.sum()),
                    n_es=len(kept),
                    slope_kept_t=slope(kept, "car_2_14")["t"],
                    slope_rej_t=slope(rej, "car_2_14")["t"],
                    perm_p=pt["p"],
                    hit=pt["hit_rate"],
                    effect=pt["obs"],
                    default=(th == 0.03 and H == 6),
                )
            )
            print(rows[-1], flush=True)
    (DERIVED / "robustness.json").write_text(json.dumps(rows, default=float))
    return rows


if __name__ == "__main__":
    run()
