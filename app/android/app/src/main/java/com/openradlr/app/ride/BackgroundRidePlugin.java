package com.openradlr.app.ride;

import android.Manifest;
import android.content.*;
import android.net.Uri;
import android.os.*;
import android.provider.Settings;
import android.webkit.CookieManager;
import androidx.core.content.ContextCompat;
import androidx.lifecycle.Lifecycle;
import com.getcapacitor.*;
import com.getcapacitor.annotation.*;
import java.net.URI;
import java.util.*;
import java.util.function.Consumer;

@CapacitorPlugin(name = "BackgroundRide", permissions = @Permission(alias = "notifications", strings = Manifest.permission.POST_NOTIFICATIONS))
public class BackgroundRidePlugin extends Plugin {
    private RideService service;
    private boolean binding;
    private final List<Consumer<RideService>> pending = new ArrayList<>();
    private final ServiceConnection connection = new ServiceConnection() {
        @Override public void onServiceConnected(ComponentName name, IBinder binder) {
            service = ((RideService.LocalBinder) binder).service();
            service.attach(new NativeBle(bridge), event -> notifyListeners("event", event));
            service.background(!getActivity().hasWindowFocus());
            List<Consumer<RideService>> ready = new ArrayList<>(pending); pending.clear();
            for (Consumer<RideService> task : ready) task.accept(service);
        }
        @Override public void onServiceDisconnected(ComponentName name) {
            service = null; binding = false;
            notifyListeners("event", new JSObject().put("type", "serviceLost"));
        }
    };
    private void withService(Consumer<RideService> task) {
        bridge.executeOnMainThread(() -> {
            if (service != null) { task.accept(service); return; }
            pending.add(task);
            if (!binding) {
                binding = true;
                if (!getContext().bindService(new Intent(getContext(), RideService.class), connection, Context.BIND_AUTO_CREATE)) {
                    binding = false; pending.clear();
                    notifyListeners("event", new JSObject().put("type", "serviceLost"));
                }
            }
        });
    }
    @PluginMethod public void openSocket(PluginCall call) {
        String id = call.getString("id"), url = call.getString("url");
        try {
            URI address = URI.create(url), server = URI.create(bridge.getConfig().getServerUrl());
            String scheme = server.getScheme().equals("https") ? "wss" : "ws";
            if (id == null || !scheme.equals(address.getScheme()) || !Objects.equals(server.getHost(), address.getHost())
                || server.getPort() != address.getPort() || !"/ws".equals(address.getPath()) || address.getUserInfo() != null) {
                call.reject("The ride socket must use this app's server"); return;
            }
            bridge.executeOnMainThread(() -> {
                String cookie = CookieManager.getInstance().getCookie(server.toString());
                withService(s -> { s.openSocket(id, url, cookie); call.resolve(); });
            });
        } catch (RuntimeException e) { call.reject("Invalid ride server URL"); }
    }
    @PluginMethod public void sendSocket(PluginCall call) {
        String text = call.getString("data", "");
        if (text.length() > 16384) { call.reject("Ride message is too large"); return; }
        withService(s -> { s.send(call.getString("id"), text); call.resolve(); });
    }
    @PluginMethod public void closeSocket(PluginCall call) { withService(s -> { s.closeSocket(call.getString("id")); call.resolve(); }); }
    @PluginMethod public void observeEvent(PluginCall call) {
        String event = call.getString("event", "");
        if (event.length() > 256) { call.reject("Invalid Bluetooth event"); return; }
        withService(s -> { s.observeEvent(event); call.resolve(); });
    }
    @PluginMethod public void bleOperation(PluginCall call) {
        String method = call.getString("method", "");
        if (!Arrays.asList("connect", "getServices", "startNotifications", "write", "writeWithoutResponse").contains(method)) { call.reject("Unsupported Bluetooth operation"); return; }
        JSObject options = call.getObject("options");
        if (options == null) { call.reject("Bluetooth options are missing"); return; }
        withService(s -> s.bleOperation(method, options, call::resolve, call::reject));
    }
    @PluginMethod public void startRide(PluginCall call) {
        if (Build.VERSION.SDK_INT >= 33 && getPermissionState("notifications") != PermissionState.GRANTED
            && !getContext().getSharedPreferences("ride", Context.MODE_PRIVATE).getBoolean("askedNotification", false)) {
            getContext().getSharedPreferences("ride", Context.MODE_PRIVATE).edit().putBoolean("askedNotification", true).apply();
            requestPermissionForAlias("notifications", call, "notificationsResult");
            return;
        }
        begin(call);
    }
    @PermissionCallback private void notificationsResult(PluginCall call) { begin(call); }
    private void begin(PluginCall call) {
        withService(s -> {
            if (getActivity().isFinishing() || !getActivity().getLifecycle().getCurrentState().isAtLeast(Lifecycle.State.STARTED)) { call.reject("Start background riding while the app is visible", "BACKGROUND_START"); return; }
            s.startRide(call.getData(), result -> bridge.executeOnMainThread(() -> {
                try {
                    ContextCompat.startForegroundService(getContext(), new Intent(getContext(), RideService.class));
                    call.resolve(result);
                } catch (RuntimeException e) {
                    s.stopRide(false, stopped -> call.reject("Android could not start background riding", "BACKGROUND_START", e));
                }
            }), reason -> call.reject(reason, "BACKGROUND_START"));
        });
    }
    @PluginMethod public void updateRide(PluginCall call) { withService(s -> { s.update(call.getData()); call.resolve(); }); }
    @PluginMethod public void snapshot(PluginCall call) { withService(s -> s.snapshot(call.getLong("since", -1L), call::resolve)); }
    @PluginMethod public void stopRide(PluginCall call) { withService(s -> s.stopRide(call.getBoolean("finished", false), call::resolve)); }
    @PluginMethod public void recover(PluginCall call) { withService(s -> s.recover(call::resolve, call::reject)); }
    @PluginMethod public void clear(PluginCall call) { withService(s -> s.clear(error -> { if (error == null) call.resolve(); else call.reject(error); })); }
    @PluginMethod public void openSettings(PluginCall call) {
        bridge.executeOnMainThread(() -> {
            String kind = call.getString("kind", "app");
            Intent intent = kind.equals("bluetooth") ? new Intent(Settings.ACTION_BLUETOOTH_SETTINGS)
                : new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getContext().getPackageName()));
            try { getActivity().startActivity(intent); call.resolve(); }
            catch (RuntimeException e) { call.reject("Settings could not be opened", e); }
        });
    }
    @Override protected void handleOnStop() { if (service != null) service.background(true); }
    @Override protected void handleOnResume() { if (service != null) service.background(false); }
    @Override protected void handleOnDestroy() {
        if (service != null) service.detach();
        if (binding) { getContext().unbindService(connection); binding = false; }
    }
}
