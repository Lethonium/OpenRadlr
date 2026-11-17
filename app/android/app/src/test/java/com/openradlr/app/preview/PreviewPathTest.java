package com.openradlr.app.preview;

import static org.junit.Assert.*;
import org.junit.Test;

public class PreviewPathTest {
    private static final String ORIGIN = "https://app.openradlr.com";
    @Test public void rootUsesTheBundledStartScreen() {
        assertEquals("index.html", PreviewPath.asset(ORIGIN, "GET", ORIGIN + "/?lang=de"));
    }
    @Test public void modulesUseTheBundledVersion() {
        assertEquals("js/main.js", PreviewPath.asset(ORIGIN, "GET", ORIGIN + "/js/main.js?v=3"));
    }
    @Test public void productionApiRemainsOnTheNetwork() {
        assertNull(PreviewPath.asset(ORIGIN, "GET", ORIGIN + "/api/info"));
        assertNull(PreviewPath.asset(ORIGIN, "GET", ORIGIN + "/auth/strava"));
        assertNull(PreviewPath.asset(ORIGIN, "GET", ORIGIN + "/ws"));
    }
    @Test public void externalOriginsNeverReceiveBundledAssets() {
        assertNull(PreviewPath.asset(ORIGIN, "GET", "https://example.org/js/main.js"));
        assertNull(PreviewPath.asset(ORIGIN, "GET", "http://app.openradlr.com/js/main.js"));
        assertNull(PreviewPath.asset(ORIGIN, "GET", ORIGIN + ":8443/js/main.js"));
    }
    @Test public void writesAlwaysReachTheNetwork() {
        assertNull(PreviewPath.asset(ORIGIN, "POST", ORIGIN + "/index.html"));
    }
    @Test public void pathsCannotEscapeTheBundledDirectory() {
        assertNull(PreviewPath.asset(ORIGIN, "GET", ORIGIN + "/../capacitor.config.json"));
        assertNull(PreviewPath.asset(ORIGIN, "GET", ORIGIN + "/%2e%2e/secret"));
        assertNull(PreviewPath.asset(ORIGIN, "GET", ORIGIN + "/js%2fmain.js"));
    }
}
