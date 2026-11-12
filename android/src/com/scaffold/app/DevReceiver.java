package com.scaffold.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.webkit.WebView;

import org.json.JSONObject;

/** Test setup for the emulator. Protected by the DUMP permission, which only the adb shell has (no app can get it):
 *  adb shell am broadcast -n com.scaffold.app/.DevReceiver --es devSync CODE --es devRelay URL --es devSecret S --ez devtools true */
public class DevReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context ctx, Intent i) {
        Context c = ctx.getApplicationContext();
        if (i.getBooleanExtra("devtools", false)) Store.put(c, "devtools", "1");
        String code = i.getStringExtra("devSync");
        if (code == null) return;
        Store.put(c, "syncCode", code); Store.put(c, "since", "");
        String url = i.getStringExtra("devRelay"), sec = i.getStringExtra("devSecret");
        if (url != null) try {
            Store.apply(c, new JSONObject().put("cfg", new JSONObject().put("relay",
                    new JSONObject().put("id", "relay").put("url", url).put("secret", sec).put("ts", 1).put("by", "dev"))), false);
        } catch (Exception ignored) {}
        Sync.start(c);
    }
}
