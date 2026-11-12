# Scaffold: setup guide

## 🆕 Updating to 0.2

- 💻 **Mac:** already updated.
- 📱📲 **Phone + tablet:** Drive → `Scaffold` → **Scaffold.apk** → **Install** (keeps your data).
- 🖥️ **PC:** tray icon → **Quit** → unzip the new **Scaffold-win.zip** over the old folder → run **Scaffold.exe**.

**New tabs:** ☀️ Today · 📅 Calendar · ✅ Tasks (with projects) · 🔁 Habits · 📌 Notes · ⚙️ Settings (top right).

### 📅 Connect Google Calendar (once, on one computer, ~5 min)
Scaffold app → ⚙️ Settings → **Google Calendar** → follow the 4 steps there (copy the script, paste it at script.google.com, deploy, paste the link back).

### 🗂️ Obsidian
Nothing to do on the Mac. On the PC: ⚙️ Settings → **Obsidian vault** → check the folder is right (`G:\Meu Drive\Second Brain`).

---

About **15 minutes** for all 4 devices. Do them in this order.

---

## 1. 💻 MacBook (first device)

1. Open **Scaffold** from Applications. A small ▦ icon appears in the menu bar (top right).
2. The Scaffold window opens. Go to **Settings → Sync → Create sync code**.
3. **Write the code down.** You'll type it on every other device.
4. Add your tasks: **Tasks → ＋ New**, or tap a template.

The window can be closed. Scaffold keeps running from the menu bar icon.

---

## 2. 📱 Phone, then 📲 tablet (same steps on both)

**Install**
1. On the phone, open Google Drive → `Scaffold` folder → **Scaffold.apk**.
2. Android asks to allow installs from Drive: **allow it**, then **Install**.

**Unlock the app blocker** (Samsung hides this for apps not from the Play Store)
1. Settings → Apps → **Scaffold** → ⋮ (top right) → **Allow restricted settings**.
2. Open Scaffold → **Settings**. Tap **Fix** next to every ⚠️:
   - **App blocker** → turn on "Scaffold app blocker"
   - **Notifications** → allow
   - **Full-screen pop-ups** → allow
   - **Exact alarms** → allow
   - **No battery limits** → allow

**Connect**
1. Settings → Sync → type the code from the Mac → **Join**.
2. Your tasks appear within a few seconds.

**Extras (recommended)**
- **Widget:** long-press the home screen → Widgets → Scaffold.
- **Stop tile:** swipe down twice from the top → ✏️ edit → drag **Scaffold** into your tiles. One tap = emergency stop.

---

## 3. 🖥️ Windows PC

1. Google Drive → `Scaffold` folder → download **Scaffold-win.zip**.
2. Unzip it somewhere permanent, like `Documents\Scaffold`.
3. Run **Scaffold.exe**. If Windows warns "unknown app": **More info → Run anyway**.
4. Settings → Sync → type the code → **Join**.

---

## 4. 🧪 Check it works (2 minutes)

On any device: **Settings → Try it → Test lock (all devices)**.

- Every device should lock within about 20 seconds.
- Tap **I did it** on one device: all of them unlock.

---

## ⛔ Emergency stop: frees every device at once

Any of these works, from any device:
- The **Stop all** button at the top of the app
- **Emergency stop (all devices)** on any lock screen
- 📱 The **Scaffold tile** in quick settings, or **Stop all devices** in the notification
- 💻 Menu bar / tray icon → **Emergency stop**
- 💻 Keyboard: **Ctrl+Alt+Shift+K** (⌘+⌥+⇧+K on Mac)

It stays off until you press **Resume**.

**If anything ever gets stuck:**
- 📱 Settings → Accessibility → Scaffold app blocker → **Off**, or uninstall the app.
- 💻 Force Quit (Mac: ⌘⌥Esc) or Task Manager (Windows).

---

## How the levels work

| Level | What happens |
|---|---|
| 🔔 Nudge | Notifications only |
| 📣 Nag | Pop-ups that take over the screen |
| 🔒 Lock at deadline | Not done by the deadline → every device locks until it is |
| ⛓️ Lock from start | Every device stays locked from the start time until it's done |

- Reminders get **more frequent** near the deadline: every 10 min in the last hour.
- **Snooze:** 10 minutes, twice per task per day.
- 🌱 **Tiny version** (optional): the smallest version that still counts. It unlocks the devices and counts as **half**.
- Locks end at **23:30** at the latest.
- **Always allowed during locks:** WhatsApp, calls, Settings, alarms, and any apps you choose per task.
- **On computers**, each task either covers the whole screen (for tasks away from the computer) or only closes distracting apps (for computer tasks). The list of distracting apps is in Settings.

## Optional: grey phone screen during locks

This needs one command from a computer with the phone plugged in (USB debugging on):

```bash
adb shell pm grant com.scaffold.app android.permission.WRITE_SECURE_SETTINGS
```

Ask Claude to do it with you.
