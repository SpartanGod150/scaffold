#!/bin/bash
# Publishes a new Scaffold version. Every installed copy (Mac, Windows, Android) picks it up by itself.
#   tools/release.sh patch|minor|major|X.Y.Z "What changed"
# Steps: bump VERSION → tests → build Mac, Windows, Android → SHA256SUMS → git commit + tag + push →
#        GitHub release with the packages → copies into My Drive/Scaffold for manual installs.
set -euo pipefail
cd "$(dirname "$0")/.."
BUMP="${1:?patch|minor|major|X.Y.Z}"; NOTES="${2:?release notes}"
OLD=$(tr -d ' \n' < VERSION); IFS=. read -r MA MI PA <<< "$OLD"
case "$BUMP" in
  patch) NEW="$MA.$MI.$((PA+1))";; minor) NEW="$MA.$((MI+1)).0";; major) NEW="$((MA+1)).0.0";;
  *.*.*) NEW="$BUMP";; *) echo "bad bump: $BUMP"; exit 1;;
esac
REPO=$(node -p "require('./shared/update.json').repo")
[ -n "$REPO" ] || { echo "shared/update.json has no repo"; exit 1; }
git diff --quiet HEAD -- || echo "(committing pending changes with the release)"

echo "== $OLD → $NEW"
echo "$NEW" > VERSION
node -e "const f='desktop/package.json',p=require('./'+f);p.version='$NEW';require('fs').writeFileSync(f,JSON.stringify(p,null,2)+'\n')"

echo "== tests"
node tests/engine.test.js >/dev/null
node tests/gcal.mock.test.js >/dev/null

echo "== build"
REL=release; rm -rf "$REL" desktop/dist; mkdir -p "$REL"
(cd desktop && npm run -s dist:mac >/dev/null && npm run -s dist:win >/dev/null)
ditto -c -k --keepParent desktop/dist/mac-arm64/Scaffold.app "$REL/Scaffold-mac-arm64.zip"
cp "desktop/dist/Scaffold-$NEW-win.zip" "$REL/Scaffold-win-x64.zip"
android/build.sh >/dev/null
cp android/build/Scaffold.apk "$REL/Scaffold.apk"
(cd "$REL" && shasum -a 256 Scaffold-mac-arm64.zip Scaffold-win-x64.zip Scaffold.apk > SHA256SUMS.txt)
rm -rf desktop/dist/win-unpacked   # disk is tight on this Mac

echo "== publish"
git add -A && git commit -qm "Release $NEW: $NOTES" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" && git tag "v$NEW" && git push -q origin HEAD --tags
gh release create "v$NEW" --repo "$REPO" --title "Scaffold $NEW" --notes "$NOTES" \
  "$REL/Scaffold-mac-arm64.zip" "$REL/Scaffold-win-x64.zip" "$REL/Scaffold.apk" "$REL/SHA256SUMS.txt"

DRIVE="$HOME/Library/CloudStorage/GoogleDrive-mr.seckler150@gmail.com/My Drive/Scaffold"
if [ -d "$DRIVE" ]; then cp "$REL/Scaffold.apk" "$DRIVE/Scaffold.apk"; cp "$REL/Scaffold-win-x64.zip" "$DRIVE/Scaffold-win.zip"; fi
rm -rf "$REL"
echo "== released $NEW: devices update within 6 hours (or Settings → Check for updates now)"
