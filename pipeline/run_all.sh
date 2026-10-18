#!/bin/zsh
# Rebuild everything from cached raw data (fetchers are separate: fetch_markets/games/wiki/trends/ladder).
# Usage: pipeline/run_all.sh            (all leagues + v2 three-merchant backtest)
#        pipeline/run_all.sh --fast     (skip the slow detector-robustness grid)
set -e
cd "$(dirname "$0")"
PY=../.venv/bin/python
for L in NBA NHL NFL MLB; do
  echo "== $L"
  export LEAGUE=$L
  $PY -W ignore build_panel.py > /dev/null
  $PY -W ignore detect.py | head -1
  $PY -W ignore evaluate.py > /dev/null
  [[ "$1" != "--fast" ]] && $PY -W ignore robustness.py > /dev/null
  [[ "$L" == "NBA" ]] && $PY -W ignore merchant.py | head -1
  $PY -W ignore export_site.py > /dev/null
done
unset LEAGUE
$PY -W ignore scenarios.py | head -12
$PY -W ignore export_v2.py
$PY -W ignore make_deck.py
