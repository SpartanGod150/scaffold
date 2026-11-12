package com.scaffold.app;

import android.content.ComponentName;
import android.content.Context;
import android.service.quicksettings.Tile;
import android.service.quicksettings.TileService;

/** Quick Settings tile (swipe down from the top): one tap stops or resumes Scaffold on every device. */
public class KillTile extends TileService {
    @Override public void onStartListening() { update(); }

    @Override public void onClick() {
        boolean paused = Store.now(this).paused;
        Store.apply(this, Engine.opPause(!paused, Store.deviceId(this), System.currentTimeMillis()), true);
        update();
    }

    private void update() {
        Tile t = getQsTile();
        if (t == null) return;
        boolean paused = Store.now(this).paused;
        t.setState(paused ? Tile.STATE_INACTIVE : Tile.STATE_ACTIVE);
        t.setLabel(paused ? "Scaffold OFF" : "Scaffold ON");
        if (android.os.Build.VERSION.SDK_INT >= 29) t.setSubtitle(paused ? "Tap to resume" : "Tap to stop all");
        t.updateTile();
    }

    static void refresh(Context c) {
        try { TileService.requestListeningState(c, new ComponentName(c, KillTile.class)); } catch (Exception ignored) {}
    }
}
