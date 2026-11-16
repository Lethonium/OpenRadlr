package com.openradlr.app;

import android.webkit.WebView;
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
    }
}
