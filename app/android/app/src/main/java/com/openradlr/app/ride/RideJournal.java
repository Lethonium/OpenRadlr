package com.openradlr.app.ride;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import java.io.*;
import java.nio.charset.StandardCharsets;
import org.json.JSONObject;

/** One app-private, append-only ride; each complete sample is synced to disk. */
public final class RideJournal {
    private final File file;
    private FileOutputStream output;
    public RideJournal(File directory) { file = new File(directory, "active-ride.jsonl"); }
    public synchronized void start(JSObject snapshot) throws IOException {
        close();
        output = new FileOutputStream(file, false);
        append(new JSObject().put("snapshot", snapshot));
    }
    public synchronized void sample(RideEngine.Sample sample) throws IOException {
        append(new JSObject().put("sample", sampleJson(sample)));
    }
    public synchronized void checkpoint(JSObject snapshot) throws IOException { append(new JSObject().put("checkpoint", snapshot)); }
    private void append(JSObject value) throws IOException {
        if (output == null) return;
        output.write((value + "\n").getBytes(StandardCharsets.UTF_8));
        output.getFD().sync();
    }
    public synchronized JSObject recover() throws IOException {
        JSObject snapshot = null;
        JSArray samples = new JSArray();
        if (!file.exists()) return null;
        try (BufferedReader input = new BufferedReader(new InputStreamReader(new FileInputStream(file), StandardCharsets.UTF_8))) {
            String line;
            while ((line = input.readLine()) != null) {
                try {
                    JSONObject entry = new JSONObject(line);
                    if (entry.has("snapshot")) snapshot = JSObject.fromJSONObject(entry.getJSONObject("snapshot"));
                    if (entry.has("checkpoint") && snapshot != null) {
                        JSONObject update = entry.getJSONObject("checkpoint");
                        for (var keys = update.keys(); keys.hasNext();) {
                            String key = keys.next();
                            if (key.equals("recorder") && update.optJSONObject(key) != null && snapshot.optJSONObject(key) != null) {
                                JSONObject record = snapshot.getJSONObject(key), patch = update.getJSONObject(key);
                                for (var fields = patch.keys(); fields.hasNext();) { String field = fields.next(); record.put(field, patch.get(field)); }
                            } else snapshot.put(key, update.get(key));
                        }
                    }
                    if (entry.has("sample")) samples.put(entry.getJSONObject("sample"));
                } catch (org.json.JSONException ignored) { break; } // A torn final write does not discard earlier samples.
            }
        }
        if (snapshot == null) return null;
        JSONObject recorder = snapshot.optJSONObject("recorder");
        if (recorder == null) recorder = new JSONObject();
        JSArray combined = new JSArray();
        org.json.JSONArray prior = recorder.optJSONArray("samples");
        if (prior != null) for (int i = 0; i < prior.length(); i++) combined.put(prior.opt(i));
        for (int i = 0; i < samples.length(); i++) combined.put(samples.opt(i));
        try {
            recorder.put("samples", combined);
            if (!recorder.has("pauses")) recorder.put("pauses", new JSArray());
            snapshot.put("recorder", recorder);
            if (samples.length() > 0) {
                JSONObject last = samples.getJSONObject(samples.length() - 1);
                snapshot.put("savedAt", last.getLong("t"));
                snapshot.put("distance", last.getDouble("distance"));
                if (!snapshot.optBoolean("studio")) snapshot.put("resumePoint", new JSObject()
                    .put("routeId", last.opt("route")).put("distanceM", last.opt("routeM")));
            }
        } catch (org.json.JSONException e) { throw new IOException(e); }
        return snapshot;
    }
    public synchronized void close() throws IOException { if (output != null) { output.close(); output = null; } }
    public synchronized void clear() throws IOException { close(); if (file.exists() && !file.delete()) throw new IOException("Cannot remove ride journal"); }
    public static JSObject sampleJson(RideEngine.Sample s) {
        return new JSObject().put("t", s.t()).put("distance", s.distance()).put("power", s.power())
            .put("cadence", s.cadence() == null ? JSONObject.NULL : s.cadence())
            .put("heartRate", s.heartRate() == null ? JSONObject.NULL : s.heartRate())
            .put("speed", s.speed()).put("lat", JSONObject.NULL).put("lon", JSONObject.NULL).put("elevation", JSONObject.NULL).put("route", s.route() == null ? JSONObject.NULL : s.route())
            .put("routeM", s.routeM() == null ? JSONObject.NULL : s.routeM());
    }
}
