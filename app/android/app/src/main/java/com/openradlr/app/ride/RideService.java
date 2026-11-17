package com.openradlr.app.ride;

import android.app.*;
import android.content.*;
import android.content.pm.ServiceInfo;
import android.os.*;
import android.widget.RemoteViews;
import android.view.View;
import androidx.core.app.NotificationCompat;
import com.getcapacitor.*;
import com.openradlr.app.BuildConfig;
import com.openradlr.app.MainActivity;
import com.openradlr.app.R;
import java.io.IOException;
import java.util.*;
import java.util.concurrent.TimeUnit;
import java.util.function.Consumer;
import okhttp3.*;
import org.json.*;

/** A user-started ride owns its radio callbacks, socket, clock and journal here. */
public class RideService extends Service {
    public static final String END = "com.openradlr.app.END_RIDE";
    private static final int NOTIFICATION_ID = 310;
    private static final String CHANNEL = "active-ride";
    public final class LocalBinder extends Binder { public RideService service() { return RideService.this; } }
    private final LocalBinder binder = new LocalBinder();
    private Handler worker;
    private HandlerThread thread;
    private PowerManager.WakeLock wakeLock;
    private final OkHttpClient http = new OkHttpClient.Builder().pingInterval(20, TimeUnit.SECONDS).build();
    private WebSocket socket;
    private String socketId, url, cookie, hello, join;
    private long socketGeneration;
    private int reconnectAttempt;
    private boolean reconnecting, intentionalClose;
    private Consumer<JSObject> emitter;
    private BleTransport ble;
    private final Map<String, double[][]> classSegments = new HashMap<>();
    private final Map<String, JSObject> watched = new LinkedHashMap<>();
    private final Set<String> reconnectingDevices = new HashSet<>();
    private final Map<String, JSObject> freshBle = new LinkedHashMap<>();
    private final Set<String> disconnectedDevices = new HashSet<>();
    private final Map<String, JSObject> latestFrames = new LinkedHashMap<>();
    private final ArrayDeque<JSObject> importantFrames = new ArrayDeque<>();
    private final List<JSObject> samples = new ArrayList<>();
    private RideEngine engine;
    private RideJournal journal;
    private JSObject baseline;
    private long riderId = -1, anchorWall, anchorElapsed, lastNotification;
    private String trainerId, hrId, error;
    private boolean imperial;
    private boolean active, ended, background, writing, canControl, controlRefused, afkWarning;
    private byte[] lastControl;

