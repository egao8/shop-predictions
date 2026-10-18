#!/bin/zsh
# Serve the Tipoff phase-1 site on localhost only.
cd "$(dirname "$0")/site" && echo "Tipoff → http://127.0.0.1:8787" && python3 -m http.server 8787 --bind 127.0.0.1
