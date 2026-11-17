package com.openradlr.app.preview;

import android.webkit.ServiceWorkerClient;
import android.webkit.ServiceWorkerController;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebViewClient;
import java.io.IOException;
import java.util.Map;

/** Local branch assets under the real backend origin, exclusively for opt-in debug builds. */
public final class BundledPreview {
    private BundledPreview() {}
    public static void install(Bridge bridge) {
        String origin = bridge.getConfig().getServerUrl();
        bridge.setWebViewClient(new BridgeWebViewClient(bridge) {
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                WebResourceResponse local = response(bridge, origin, request);
                return local == null ? super.shouldInterceptRequest(view, request) : local;
            }
        });
        // An existing network-first worker must also receive the bundled assets.
        ServiceWorkerController.getInstance().setServiceWorkerClient(new ServiceWorkerClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebResourceRequest request) {
                return response(bridge, origin, request);
            }
        });
        bridge.getWebView().stopLoading();
        bridge.getWebView().loadUrl(origin);
    }
    private static WebResourceResponse response(Bridge bridge, String origin, WebResourceRequest request) {
        String path = PreviewPath.asset(origin, request.getMethod(), request.getUrl().toString());
        if (path == null) return null;
        try {
            return new WebResourceResponse(mime(path), "UTF-8", 200, "OK",
                Map.of("Cache-Control", "no-store", "X-OpenRadlr-Client", "bundled-preview"),
                bridge.getContext().getAssets().open("bundled-preview/" + path));
        } catch (IOException e) { return null; }
    }
    private static String mime(String path) {
        if (path.endsWith(".js")) return "application/javascript";
        if (path.endsWith(".css")) return "text/css";
        if (path.endsWith(".html")) return "text/html";
        if (path.endsWith(".json") || path.endsWith(".webmanifest")) return "application/json";
        if (path.endsWith(".svg")) return "image/svg+xml";
        if (path.endsWith(".png")) return "image/png";
        if (path.endsWith(".webp")) return "image/webp";
        if (path.endsWith(".woff2")) return "font/woff2";
        return "application/octet-stream";
    }
}
