package com.openradlr.app.ride;

import static org.junit.Assert.*;
import android.app.*;
import android.view.accessibility.AccessibilityNodeInfo;
import android.content.*;
import android.os.*;
import androidx.core.content.ContextCompat;
import androidx.lifecycle.Lifecycle;
import androidx.test.core.app.ActivityScenario;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import com.getcapacitor.*;
import com.openradlr.app.MainActivity;
import java.util.Map;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.Consumer;
import okhttp3.*;
import okhttp3.mockwebserver.*;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;

/** Real Android lifecycle/socket/disk/notification, with only the radio and peer faked. */
@RunWith(AndroidJUnit4.class)
public class BackgroundRideTest {
    private static final String BIKE = "notification|trainer|00001826-0000-1000-8000-00805f9b34fb|00002ad2-0000-1000-8000-00805f9b34fb";
    private static final class Radio implements BleTransport {
        final Map<String, Consumer<JSObject>> listeners = new ConcurrentHashMap<>();
        final CountDownLatch drafted = new CountDownLatch(1);
        @Override public void listen(String event, Consumer<JSObject> listener) { listeners.putIfAbsent(event, listener); }
        @Override public void invoke(String method, JSObject options, Consumer<JSObject> ok, Consumer<String> fail) {
            // Web effectiveGrade: 12 m/s, 85 kg, 30% draft saving => 2.4% FTMS grade.
            if (method.equals("write") && "110000f0002800".equals(options.optString("value"))) drafted.countDown();
            ok.accept(new JSObject());
        }
        @Override public void close() { listeners.clear(); }
        void pedal() { Consumer<JSObject> listener = listeners.get(BIKE); if (listener != null) listener.accept(new JSObject().put("value", "44001c0cb000d700")); }
    }
    private static void shell(String command) throws Exception {
        try (java.io.InputStream input = new ParcelFileDescriptor.AutoCloseInputStream(InstrumentationRegistry.getInstrumentation().getUiAutomation().executeShellCommand(command))) {
            byte[] buffer = new byte[1024]; while (input.read(buffer) >= 0) { /* Drain shell output. */ }
        }
    }
    private static void await(CountDownLatch latch, String message) throws Exception { assertTrue(message, latch.await(15, TimeUnit.SECONDS)); }