    @Override public void onCreate() {
        super.onCreate();
        thread = new HandlerThread("OpenRadlr ride"); thread.start(); worker = new Handler(thread.getLooper());
        journal = new RideJournal(getFilesDir());
        PowerManager power = (PowerManager) getSystemService(POWER_SERVICE);
        wakeLock = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "OpenRadlr:ride");
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel channel = new NotificationChannel(CHANNEL, getString(R.string.ride_channel), NotificationManager.IMPORTANCE_LOW);
            channel.setDescription(getString(R.string.ride_channel_description));
            channel.setShowBadge(false);
            ((NotificationManager) getSystemService(NOTIFICATION_SERVICE)).createNotificationChannel(channel);
        }
    }
    @Override public IBinder onBind(Intent intent) { return binder; }
    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && END.equals(intent.getAction())) {
            worker.post(() -> endFromNotification());
            return START_NOT_STICKY;
        }
        if (Build.VERSION.SDK_INT >= 29) startForeground(NOTIFICATION_ID, notification(), ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE);
        else startForeground(NOTIFICATION_ID, notification());
        return START_NOT_STICKY;
    }
    public void execute(Runnable task) { worker.post(task); }
    public void attach(BleTransport nativeBle, Consumer<JSObject> events) { execute(() -> { if (!active && ble != nativeBle) { if (ble != null) ble.close(); watched.clear(); freshBle.clear(); ble = nativeBle; } if (events != null) emitter = events; }); }
    public void background(boolean value) {
        execute(() -> {
            boolean wasBackground = background;
            background = value;
            if (engine != null) engine.background = value;
            if (!value) {
                for (JSObject packet : freshBle.values()) if (SystemClock.elapsedRealtime() - packet.optLong("at") <= 2000) emit(packet);
                for (String id : disconnectedDevices) emit(new JSObject().put("type", "ble").put("event", "disconnected|" + id).put("value", new JSObject()));
                for (JSObject frame : importantFrames) emit(frame);
                importantFrames.clear();
                for (JSObject frame : latestFrames.values()) emit(frame);
                latestFrames.clear();
                emit(new JSObject().put("type", "rideState").put("ended", ended).put("resumed", wasBackground));
            }
        });
    }

    /** Starts with an existing native BLE connection and the existing game's rider. */
    public void startRide(JSObject data, Consumer<JSObject> ok, Consumer<String> fail) {
        execute(() -> {
            try {
                if (active) { fail.accept("A ride is already active"); return; }
                baseline = data.getJSObject("snapshot", new JSObject());
                trainerId = data.getString("trainerId"); hrId = data.getString("hrId");
                if (trainerId == null || socket == null || riderId < 0) { fail.accept("Connect a trainer and join a ride first"); return; }
                samples.clear(); error = null; ended = false; controlRefused = afkWarning = false;
                anchorWall = System.currentTimeMillis(); anchorElapsed = SystemClock.elapsedRealtime();
                journal.start(baseline);
                engine = new RideEngine(sample -> {
                    JSObject value = RideJournal.sampleJson(sample);
                    samples.add(value);
                    try { journal.sample(sample); } catch (IOException e) { recordingError(); }
                });
                engine.distance = baseline.optDouble("distance", 0);
                engine.durationS = baseline.optDouble("recordDurationS", 0);
                engine.background = background;
                configure(data.getJSObject("control", new JSObject()));
                for (JSObject packet : freshBle.values()) {
                    if (SystemClock.elapsedRealtime() - packet.optLong("at") > 2000) continue;
                    String[] parts = packet.optString("event").split("\\|", -1);
                    if (parts.length == 4) engine.packet(parts[1].equals(trainerId) ? "trainer" : parts[1].equals(hrId) ? "hr" : "other", shortUuid(parts[3]), packet.getJSObject("value", new JSObject()).optString("value", ""), packet.optLong("at"));
                }
                active = true;
                worker.removeCallbacks(tick); worker.post(tick);
                wakeLock.acquire(12 * 60 * 60 * 1000L);
                ok.accept(new JSObject().put("active", true));
            } catch (Exception e) { active = false; stopResources(); fail.accept(e.getMessage()); }
        });
    }
    public void update(JSObject data) { execute(() -> {
        if (!active) return;
        if (!background) { JSObject control = data.getJSObject("control"); if (control != null) configure(control); }
        JSObject checkpoint = data.getJSObject("checkpoint");
        if (checkpoint != null) try { journal.checkpoint(checkpoint); } catch (IOException e) { recordingError(); }
    }); }
    private void configure(JSObject data) {
        if (engine == null) return;
        RideEngine.Control c = new RideEngine.Control();
        c.difficulty = finite(data, "difficulty", 1); c.crr = finite(data, "crr", .004);
        c.ftp = finite(data, "ftp", 200); c.intensity = finite(data, "intensity", 1);
        c.ratio = finite(data, "ratio", 0); c.referenceRatio = finite(data, "referenceRatio", 1);
        c.mass = finite(data, "mass", 85); c.cda = finite(data, "cda", .32); c.airDensity = finite(data, "airDensity", 1.225);
        c.elapsed = finite(data, "elapsed", 0); c.erg = data.optBoolean("erg"); c.classClock = data.optBoolean("classClock");
        if (!data.isNull("target") && data.has("target")) c.target = finite(data, "target", 0);
        c.segments = segmentsOf(data.optJSONArray("segments"));
        JSONObject classes = data.optJSONObject("classes");
        if (classes != null) for (Iterator<String> keys = classes.keys(); keys.hasNext();) {
            String id = keys.next(); classSegments.put(id, segmentsOf(classes.optJSONArray(id)));
        }
        engine.control = c;
        imperial = "imperial".equals(data.optString("units"));
        engine.paused = data.optBoolean("paused"); canControl = data.optBoolean("canControl");
        JSONObject lengths = data.optJSONObject("routeLengths");
        if (lengths != null) for (Iterator<String> keys = lengths.keys(); keys.hasNext();) {
            String key = keys.next(); double length = lengths.optDouble(key, 0);
            if (length > 0 && Double.isFinite(length)) engine.routeLengths.put(key, length);
        }
        JSONObject loops = data.optJSONObject("routeLoops");
        if (loops != null) for (Iterator<String> keys = loops.keys(); keys.hasNext();) {
            String key = keys.next(); engine.routeLoops.put(key, loops.optBoolean(key));
        }
    }
    private static double[][] segmentsOf(JSONArray segments) {
        List<double[]> valid = new ArrayList<>();
        if (segments != null && segments.length() <= 500) for (int i = 0; i < segments.length(); i++) {
            JSONObject segment = segments.optJSONObject(i);
            if (segment == null) continue;
            double duration = segment.optDouble("durationS", 0), from = segment.optDouble("from", Double.NaN), to = segment.optDouble("to", Double.NaN);
            if (duration > 0 && Double.isFinite(duration) && Double.isFinite(from) && Double.isFinite(to))
                valid.add(new double[] {Math.min(21600, duration), Math.max(0, Math.min(3, from)), Math.max(0, Math.min(3, to))});
        }
        return valid.toArray(new double[0][]);
    }
    public void snapshot(long since, Consumer<JSObject> ok) { execute(() -> {
        JSArray pending = new JSArray();
        for (JSObject sample : samples) if (sample.optLong("t") > since && pending.length() < 1000) pending.put(sample);
        ok.accept(new JSObject().put("samples", pending).put("active", active).put("ended", ended)
            .put("distance", engine == null ? 0 : engine.distance).put("elapsed", engine == null ? 0 : engine.control.elapsed)
            .put("background", background).put("error", error == null ? JSONObject.NULL : error));
    }); }
    public void recover(Consumer<JSObject> ok, Consumer<String> fail) { execute(() -> {
        try { JSObject recovered = journal.recover(); ok.accept(new JSObject().put("snapshot", recovered == null ? JSONObject.NULL : recovered)); }
        catch (IOException e) { fail.accept(e.getMessage()); }
    }); }
    public void clear(Consumer<String> done) { execute(() -> { try {
        if (active) { done.accept("Cannot discard an active ride"); return; }
        journal.clear(); done.accept(null);
    } catch (IOException e) { done.accept(e.getMessage()); } }); }
    public void stopRide(boolean finished, Consumer<JSObject> ok) { execute(() -> {
        ended = ended || finished; finishJournal(ended); active = false; stopResources();
        snapshot(samples.size() > 1000 ? samples.get(samples.size() - 1001).optLong("t") : -1, ok);
    }); }
    private void finishJournal(boolean finished) {
        try { journal.checkpoint(new JSObject().put("finished", finished)); journal.close(); }
        catch (IOException e) { recordingError(); }
    }
    private void stopResources() {
        if (wakeLock.isHeld()) wakeLock.release();
        stopForeground(STOP_FOREGROUND_REMOVE); stopSelf();
    }
    private void recordingError() {
        error = "journal";
        notifyStats();
    }
    private final Runnable tick = new Runnable() {
        @Override public void run() {
            if (active && engine != null) {
                long elapsed = SystemClock.elapsedRealtime();
                engine.tick(anchorWall + elapsed - anchorElapsed, elapsed);
                if (background) {
                    double[] reading = engine.telemetry(elapsed);
                    JSObject telemetry = new JSObject().put("type", "telemetry").put("power", reading[0]);
                    if (Double.isFinite(reading[1])) telemetry.put("cadence", reading[1]);
                    sendNative(telemetry.toString());
                    if (canControl && !writing) writeControl(engine.command(elapsed).bytes());
                }
                if (elapsed - lastNotification >= 2000) { lastNotification = elapsed; notifyStats(); }
            }
            if (active) worker.postDelayed(this, 250);
        }
    };

    /** Native subscription taps receive packets even if JavaScript is suspended. */
    public void observeEvent(String requestedEvent) { execute(() -> {
        if (ble == null) return;
        String[] parts = requestedEvent.split("\\|", -1);
        if (parts.length == 4 && parts[0].equals("notification")) {
            if (parts[2].length() == 4) parts[2] = uuid(parts[2]);
            if (parts[3].length() == 4) parts[3] = uuid(parts[3]);
        }
        String event = parts.length == 4 ? parts[0] + "|" + parts[1] + "|" + parts[2] + "|" + parts[3] : requestedEvent;
        if (parts.length == 4 && parts[0].equals("notification")) {
            JSObject options = new JSObject().put("deviceId", parts[1]).put("service", parts[2]).put("characteristic", parts[3]);
            watched.put(event, options);
        }
        ble.listen(event, value -> execute(() -> {
            long now = SystemClock.elapsedRealtime();
            JSObject packet = new JSObject().put("type", "ble").put("event", event).put("value", value).put("at", now);
            if (parts.length == 4 && parts[0].equals("notification")) {
                freshBle.put(event, packet);
                if (parts[1].equals(trainerId) && "2ad9".equals(shortUuid(parts[3]))) {
                    String response = value.optString("value", "").replace(" ", "").toLowerCase(java.util.Locale.ROOT);
                    if (response.length() >= 6 && response.startsWith("80") && !response.substring(4, 6).equals("01")) { canControl = false; controlRefused = true; }
                }
                if (active && engine != null) engine.packet(parts[1].equals(trainerId) ? "trainer" : parts[1].equals(hrId) ? "hr" : "other", shortUuid(parts[3]), value.optString("value", ""), now);
            }
            if (parts.length == 2 && parts[0].equals("disconnected")) {
                disconnectedDevices.add(parts[1]);
                if (parts[1].equals(trainerId) && engine != null) engine.disconnected();
                if (active && background && (parts[1].equals(trainerId) || parts[1].equals(hrId))) reconnectDevice(parts[1], 0);
            }
            if (!active || !background) emit(packet);
        }));
    }); }
    public void bleOperation(String method, JSObject options, Consumer<JSObject> ok, Consumer<String> fail) {
        execute(() -> {
            if (background && active && (method.equals("write") || method.equals("writeWithoutResponse"))
                && Objects.equals(trainerId, options.getString("deviceId")) && "2ad9".equals(shortUuid(options.getString("characteristic", "")))) {
                ok.accept(new JSObject()); return;
            }
            if (ble == null) { fail.accept("Bluetooth is unavailable"); return; }
            ble.invoke(method, options, value -> {
                if (method.equals("connect")) execute(() -> disconnectedDevices.remove(options.getString("deviceId")));
                ok.accept(value);
            }, fail);
        });
    }
    private void reconnectDevice(String id, int attempt) {
        if (!active || !background || !reconnectingDevices.add(id)) return;
        worker.postDelayed(() -> {
            if (!active || !background) { reconnectingDevices.remove(id); return; }
            JSObject options = new JSObject().put("deviceId", id).put("timeout", 10000);
            ble.invoke("connect", options, connected -> ble.invoke("getServices", options, services -> execute(() -> {
                List<JSObject> subscriptions = new ArrayList<>();
                for (JSObject value : watched.values()) if (id.equals(value.getString("deviceId"))) subscriptions.add(value);
                restoreSubscriptions(id, subscriptions, 0, attempt);
            }), reason -> retryDevice(id, attempt)), reason -> retryDevice(id, attempt));
        }, Math.min(15000, 1000L << Math.min(attempt, 4)));
    }
    private void retryDevice(String id, int attempt) { execute(() -> { reconnectingDevices.remove(id); reconnectDevice(id, attempt + 1); }); }
    private void restoreSubscriptions(String id, List<JSObject> subscriptions, int index, int attempt) {
        if (index == subscriptions.size()) {
            reconnectingDevices.remove(id); disconnectedDevices.remove(id); lastControl = null;
            if (id.equals(trainerId) && canControl) requestControl();
            return;
        }
        ble.invoke("startNotifications", subscriptions.get(index), result -> execute(() -> restoreSubscriptions(id, subscriptions, index + 1, attempt)), reason -> retryDevice(id, attempt));
    }
    private JSObject controlOptions(byte[] bytes) {
        return new JSObject().put("deviceId", trainerId).put("service", uuid("1826"))
            .put("characteristic", uuid("2ad9")).put("value", NativeBle.hex(bytes));
    }
    private void requestControl() {
        ble.invoke("write", controlOptions(new byte[] {0}), value -> ble.invoke("write", controlOptions(new byte[] {7}), started -> {}, error -> {}), error -> {});
    }
    private void writeControl(byte[] bytes) {
        if (ble == null || trainerId == null || Arrays.equals(bytes, lastControl)) return;
        writing = true;
        ble.invoke("write", controlOptions(bytes), value -> execute(() -> { writing = false; lastControl = bytes; }), reason -> execute(() -> { writing = false; lastControl = null; }));
    }

    public void openSocket(String id, String address, String cookies) { execute(() -> {
        intentionalClose = true;
        if (socket != null) socket.cancel();
        socketId = id; url = address; cookie = cookies; hello = join = null; riderId = -1;
        reconnectAttempt = 0; reconnecting = false; intentionalClose = false; connectSocket(false);
    }); }
    private void connectSocket(boolean resume) {
        long generation = ++socketGeneration;
        Request.Builder request = new Request.Builder().url(url)
            .header("Origin", (url.startsWith("wss:") ? "https://" : "http://") + java.net.URI.create(url).getRawAuthority())
            .header("User-Agent", "OpenRadlr/" + BuildConfig.VERSION_NAME + " (android; build/" + BuildConfig.VERSION_CODE + ")");
        if (cookie != null && !cookie.isEmpty()) request.header("Cookie", cookie);
        socket = http.newWebSocket(request.build(), new WebSocketListener() {
            @Override public void onOpen(WebSocket webSocket, Response response) { execute(() -> {
                if (generation != socketGeneration) return;
                if (resume && hello != null) webSocket.send(hello);
                else socketEvent("open", null);
            }); }
            @Override public void onMessage(WebSocket webSocket, String text) { execute(() -> {
                if (generation != socketGeneration) return;
                if (resume && handleResumeHandshake(text)) return;
                handleServer(text); socketEvent("message", text);
            }); }
            @Override public void onFailure(WebSocket webSocket, Throwable throwable, Response response) { execute(() -> socketLost(generation)); }
            @Override public void onClosed(WebSocket webSocket, int code, String reason) { execute(() -> socketLost(generation)); }
        });
    }
    private boolean handleResumeHandshake(String text) {
        try {
            JSONObject message = new JSONObject(text);
            if (message.optString("type").equals("welcome") && join != null) { sendNative(join); return true; }
        } catch (JSONException ignored) {}
        return false;
    }
    private void socketLost(long generation) {
        if (generation != socketGeneration || intentionalClose) return;
        if (active && background && join != null && hello != null) {
            reconnecting = true;
            int attempt = reconnectAttempt++;
            worker.postDelayed(() -> { if (active && reconnecting && generation == socketGeneration) connectSocket(true); }, Math.min(30000, 1000L << Math.min(attempt, 5)));
        } else { socketEvent("close", null); }
    }
    public void send(String id, String text) { execute(() -> {
        if (!Objects.equals(id, socketId)) return;
        try {
            JSONObject message = new JSONObject(text); String type = message.optString("type");
            if (type.equals("hello")) hello = text;
            if (type.equals("join")) join = text;
            if (type.equals("telemetry") && background && active) return;
            if (engine != null && (type.equals("pause") || type.equals("resume"))) engine.paused = type.equals("pause");
            sendNative(text);
            if (type.equals("leave")) { finishJournal(true); active = false; ended = true; stopResources(); }
        } catch (JSONException ignored) {}
    }); }
    public void closeSocket(String id) { execute(() -> {
        if (!Objects.equals(id, socketId)) return;
        intentionalClose = true; reconnecting = false; ++socketGeneration;
        if (socket != null) socket.close(1000, "Ride closed");
        socketEvent("close", null); socket = null;
    }); }
    private void sendNative(String text) { if (socket != null) socket.send(text); }
    private void handleServer(String text) {
        try {
            JSONObject message = new JSONObject(text); String type = message.optString("type");
            if (type.equals("joined")) {
                riderId = message.optLong("rider_id", -1); reconnectAttempt = 0; reconnecting = false;
                if (engine != null) engine.resetPosition();
                if (join != null && message.has("resume_token")) {
                    JSONObject profile = new JSONObject(join); profile.put("resume_token", message.get("resume_token")); join = profile.toString();
                    if (active) journal.checkpoint(new JSObject().put("resumeToken", message.get("resume_token")).put("riderId", riderId));
                }
            }
            if (engine == null) return;
            if (type.equals("error") && "pause_rejected".equals(message.optString("code"))) engine.paused = false;
            if (type.equals("studio_state") && engine.control.classClock) {
                JSONObject currentClass = message.optJSONObject("class");
                if (currentClass != null) {
                    engine.control.segments = classSegments.getOrDefault(currentClass.optString("id"), new double[0][]);
                    engine.control.elapsed = finite(currentClass, "elapsed_s", 0);
                }
            }
            if (type.equals("resistance")) engine.resistance(message.optDouble("grade_percent", 0));
            if (type.equals("state") || type.equals("studio_state")) {
                JSONArray riders = message.optJSONArray("riders");
                List<RideEngine.Rider> drafting = new ArrayList<>();
                if (type.equals("state") && riders != null) for (int i = 0; i < riders.length(); i++) {
                    JSONObject rider = riders.optJSONObject(i);
                    if (rider != null && rider.isNull("studio")) drafting.add(new RideEngine.Rider(rider.optLong("id", -2),
                        rider.optString("route", null), rider.optDouble("distance", Double.NaN), rider.optDouble("lane", Double.NaN)));
                }
                engine.draft(riderId, drafting, SystemClock.elapsedRealtime());
                if (riders != null) for (int i = 0; i < riders.length(); i++) {
                    JSONObject rider = riders.optJSONObject(i);
                    if (rider != null && rider.optLong("id", -2) == riderId) {
                        String route = rider.isNull("route") ? null : rider.optString("route", null);
                        engine.state(route, rider.optDouble("distance", 0), rider.optDouble("speed", 0), SystemClock.elapsedRealtime());
                        if (join != null && route != null) {
                            JSONObject profile = new JSONObject(join);
                            profile.put("resume", new JSObject().put("route_id", route).put("distance_m", rider.optDouble("distance", 0)));
                            join = profile.toString();
                        }
                    }
                }
            }
            if (type.equals("afk_warning") && background) { afkWarning = true; notifyStats(); }
        } catch (JSONException | IOException ignored) {}
    }
    private void socketEvent(String type, String text) {
        JSObject event = new JSObject().put("type", type).put("id", socketId);
        if (text != null) event.put("data", text);
        if (active && background && type.equals("message")) {
            try {
                String messageType = new JSONObject(text).optString("type");
                if (Arrays.asList("state", "studio_state", "resistance").contains(messageType)) latestFrames.put(messageType, event);
                else { if (importantFrames.size() >= 64) importantFrames.removeFirst(); importantFrames.addLast(event); }
            } catch (JSONException ignored) {}
        } else emit(event);
    }
    private void emit(JSObject event) {
        if (emitter != null) try { emitter.accept(event); } catch (RuntimeException ignored) { emitter = null; }
    }
    public void detach() { execute(() -> emitter = null); }

    private void endFromNotification() {
        if (!active) return;
        if (canControl && ble != null) ble.invoke("write", controlOptions(new RideEngine.Command(null, 0, .004, .51).bytes()), value -> {}, reason -> {});
        intentionalClose = true;
        sendNative("{\"type\":\"leave\"}");
        if (socket != null) socket.close(1000, "Ride ended"); reconnecting = false;
        finishJournal(true); active = false; ended = true; stopResources();
        emit(new JSObject().put("type", "rideState").put("ended", true));
    }
    private Notification notification() {
        long elapsed = SystemClock.elapsedRealtime();
        double watts = engine == null ? 0 : engine.power(elapsed), distance = engine == null ? 0 : engine.distance;
        long duration = engine == null ? 0 : Math.max(0, (long) engine.durationS);
        PendingIntent back = PendingIntent.getActivity(this, 0, new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        PendingIntent end = PendingIntent.getService(this, 1, new Intent(this, RideService.class).setAction(END), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        double shownDistance = distance / (imperial ? 1609.344 : 1000);
        String unit = imperial ? "mi" : "km";
        String clock = String.format(java.util.Locale.getDefault(), "%02d:%02d", duration / 60, duration % 60);
        String stats = getString(R.string.ride_stats, Math.round(watts), clock, shownDistance, unit);
        RemoteViews compact = new RemoteViews(getPackageName(), R.layout.ride_notification_compact);
        compact.setTextViewText(R.id.compact_stats, getString(R.string.ride_compact_stats, Math.round(watts), shownDistance, unit));
        compact.setChronometer(R.id.compact_clock, SystemClock.elapsedRealtime() - duration * 1000, "%s", active && engine != null && !engine.paused);
        RemoteViews expanded = new RemoteViews(getPackageName(), R.layout.ride_notification);
        expanded.setTextViewText(R.id.notification_route, baseline == null ? "OpenRadlr" : baseline.optString("routeName", "OpenRadlr"));
        expanded.setTextViewText(R.id.notification_power, getString(R.string.ride_watts, Math.round(watts)));
        Double cadence = engine == null ? null : engine.cadence(elapsed);
        expanded.setTextViewText(R.id.notification_cadence, cadence == null ? "– rpm" : getString(R.string.ride_cadence, Math.round(cadence)));
        expanded.setTextViewText(R.id.notification_distance, getString(R.string.ride_distance, shownDistance, unit));
        expanded.setTextViewText(R.id.notification_time, getString(R.string.ride_elapsed, duration / 3600, duration / 60 % 60, duration % 60));
        int status = error != null ? R.string.ride_storage_error : afkWarning ? R.string.ride_afk : controlRefused ? R.string.ride_control_refused : engine != null && engine.fresh(elapsed) ? R.string.ride_background_message : R.string.ride_no_signal;
        expanded.setTextViewText(R.id.notification_status, getString(status));
        double progress = engine == null ? -1 : engine.progress();
        expanded.setViewVisibility(R.id.notification_progress, progress < 0 ? View.GONE : View.VISIBLE);
        expanded.setProgressBar(R.id.notification_progress, 1000, (int) Math.round(Math.max(0, progress) * 1000), false);
        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.notification_brand).setColor(0xffffcf00)
            .setContentTitle(getString(R.string.ride_notification_title)).setContentText(stats)
            .setSubText(baseline == null ? "OpenRadlr" : baseline.optString("routeName", "OpenRadlr"))
            .setStyle(new NotificationCompat.DecoratedCustomViewStyle()).setCustomContentView(compact).setCustomBigContentView(expanded)
            .setOngoing(true).setOnlyAlertOnce(true).setSilent(true).setContentIntent(back)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .addAction(0, getString(R.string.ride_return), back).addAction(0, getString(R.string.ride_end_save), end);
        return builder.build();
    }
    private void notifyStats() { if (!active) return; ((NotificationManager) getSystemService(NOTIFICATION_SERVICE)).notify(NOTIFICATION_ID, notification()); }
    @Override public void onDestroy() {
        active = false; worker.removeCallbacksAndMessages(null);
        intentionalClose = true; if (socket != null) socket.cancel();
        if (ble != null) ble.close();
        try { journal.close(); } catch (IOException ignored) {}
        if (wakeLock.isHeld()) wakeLock.release();
        http.dispatcher().executorService().shutdown(); thread.quitSafely();
        super.onDestroy();
    }
    private static double finite(JSONObject data, String key, double fallback) { double value = data.optDouble(key, fallback); return Double.isFinite(value) ? value : fallback; }
    private static String uuid(String shortId) { return "0000" + shortId + "-0000-1000-8000-00805f9b34fb"; }
    private static String shortUuid(String value) { return value.startsWith("0000") && value.length() == 36 ? value.substring(4, 8) : value; }
}
