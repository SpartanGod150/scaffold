#!/bin/bash
# Gives testers a version: writes it to stable.txt (their devices only install what is named there).
#   tools/promote.sh 0.7.0        (the version must already be released)
# The dev's own devices (cfg.dev on) ignore this and take every release.
set -euo pipefail
cd "$(dirname "$0")/.."
V="${1:?version, e.g. 0.7.0}"
REPO=$(node -p "require('./shared/update.json').repo")
gh release view "v$V" --repo "$REPO" >/dev/null || { echo "v$V is not released"; exit 1; }
echo "$V" > stable.txt
git add stable.txt && git commit -qm "Testers get $V" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" && git push -q origin HEAD
echo "== testers now get $V (their devices check within 15 min)"
