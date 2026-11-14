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
gh auth setup-git
[ -n "$REPO" ] || { echo "shared/update.json has no repo"; exit 1; }
git diff --quiet HEAD -- || echo "(committing pending changes with the release)"

FREE=$(df -g . | awk 'NR==2{print $4}'); [ "$FREE" -ge 4 ] || { echo "only ${FREE} GB free: need 4 GB (Syncthing stops below ~2.3 GB)"; exit 1; }
echo "== $OLD → $NEW"
echo "$NEW" > VERSION
node -e "const f='desktop/package.json',p=require('./'+f);p.version='$NEW';require('fs').writeFileSync(f,JSON.stringify(p,null,2)+'\n')"

echo "== packaging check"   # every local module the desktop app requires must be in package.json build.files
node -e "const fs=require('fs'),p=require('./desktop/package.json'),need=new Set();fs.readdirSync('desktop').filter(f=>f.endsWith('.js')).forEach(f=>{for(const m of fs.readFileSync('desktop/'+f,'utf8').matchAll(/require\\('\\.\\/([\\w.-]+\\.js)'\\)/g))need.add(m[1])});const miss=[...need].filter(f=>!p.build.files.includes(f));if(miss.length){console.error('missing from desktop/package.json build.files: '+miss.join(', '));process.exit(1)}"
echo "== tests"
node tests/engine.test.js >/dev/null
node tests/gcal.mock.test.js >/dev/null
node tests/gcal.v2.test.js >/dev/null
node tests/relay.mock.test.js >/dev/null

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
gh release create "v$NEW" --repo "$REPO" --draft --title "Scaffold $NEW" --notes "$NOTES" "$REL/Scaffold.apk" "$REL/SHA256SUMS.txt"   # hidden until every file is up
RID=$(gh release view "v$NEW" --repo "$REPO" --json databaseId -q .databaseId); TOKEN=$(gh auth token)
for f in Scaffold-mac-arm64.zip Scaffold-win-x64.zip; do   # big files: gh upload times out (HTTP 408), curl with a long timeout works
  for i in 1 2 3; do curl -sS --fail --max-time 1500 -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/zip" \
    --data-binary @"$REL/$f" "https://uploads.github.com/repos/$REPO/releases/$RID/assets?name=$f" -o /dev/null && break; echo "retry $f"; sleep 5; done
done
[ "$(gh release view "v$NEW" --repo "$REPO" --json assets -q '[.assets[] | select(.state=="uploaded")] | length')" = 4 ] || { echo "release is missing files (left as a draft)"; exit 1; }
gh release edit "v$NEW" --repo "$REPO" --draft=false --latest

node tools/announce.js "$NEW" || true   # devices check right away instead of within 15 min
DRIVE="$HOME/Library/CloudStorage/GoogleDrive-mr.seckler150@gmail.com/My Drive/Scaffold"
if [ -d "$DRIVE" ]; then cp "$REL/Scaffold.apk" "$DRIVE/Scaffold.apk"; cp "$REL/Scaffold-win-x64.zip" "$DRIVE/Scaffold-win.zip"; fi
rm -rf "$REL" desktop/dist
echo "== released $NEW: every device updates itself within minutes"
