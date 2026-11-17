package com.openradlr.app.ride;

import static org.junit.Assert.*;
import com.getcapacitor.*;
import java.io.*;
import java.nio.file.Files;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

public class RideJournalTest {
    @Rule public TemporaryFolder directory = new TemporaryFolder();
    private JSObject snapshot() { return new JSObject().put("nativeRideId", "r").put("recorder", new JSObject().put("samples", new JSArray()).put("pauses", new JSArray())); }
    private RideEngine.Sample sample(long t) { return new RideEngine.Sample(t, 10, 215, 88.0, 144.0, 4, "r", 10.0); }
    @Test public void aNewProcessRecoversSyncedSamples() throws Exception {
        RideJournal journal = new RideJournal(directory.getRoot());
        journal.start(snapshot()); journal.sample(sample(1000)); journal.close();
        JSObject recovered = new RideJournal(directory.getRoot()).recover();
        assertEquals(215, recovered.getJSObject("recorder").getJSONArray("samples").getJSONObject(0).getDouble("power"), 0);
        assertEquals(1000, recovered.getLong("savedAt"));
    }
    @Test public void aTornLastWriteDoesNotLoseEarlierSamples() throws Exception {
        RideJournal journal = new RideJournal(directory.getRoot());
        journal.start(snapshot()); journal.sample(sample(1000)); journal.close();
        try (FileWriter file = new FileWriter(new File(directory.getRoot(), "active-ride.jsonl"), true)) { file.write("{broken"); }
        assertEquals(1, journal.recover().getJSObject("recorder").getJSONArray("samples").length());
    }
    @Test public void endAndSaveSurvivesAProcessRestart() throws Exception {
        RideJournal journal = new RideJournal(directory.getRoot());
        journal.start(snapshot()); journal.sample(sample(1000)); journal.checkpoint(new JSObject().put("finished", true)); journal.close();
        assertTrue(new RideJournal(directory.getRoot()).recover().getBoolean("finished"));
    }
    @Test public void updatingPauseMetadataPreservesSamplesFromAContinuedRide() throws Exception {
        JSObject saved = snapshot();
        saved.put("recorder", new JSObject().put("samples", new JSArray().put(RideJournal.sampleJson(sample(500)))).put("pauses", new JSArray()));
        RideJournal journal = new RideJournal(directory.getRoot()); journal.start(saved);
        journal.checkpoint(new JSObject().put("recorder", new JSObject().put("pauses", new JSArray().put(new JSObject().put("from", 600).put("to", 900)))));
        journal.sample(sample(1000)); journal.close();
        JSObject record = journal.recover().getJSObject("recorder");
        assertEquals(2, record.getJSONArray("samples").length());
        assertEquals(1, record.getJSONArray("pauses").length());
    }
    @Test public void discardingRemovesTheRecoveryJournal() throws Exception {
        RideJournal journal = new RideJournal(directory.getRoot()); journal.start(snapshot()); journal.sample(sample(1000)); journal.clear();
        assertNull(journal.recover());
    }
}
