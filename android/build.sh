#!/bin/bash
# Builds Scaffold.apk without Gradle: aapt2 + javac + d8 + apksigner.
set -euo pipefail
cd "$(dirname "$0")"
SDK="${ANDROID_HOME:-/opt/homebrew/share/android-commandlinetools}"
BT="$SDK/build-tools/34.0.0"
PLAT="$SDK/platforms/android-34/android.jar"
export JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk@17}"
export PATH="$JAVA_HOME/bin:$PATH"
OUT=build

rm -rf "$OUT"; mkdir -p "$OUT/gen" "$OUT/classes" "$OUT/assets/ui"
cp -R ../ui/. "$OUT/assets/ui/"
cp ../shared/engine.js "$OUT/assets/ui/engine.js"
cp ../tests/fixture-out.json "$OUT/assets/" 2>/dev/null || true
cp ../shared/update.json "$OUT/assets/ui/update.json"
VER=$(tr -d ' \n' < ../VERSION); IFS=. read -r MA MI PA <<< "$VER"; CODE=$((MA*10000 + MI*100 + PA))
sed -e "s/@VERSION_NAME@/$VER/" -e "s/@VERSION_CODE@/$CODE/" AndroidManifest.xml > "$OUT/AndroidManifest.xml"

"$BT/aapt2" compile --dir res -o "$OUT/res.zip"
"$BT/aapt2" link -o "$OUT/base.apk" -I "$PLAT" --manifest "$OUT/AndroidManifest.xml" -A "$OUT/assets" --java "$OUT/gen" "$OUT/res.zip"

javac -Xlint:-options --release 11 -classpath "$PLAT" -d "$OUT/classes" $(find src "$OUT/gen" -name '*.java')
"$BT/d8" --min-api 26 --lib "$PLAT" --output "$OUT" $(find "$OUT/classes" -name '*.class')
(cd "$OUT" && zip -q base.apk classes.dex)

[ -f debug.keystore ] || keytool -genkeypair -keystore debug.keystore -storepass android -keypass android -alias scaffold \
  -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=Scaffold" >/dev/null 2>&1
"$BT/zipalign" -f 4 "$OUT/base.apk" "$OUT/aligned.apk"
"$BT/apksigner" sign --ks debug.keystore --ks-pass pass:android --ks-key-alias scaffold --out "$OUT/Scaffold.apk" "$OUT/aligned.apk"
echo "Built $(pwd)/$OUT/Scaffold.apk"
