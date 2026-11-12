# Scaffold (prototype)

Cross-device ADHD scaffolding: reminders, pop-ups and device locks on Android (phone, tablet), Mac and Windows, synced through an encrypted relay. User guide: `SETUP.md`.

## Layout
- `shared/engine.js`: the rules (scheduling, reminders, locks, merge, stats). `android/src/.../Engine.java` mirrors it.
- `ui/`: one web UI for every device. `dev-bridge.js` lets it run in a plain browser.
- `desktop/`: Electron tray app (`main.js`), sync (`sync.js`), distraction closer (`blocker.js`).
- `android/`: plain-framework Java app, built without Gradle (`build.sh`). The UI runs in a WebView; background work is native (alarms, accessibility blocker, foreground service, widget, quick-settings tile).
- `tests/`: `engine.test.js` (also writes the fixture the Android self-test checks), `gcal.mock.test.js` (two-way calendar sync against a fake Apps Script), `sync.live.js` (real relay).
- `desktop/vault.js` (Obsidian link), `desktop/calendar.js` + `ui/gcal-script.js` (Google bridge), `tools/scaffold-cli.js` (Claude command, copied to `My Drive/Scaffold/cli/`).

## Sync
ntfy.sh topic `scf_` + sha256("scaffold-topic:" + code)[0:24]. Messages: base64(iv12 | AES-256-GCM(deflateRaw(JSON))) with key sha256("scaffold-key:" + code). Envelope `{d: deviceId, p: patch, s: isSnapshot}`. State is last-writer-wins records, so merges are order-independent. Devices broadcast a snapshot when none was seen for 5–6 h (relay keeps 12 h).

## Build and test (Mac)
```bash
node tests/engine.test.js && node tests/sync.live.js
cd desktop && npm start                    # dev app, separate data dir (Scaffold-dev)
node tools/inject.js lock|remind|done <id>|undo <id>|stop|resume   # feed the dev app
cd desktop && npm run dist:mac && npm run dist:win
android/build.sh                           # needs openjdk@17 + Android SDK 34 (Homebrew)
adb install -r android/build/Scaffold.apk && adb shell am start -n com.scaffold.app/.MainActivity --ez selftest true
adb logcat -s ScaffoldSelfTest             # ENGINE_OK, WIDGET_OK
```
Emulator: AVD `scaffold` (`emulator -avd scaffold -no-window -partition-size 2048`). Enable the blocker with `adb shell settings put secure enabled_accessibility_services com.scaffold.app/com.scaffold.app.BlockerService`.
