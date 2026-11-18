package com.openradlr.app;

import android.app.Activity;
import android.app.Instrumentation;
import android.content.Intent;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.webkit.WebView;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import java.util.concurrent.atomic.AtomicInteger;

/** Black-box release checks without sharing AndroidX/Kotlin test code with the optimized app. */
public class ReleaseSmokeRunner extends Instrumentation {
    @Override public void onCreate(Bundle arguments) { super.onCreate(arguments); start(); }
    @Override public void onStart() {
        Bundle result = new Bundle();
        Activity activity = null;
        int code = Activity.RESULT_OK;
        try {
            ActivityMonitor launch = addMonitor("com.openradlr.app.MainActivity", null, false);
            getTargetContext().startActivity(new Intent(Intent.ACTION_MAIN)
                .setClassName(getTargetContext().getPackageName(), "com.openradlr.app.MainActivity")
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK));
            activity = waitForMonitorWithTimeout(launch, 30000);
            removeMonitor(launch);
            if (activity == null) throw new AssertionError("Release activity did not launch");
            Bundle stage = new Bundle(); stage.putString("stream", "Release activity launched\n"); sendStatus(1, stage);
            Activity current = activity;
            AtomicReference<WebView> view = new AtomicReference<>();
            AtomicInteger topInset = new AtomicInteger();
            runOnMainSync(() -> {
                int id = current.getResources().getIdentifier("webview", "id", current.getPackageName());
                view.set(current.findViewById(id));
                topInset.set(current.getWindow().getDecorView().getPaddingTop());
            });
            if (topInset.get() != 0) throw new AssertionError("Edge-to-edge inset regressed");
            if (view.get() == null) throw new AssertionError("Release WebView missing");
            String start = "(()=>{if(!window.Capacitor?.Plugins?.BackgroundRide)return false;"
                + "if(!window.r8Probe){window.r8Probe='pending';(async()=>{try{const p=Capacitor.Plugins;"
                + "await p.BackgroundRide.recover();await p.BackgroundRide.snapshot({since:Date.now()});"
                + "await p.BluetoothLe.initialize({androidNeverForLocation:true});await p.BluetoothLe.isEnabled();"
                + "await p.KeepAwake.isSupported();await p.KeepAwake.keepAwake();await p.KeepAwake.allowSleep();"
                + "await p.SystemBars.hide();await p.SystemBars.show();await p.Share.canShare();await p.App.getInfo();"
                + "await p.Filesystem.writeFile({path:'r8-smoke.txt',data:'bridge-ok',directory:'CACHE',encoding:'utf8'});"
                + "const f=await p.Filesystem.readFile({path:'r8-smoke.txt',directory:'CACHE',encoding:'utf8'});"
                + "await p.Filesystem.deleteFile({path:'r8-smoke.txt',directory:'CACHE'});"
                + "window.r8Probe=f.data==='bridge-ok'?'ok':'bad file data';}catch(e){window.r8Probe=String(e);}})();}"
                + "return window.r8Probe;})()";
            String probe = awaitJavascript(view.get(), start);
            if (!"\"ok\"".equals(probe)) throw new AssertionError("Release plugin dispatch: " + probe);
            result.putString("stream", "OK: optimized release bridge, Bluetooth initialization, background journal/snapshot, wake-lock/system-bar calls, sharing capability, app info, filesystem round trip and edge-to-edge inset\n");

        } catch (Throwable error) {
            result.putString("stream", "FAIL: " + android.util.Log.getStackTraceString(error));
            code = Activity.RESULT_CANCELED;
        } finally {
            if (activity != null) { Activity current = activity; runOnMainSync(current::finish); }
        }
        finish(code, result);
    }
    private String awaitJavascript(WebView web, String expression) throws Exception {
        CountDownLatch done = new CountDownLatch(1);
        AtomicReference<String> result = new AtomicReference<>();
        long deadline = SystemClock.elapsedRealtime() + 20000;
        Handler ui = new Handler(Looper.getMainLooper());
        ui.post(new Runnable() {
            @Override public void run() {
                web.evaluateJavascript(expression, value -> {
                    result.set(value);
                    if (SystemClock.elapsedRealtime() >= deadline
                        || (!"false".equals(value) && !"null".equals(value) && !"\"pending\"".equals(value))) done.countDown();
                    else ui.postDelayed(this, 100);
                });
            }
        });
        if (!done.await(25, TimeUnit.SECONDS)) throw new AssertionError("Release JS probe timed out");
        return result.get();
    }
}
