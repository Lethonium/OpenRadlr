package com.openradlr.app.ride;

import static org.junit.Assert.*;
import java.util.ArrayList;
import java.util.List;
import org.junit.Test;

public class RideEngineTest {
    @Test public void nativeTicksKeepRecordingWithoutAnyWebViewFrames() {
        List<RideEngine.Sample> samples = new ArrayList<>();
        RideEngine engine = new RideEngine(samples::add);
        engine.packet("trainer", "2ad2", "44001c0cB000d700", 0);
        engine.tick(1000, 1000);
        engine.tick(2000, 2000);
        assertEquals(2, samples.size());
        assertEquals(215, samples.get(1).power(), 0);
    }
    @Test public void stalePowerIsNeverReplayedAfterATrainerDrop() {
        RideEngine engine = new RideEngine(sample -> {});
        engine.packet("trainer", "2ad2", "44001c0cb000d700", 0);
        engine.tick(1000, 1000);
        engine.tick(7000, 7000);
        assertEquals(0, engine.power(7000), 0);
    }
    @Test public void truncatedPacketsDoNotTurnIntoInventedReadings() {
        RideEngine engine = new RideEngine(sample -> {});
        engine.packet("trainer", "2ad2", "4400", 1000);
        assertEquals(0, engine.power(1000), 0);
    }
    @Test public void backgroundTelemetryNeverContainsHeartRate() {
        RideEngine engine = new RideEngine(sample -> {});
        engine.packet("trainer", "2ad2", "44021c0cb000d70090", 0);
        assertEquals(144, engine.heartRate(1000), 0);
        assertArrayEquals(new double[] {215, 88}, engine.telemetry(1000), 0);
    }
    @Test public void repeatedTicksDoNotDuplicateASample() {
        List<RideEngine.Sample> samples = new ArrayList<>();
        RideEngine engine = new RideEngine(samples::add);
        engine.tick(1000, 1000);
        engine.tick(1100, 1100);
        assertEquals(1, samples.size());
    }
    @Test public void pausedRidesDoNotRecordSamples() {
        List<RideEngine.Sample> samples = new ArrayList<>();
        RideEngine engine = new RideEngine(samples::add);
        engine.paused = true;
        engine.tick(1000, 1000);
        assertTrue(samples.isEmpty());
    }
    @Test public void roadDistanceWrapsWithoutLosingALap() {
        RideEngine e = new RideEngine(sample -> {});
        e.routeLengths.put("r", 1000.0);
        e.state("r", 995, 10, 0);
        e.state("r", 5, 10, 1000);
        assertEquals(10, e.distance, 0);
    }
    @Test public void aSocketOutageDoesNotAddImaginaryDistance() {
        RideEngine e = new RideEngine(sample -> {});
        e.state("r", 10, 10, 0);
        e.state("r", 1000, 10, 60000);
        assertEquals(0, e.distance, 0);
    }
    @Test public void aWorkoutRunsOnlyWithFreshPedallingData() {
        RideEngine e = new RideEngine(sample -> {});
        e.background = true;
        e.packet("trainer", "2ad2", "44001c0cb000d700", 0);
        e.tick(0, 0);
        e.tick(1000, 1000);
        assertEquals(1, e.control.elapsed, 0);
        e.tick(7000, 7000);
        assertEquals(1, e.control.elapsed, 0);
    }
    @Test public void aWorkoutRampControlsTheTrainerWithoutWebViewFrames() {
        RideEngine e = new RideEngine(sample -> {});
        e.packet("trainer", "2ad2", "44001c0cb000d700", 0);
        e.control.erg = true; e.control.ftp = 200; e.control.elapsed = 30;
        e.control.segments = new double[][] {{60, .5, 1}};
        assertEquals(150, e.command(1000).power(), 0);
    }
    @Test public void roadResistanceIsEasedRatherThanJumpingAfterAChange() {
        RideEngine e = new RideEngine(sample -> {});
        e.packet("trainer", "2ad2", "44001c0cb000d700", 0);
        e.resistance(0); e.tick(0, 0); e.resistance(10); e.tick(1000, 1000);
        assertEquals(1.5, e.command(1000).grade(), 0);
    }
    @Test public void staleSensorsReleaseAnErgTarget() {
        RideEngine e = new RideEngine(sample -> {});
        e.packet("trainer", "2ad2", "44001c0cb000d700", 0);
        e.control.erg = true; e.control.target = 300.0;
        assertNull(e.command(7000).power());
        assertEquals(0, e.command(7000).grade(), 0);
    }
    @Test public void ftmsEncodingMatchesTheWebClient() {
        assertArrayEquals(new byte[] {17, 0, 0, (byte) 144, 1, 40, 51}, new RideEngine.Command(null, 4, .004, .51).bytes());
    }
    @Test public void theNotificationClockCountsSecondsAndFreezesWhilePaused() {
        RideEngine e = new RideEngine(sample -> {});
        e.tick(0, 0); e.tick(65000, 65000);
        assertEquals(65, e.durationS, 0);
        e.paused = true; e.tick(70000, 70000);
        assertEquals(65, e.durationS, 0);
    }
    @Test public void quarterSecondTicksAdvanceTheClockAndResistanceRamp() {
        RideEngine e = new RideEngine(sample -> {});
        e.packet("trainer", "2ad2", "44001c0cb000d700", 0);
        e.background = true; e.resistance(0); e.tick(0, 0); e.resistance(10);
        e.tick(250, 250); e.tick(500, 500); e.tick(750, 750); e.tick(1000, 1000);
        assertEquals(1, e.durationS, 0.00001);
        assertEquals(1, e.control.elapsed, 0.00001);
        assertEquals(1.5, e.command(1000).grade(), 0.00001);
    }

