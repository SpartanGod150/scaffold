package com.scaffold.app;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import android.view.WindowManager;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.InputStream;
import java.lang.ref.WeakReference;
import java.nio.charset.StandardCharsets;

/** Hosts the shared UI (assets/ui) in a WebView. Modes: main, remind (pop-up), block (lock screen). */
public class MainActivity extends Activity {
    static WeakReference<MainActivity> current = new WeakReference<>(null);
    WebView web;
    String mode = "main", task = "";

    @Override protected void onCreate(Bundle b) {
        super.onCreate(b);
        Notif.channels(this);
        getWindow().setStatusBarColor(Color.parseColor("#0f1117"));
        getWindow().setNavigationBarColor(Color.parseColor("#0f1117"));
        readIntent(getIntent());
        web = new WebView(this);
        web.setBackgroundColor(Color.parseColor("#0f1117"));
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(true);
        web.setWebViewClient(new WebViewClient());
        web.setWebChromeClient(new WebChromeClient());
        if ("1".equals(Store.get(this, "devtools", ""))) WebView.setWebContentsDebuggingEnabled(true);   // set over adb only (DevReceiver)
        web.addJavascriptInterface(new Bridge(this), "AndroidBridge");
        setContentView(web);
        web.loadUrl("file:///android_asset/ui/index.html");
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED)
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 1);
        CoreService.start(this);
        if (getIntent().getBooleanExtra("selftest", false)) selfTest();
    }


    private void readIntent(Intent i) {
        String m = i.getStringExtra("mode");
        mode = m == null ? "main" : m;
        String t = i.getStringExtra("task");
        task = t == null ? "" : t;
        boolean overLock = "block".equals(mode) || "remind".equals(mode) || "note".equals(mode);
        if (overLock) { setShowWhenLocked(true); setTurnScreenOn(true); getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON); }
    }

    @Override protected void onNewIntent(Intent i) {
        super.onNewIntent(i);
        setIntent(i);
        readIntent(i);
        if (web != null) web.evaluateJavascript("window.setMode && window.setMode('" + mode + "','" + task.replace("'", "") + "')", null);
    }

    static volatile boolean resumed;
    @Override protected void onResume() { super.onResume(); resumed = true; current = new WeakReference<>(this); notifyState(); }
    @Override protected void onPause() { super.onPause(); resumed = false; }

    @Override public void onBackPressed() {
        if (Store.now(this).lock != null) return; // stay on the lock screen
        if (!Store.now(this).notes.isEmpty()) return; // stay on the note until it is dismissed
        if ("remind".equals(mode)) { finish(); return; }
        super.onBackPressed();
    }

    static void notifyState() {
        MainActivity a = current.get();
        if (a == null || a.web == null) return;
        a.runOnUiThread(() -> { if (a.web != null) a.web.evaluateJavascript("window.onNative && window.onNative()", null); });
    }

    private void selfTest() {
        try (InputStream in = getAssets().open("fixture-out.json")) {
            byte[] buf = new byte[in.available()];
            int n = in.read(buf);
            String bad = Engine.selfTest(new String(buf, 0, n, StandardCharsets.UTF_8));
            Log.i("ScaffoldSelfTest", bad.isEmpty() ? "ENGINE_OK" : "ENGINE_MISMATCH\n" + bad);
            android.widget.FrameLayout host = new android.widget.FrameLayout(this);
            TaskWidget.build(this).apply(this, host);
            Log.i("ScaffoldSelfTest", "WIDGET_OK");
        } catch (Exception e) { Log.i("ScaffoldSelfTest", "ENGINE_ERROR " + e); }
    }
}
