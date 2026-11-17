package com.openradlr.app.ride;

import static org.junit.Assert.*;
import android.content.*;
import android.os.*;
import android.webkit.WebView;
import androidx.test.core.app.ActivityScenario;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import com.getcapacitor.*;
import com.openradlr.app.MainActivity;
import java.util.Map;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.Consumer;
import org.junit.Test;
import org.junit.runner.RunWith;

/** Opt-in interactive smoke check: the real app/client/server, with native radio packets supplied at the I/O boundary. */
@RunWith(AndroidJUnit4.class)
public class RidePreviewTest {
    private static final String EVENT = "notification|capture-ftms|00001826-0000-1000-8000-00805f9b34fb|00002ad2-0000-1000-8000-00805f9b34fb";
    @Test public void interactiveNativeRidePreview() throws Exception {
        org.junit.Assume.assumeTrue("true".equals(InstrumentationRegistry.getArguments().getString("interactive")));
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        CountDownLatch bound = new CountDownLatch(1), ended = new CountDownLatch(1);
        AtomicReference<RideService> owner = new AtomicReference<>();
        ServiceConnection connection = new ServiceConnection() {
            @Override public void onServiceConnected(ComponentName name, IBinder binder) { owner.set(((RideService.LocalBinder) binder).service()); bound.countDown(); }
            @Override public void onServiceDisconnected(ComponentName name) {}
        };
        Map<String, Consumer<JSObject>> listeners = new ConcurrentHashMap<>();
        BleTransport radio = new BleTransport() {
            @Override public void listen(String event, Consumer<JSObject> listener) { listeners.putIfAbsent(event, listener); }
            @Override public void invoke(String method, JSObject options, Consumer<JSObject> ok, Consumer<String> fail) { ok.accept(new JSObject()); }
            @Override public void close() { listeners.clear(); }
        };
        ScheduledExecutorService packets = Executors.newSingleThreadScheduledExecutor();
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            CountDownLatch page = new CountDownLatch(1);
            Handler main = new Handler(Looper.getMainLooper());
            Runnable ready = new Runnable() {
                @Override public void run() {
                    scenario.onActivity(activity -> activity.getBridge().getWebView().evaluateJavascript("Boolean(document.querySelector('#route-list button'))", result -> {
                        if ("true".equals(result)) page.countDown(); else main.postDelayed(this, 100);
                    }));
                }
            };
            main.post(ready);
            assertTrue("Local client ready", page.await(45, TimeUnit.SECONDS));
            context.bindService(new Intent(context, RideService.class), connection, Context.BIND_AUTO_CREATE);
            assertTrue(bound.await(10, TimeUnit.SECONDS));
            RideService ride = owner.get();
            ride.attach(radio, null);
            ride.observeEvent(EVENT);
            FileObserver journal = new FileObserver(context.getFilesDir().getAbsolutePath(), FileObserver.MODIFY) {
                @Override public void onEvent(int event, String path) {
                    if ("active-ride.jsonl".equals(path)) ride.snapshot(-1, state -> { if (state.optBoolean("ended")) ended.countDown(); });
                }
            };
            journal.startWatching();
            packets.scheduleAtFixedRate(() -> { Consumer<JSObject> listener = listeners.get(EVENT); if (listener != null) listener.accept(new JSObject().put("value", "44001c0cb000d700")); }, 0, 500, TimeUnit.MILLISECONDS);
            System.out.println("OPENRADLR_APP_PREVIEW_READY");
            assertTrue("End the synthetic ride from the app/notification", ended.await(150, TimeUnit.SECONDS));
            journal.stopWatching();
        } finally {
            packets.shutdownNow();
            context.unbindService(connection);
        }
    }
}