    @Test public void screenOffKeepsMeasuredTelemetryAndRecordingAndNotificationEndSavesTheRide() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        if (Build.VERSION.SDK_INT >= 31) { shell("pm grant " + context.getPackageName() + " android.permission.BLUETOOTH_CONNECT"); shell("pm grant " + context.getPackageName() + " android.permission.BLUETOOTH_SCAN"); }
        if (Build.VERSION.SDK_INT >= 33) shell("pm grant " + context.getPackageName() + " android.permission.POST_NOTIFICATIONS");
        AtomicReference<RideService> service = new AtomicReference<>();
        CountDownLatch bound = new CountDownLatch(1), joined = new CountDownLatch(1), started = new CountDownLatch(1), measured = new CountDownLatch(1), recorded = new CountDownLatch(1), ended = new CountDownLatch(1);
        ServiceConnection connection = new ServiceConnection() {
            @Override public void onServiceConnected(ComponentName name, IBinder binder) { service.set(((RideService.LocalBinder) binder).service()); bound.countDown(); }
            @Override public void onServiceDisconnected(ComponentName name) {}
        };
        Radio radio = new Radio();
        ScheduledExecutorService peripheral = Executors.newSingleThreadScheduledExecutor();
        MockWebServer server = new MockWebServer();
        AtomicReference<WebSocket> peer = new AtomicReference<>();
        server.enqueue(new MockResponse().withWebSocketUpgrade(new WebSocketListener() {
            double metres = 998;
            @Override public void onOpen(WebSocket socket, Response response) { peer.set(socket); }
            @Override public void onClosing(WebSocket socket, int code, String reason) { socket.close(code, reason); }
            @Override public void onMessage(WebSocket socket, String text) {
                try {
                    JSONObject message = new JSONObject(text);
                    switch (message.optString("type")) {
                        case "hello" -> socket.send("{\"type\":\"welcome\",\"protocol_version\":2}");
                        case "join" -> socket.send("{\"type\":\"joined\",\"rider_id\":7,\"resume_token\":\"test-token\"}");
                        case "telemetry" -> {
                            if (message.optDouble("power") == 215) measured.countDown();
                            assertFalse("Heart rate must remain local", message.has("heart_rate"));
                            metres += 1;
                            socket.send(new JSObject().put("type", "state").put("riders", new JSArray()
                                .put(new JSObject().put("id", 7).put("route", "test-route").put("distance", metres % 1000).put("speed", 12).put("lane", 2))
                                .put(new JSObject().put("id", 8).put("route", "test-route").put("distance", (metres + 2) % 1000).put("speed", 12).put("lane", 2))).toString());
                        }
                    }
                } catch (Exception e) { throw new AssertionError(e); }
            }
        }));
        server.start();
        try (ActivityScenario<RideTestActivity> scenario = ActivityScenario.launch(RideTestActivity.class)) {
            context.bindService(new Intent(context, RideService.class), connection, Context.BIND_AUTO_CREATE);
            await(bound, "Bind native ride service");
            RideService ride = service.get();
            ride.attach(radio, event -> {
                try {
                    if (event.optString("type").equals("open")) ride.send("test-socket", "{\"type\":\"hello\",\"protocol_version\":2,\"client_version\":\"device-test\"}");
                    if (event.optString("type").equals("message")) {
                        JSONObject message = new JSONObject(event.optString("data"));
                        if (message.optString("type").equals("welcome")) ride.send("test-socket", "{\"type\":\"join\",\"name\":\"Device test\",\"weight_kg\":75}");
                        if (message.optString("type").equals("joined")) joined.countDown();
                    }
                    if (event.optString("type").equals("rideState") && event.optBoolean("ended")) ended.countDown();
                } catch (Exception e) { throw new AssertionError(e); }
            });
            ride.observeEvent(BIKE);
            ride.openSocket("test-socket", server.url("/ws").toString().replace("http:", "ws:"), null);
            await(joined, "Join through native WebSocket");
            RecordedRequest upgrade = server.takeRequest(5, TimeUnit.SECONDS);
            assertNotNull(upgrade);
            assertEquals(server.url("/").toString().replaceAll("/$", ""), upgrade.getHeader("Origin"));
            JSObject snapshot = new JSObject().put("version", 1).put("nativeRideId", "device-test").put("profileId", "test-rider")
                .put("rideStartedAt", System.currentTimeMillis() - 65000).put("savedAt", System.currentTimeMillis())
                .put("routeId", "test-route").put("routeName", "Rolling Hills · device test").put("distance", "true".equals(InstrumentationRegistry.getArguments().getString("preview")) ? 12400 : 0)
                .put("recordDurationS", "true".equals(InstrumentationRegistry.getArguments().getString("preview")) ? 1458 : 0)
                .put("serverUrl", server.url("/ws").toString()).put("trainerKind", "trainer")
                .put("recorder", new JSObject().put("samples", new JSArray()).put("pauses", new JSArray()));
            ride.startRide(new JSObject().put("snapshot", snapshot).put("trainerId", "trainer")
                .put("control", new JSObject().put("canControl", true).put("ratio", 1).put("referenceRatio", 1)
                    .put("routeLoops", new JSObject().put("test-route", true)).put("routeLengths", new JSObject().put("test-route", 1000))), value -> started.countDown(), reason -> { throw new AssertionError(reason); });
            await(started, "Start native recorder");
            ContextCompat.startForegroundService(context, new Intent(context, RideService.class));
            FileObserver journal = new FileObserver(context.getFilesDir().getAbsolutePath(), FileObserver.MODIFY) {
                @Override public void onEvent(int event, String path) {
                    if ("active-ride.jsonl".equals(path)) ride.snapshot(-1, value -> { if (value.optJSONArray("samples").length() >= 3) recorded.countDown(); if (value.optBoolean("ended")) ended.countDown(); });
                }
            };
            journal.startWatching();
            peripheral.scheduleAtFixedRate(radio::pedal, 0, 500, TimeUnit.MILLISECONDS);
            scenario.moveToState(Lifecycle.State.CREATED);
            ride.background(true);
            shell("input keyevent 223");
            await(measured, "Native telemetry must keep measured power with the screen off");
            await(recorded, "Native journal must keep recording with the screen off");
            await(radio.drafted, "Background FTMS resistance must include the group draft across the loop start");
            shell("input keyevent 224"); shell("wm dismiss-keyguard");
            NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
            Notification notification = null;
            for (var current : manager.getActiveNotifications()) if (current.getId() == 310) notification = current.getNotification();
            assertNotNull("The ride must have a visible ongoing notification", notification);
            assertTrue((notification.flags & Notification.FLAG_FOREGROUND_SERVICE) != 0);
            assertNotNull("Expanded stats card", notification.bigContentView);
            assertEquals("Return and End/save actions", 2, notification.actions.length);
            assertTrue(notification.extras.getCharSequence(Notification.EXTRA_TEXT).toString().contains("215"));
            if ("true".equals(InstrumentationRegistry.getArguments().getString("preview"))) {
                BroadcastReceiver commands = new BroadcastReceiver() {
                    @Override public void onReceive(Context c, Intent intent) {
                        String command = intent.getStringExtra("command");
                        if ("end".equals(command)) {
                            for (var current : manager.getActiveNotifications()) if (current.getId() == 310) try { current.getNotification().actions[1].actionIntent.send(); } catch (Exception e) { throw new AssertionError(e); }
                            return;
                        }
                        AccessibilityNodeInfo root = InstrumentationRegistry.getInstrumentation().getUiAutomation().getRootInActiveWindow();
                        if (root == null) return;
                        for (AccessibilityNodeInfo brand : root.findAccessibilityNodeInfosByText("OpenRadlr")) {
                            AccessibilityNodeInfo row = brand;
                            while (row != null && !"com.android.systemui:id/expandableNotificationRow".equals(row.getViewIdResourceName())) row = row.getParent();
                            if (row != null) for (AccessibilityNodeInfo button : row.findAccessibilityNodeInfosByViewId("android:id/expand_button")) {
                                System.out.println("OPENRADLR_EXPAND " + button.performAction(AccessibilityNodeInfo.ACTION_CLICK)); return;
                            }
                        }
                    }
                };
                ContextCompat.registerReceiver(context, commands, new IntentFilter("com.openradlr.app.TEST_NOTIFICATION"), ContextCompat.RECEIVER_EXPORTED);
                System.out.println("OPENRADLR_NOTIFICATION_PREVIEW");
                try { assertTrue("End/save action from notification", ended.await(180, TimeUnit.SECONDS)); }
                finally { context.unregisterReceiver(commands); }
            } else {
                notification.actions[1].actionIntent.send();
                await(ended, "End/save action from notification");
            }
            journal.stopWatching();
            CountDownLatch stopped = new CountDownLatch(1);
            ride.stopRide(false, state -> stopped.countDown());
            await(stopped, "A late UI stop cannot undo End/save");
            CountDownLatch recovered = new CountDownLatch(1);
            ride.recover(value -> {
                JSObject saved = value.getJSObject("snapshot");
                assertTrue(saved.optBoolean("finished"));
                assertEquals("test-rider", saved.optString("profileId"));
                assertTrue(saved.getJSObject("recorder").optJSONArray("samples").length() >= 3);
                recovered.countDown();
            }, reason -> { throw new AssertionError(reason); });
            await(recovered, "Completed ride must be recoverable from disk");
            assertEquals("Ending removes the ongoing notification", 0, manager.getActiveNotifications().length);
            CountDownLatch cleared = new CountDownLatch(1);
            ride.clear(reason -> cleared.countDown()); await(cleared, "Clear synthetic test ride");
        } finally {
            peripheral.shutdownNow();
            context.unbindService(connection);
            if (peer.get() != null) peer.get().close(1000, "Test complete");
            server.shutdown();
            shell("input keyevent 224"); shell("wm dismiss-keyguard");
        }
    }
}
