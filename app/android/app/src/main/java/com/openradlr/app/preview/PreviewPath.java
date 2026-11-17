package com.openradlr.app.preview;

import java.net.URI;
import java.util.Objects;

/** Routing policy for the opt-in, bundled-client developer build. */
public final class PreviewPath {
    private PreviewPath() {}
    public static String asset(String origin, String method, String address) {
        if (!"GET".equals(method)) return null;
        try {
            URI base = URI.create(origin), url = URI.create(address);
            if (!Objects.equals(base.getScheme(), url.getScheme())
                || !Objects.equals(base.getHost(), url.getHost()) || base.getPort() != url.getPort()
                || url.getUserInfo() != null) return null;
            String path = url.getRawPath();
            if (path == null || path.contains("%") || path.contains("\\") || path.contains("..")) return null;
            if (path.equals("/api") || path.startsWith("/api/") || path.equals("/auth")
                || path.startsWith("/auth/") || path.equals("/ws")) return null;
            return path.isEmpty() || path.equals("/") ? "index.html" : path.substring(1);
        } catch (IllegalArgumentException e) { return null; }
    }
}
