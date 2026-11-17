package com.openradlr.app.ride;

import com.capacitorjs.community.plugins.bluetoothle.BluetoothLe;
import com.getcapacitor.*;
import java.util.*;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.function.Consumer;

/** Reuses the BLE plugin's public native calls; there is only one GATT owner. */
public final class NativeBle implements BleTransport {
    private final Bridge bridge;
    private final BluetoothLe plugin;
    private final Map<String, PluginCall> listeners = new HashMap<>();
    private long sequence;
    private boolean closed;
    private final ExecutorService operations = Executors.newSingleThreadExecutor();
    private final Map<String, ArrayDeque<Runnable>> queues = new HashMap<>();
    public NativeBle(Bridge bridge) {
        this.bridge = bridge;
        plugin = (BluetoothLe) bridge.getPlugin("BluetoothLe").getInstance();
    }
    public synchronized void listen(String event, Consumer<JSObject> listener) {
        if (closed) return;
        if (listeners.containsKey(event)) return;
        PluginCall call = call("addListener", new JSObject().put("eventName", event), listener, error -> {});
        listeners.put(event, call);
        bridge.saveCall(call);
        operations.execute(() -> plugin.addListener(call));
    }
    public synchronized void invoke(String method, JSObject options, Consumer<JSObject> ok, Consumer<String> error) {
        if (closed) { error.accept("Ride Bluetooth transport is closed"); return; }
        String id = options.getString("deviceId", "adapter");
        ArrayDeque<Runnable> queue = queues.computeIfAbsent(id, key -> new ArrayDeque<>());
        queue.add(() -> {
            PluginCall call = call(method, options, value -> { complete(id); ok.accept(value); }, reason -> { complete(id); error.accept(reason); });
            operations.execute(() -> {
                try {
                    switch (method) {
                        case "connect" -> plugin.connect(call);
                        case "getServices" -> plugin.getServices(call);
                        case "startNotifications" -> plugin.startNotifications(call);
                        case "write" -> plugin.write(call);
                        case "writeWithoutResponse" -> plugin.writeWithoutResponse(call);
                        default -> call.reject("Unsupported native BLE operation");
                    }
                } catch (RuntimeException e) { call.reject(e.getMessage()); }
            });
        });
        if (queue.size() == 1) queue.peekFirst().run();
    }
    private synchronized void complete(String id) {
        ArrayDeque<Runnable> queue = queues.get(id);
        if (queue == null) return;
        queue.removeFirst();
        if (closed || queue.isEmpty()) queues.remove(id);
        else queue.peekFirst().run();
    }
    private PluginCall call(String method, JSObject options, Consumer<JSObject> ok, Consumer<String> error) {
        return new PluginCall(null, "BluetoothLe", "ride-native-" + (++sequence), method, options) {
            @Override public void resolve(JSObject value) { ok.accept(value == null ? new JSObject() : value); }
            @Override public void resolve() { ok.accept(new JSObject()); }
            @Override public void reject(String message, String code, Exception exception, JSObject data) { error.accept(message); }
            @Override public void setKeepAlive(Boolean value) { /* Native listeners are released explicitly. */ }
        };
    }
    public synchronized void close() {
        if (closed) return;
        closed = true;
        for (var entry : listeners.entrySet()) {
            PluginCall remove = call("removeListener", new JSObject().put("eventName", entry.getKey())
                .put("callbackId", entry.getValue().getCallbackId()), result -> {}, error -> {});
            operations.execute(() -> plugin.removeListener(remove));
        }
        listeners.clear();
        operations.shutdown();
    }
    public static String hex(byte[] bytes) {
        StringBuilder out = new StringBuilder();
        for (byte b : bytes) out.append(String.format(java.util.Locale.ROOT, "%02x", b & 255));
        return out.toString();
    }
}
