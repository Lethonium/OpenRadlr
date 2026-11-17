package com.openradlr.app;

import android.webkit.WebView;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void load() {
        // Set this before the bridge loads its first page, including that first request.
        // Use the built package's version; syncing Capacitor must not freeze an old build number.
        WebView webView = findViewById(com.getcapacitor.android.R.id.webview);
        String suffix = " OpenRadlr/" + BuildConfig.VERSION_NAME + " (android; build/" + BuildConfig.VERSION_CODE + ")";
        webView.getSettings().setUserAgentString(webView.getSettings().getUserAgentString() + suffix);
        super.load();
        // Ride visibility is controlled by SystemBars from the client. Keep edge
        // swipes available while hidden, without forcing fullscreen on the menu.
        WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView())
            .setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
    }
}