    private RideEngine draftingEngine() {
        RideEngine e = new RideEngine(sample -> {});
        e.packet("trainer", "2ad2", "44001c0cb000d700", 0);
        e.state("r", 100, 12, 0); e.resistance(0);
        e.control.ratio = 1; e.control.referenceRatio = 1;
        e.routeLengths.put("r", 1000.0);
        return e;
    }
    @Test public void draftingMatchesTheSharedWebClientFixtures() throws Exception {
        org.json.JSONObject fixture;
        try (var input = getClass().getResourceAsStream("/native-drafting.json")) {
            assertNotNull("Shared client/native drafting fixture", input);
            fixture = new org.json.JSONObject(new String(input.readAllBytes(), java.nio.charset.StandardCharsets.UTF_8));
        }
        var physics = fixture.getJSONObject("physics");
        var cases = fixture.getJSONArray("cases");
        for (int i = 0; i < cases.length(); i++) {
            var row = cases.getJSONObject(i); var me = row.getJSONObject("me");
            RideEngine e = draftingEngine();
            e.control.mass = physics.getDouble("massKg"); e.control.cda = physics.getDouble("cda");
            e.control.crr = physics.getDouble("crr"); e.control.airDensity = physics.getDouble("airDensity");
            e.control.ratio = physics.getDouble("ratio"); e.control.referenceRatio = physics.getDouble("referenceRatio");
            e.routeLoops.put("r", row.getBoolean("loop"));
            e.state("r", me.getDouble("distance"), physics.getDouble("speed"), 0);
            java.util.List<RideEngine.Rider> riders = new java.util.ArrayList<>();
            var positions = new org.json.JSONArray(row.getJSONArray("others").toString()).put(me);
            for (int j = 0; j < positions.length(); j++) {
                var rider = positions.getJSONObject(j);
                riders.add(new RideEngine.Rider(rider.getLong("id"), rider.getString("route"), rider.getDouble("distance"), rider.getDouble("lane")));
            }
            e.draft(me.getLong("id"), riders, 0);
            assertEquals(row.getString("name"), row.getDouble("grade"), e.command(1000).grade(), 0);
        }
    }
    @Test public void leavingTheGroupClearsThePreviousDraftSaving() {
        RideEngine e = draftingEngine();
        e.draft(1, java.util.List.of(new RideEngine.Rider(1, "r", 100, 2), new RideEngine.Rider(2, "r", 102, 2)), 0);
        e.draft(1, java.util.List.of(new RideEngine.Rider(1, "r", 100, 2)), 1000);
        assertEquals(3.4, e.command(1000).grade(), 0);
    }
}
