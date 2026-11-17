package com.openradlr.app.ride;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.HashMap;
import java.util.Map;
import java.util.List;
import java.util.function.Consumer;

/** Clock/sensor/control logic; no Android, WebView, networking or file I/O. */
public final class RideEngine {
    public record Rider(long id, String route, double distance, double lane) {}
    public record Sample(long t, double distance, double power, Double cadence, Double heartRate,
                         double speed, String route, Double routeM) {}
    public record Command(Double power, double grade, double crr, double cw) {
        public byte[] bytes() {
            ByteBuffer b = ByteBuffer.allocate(power == null ? 7 : 3).order(ByteOrder.LITTLE_ENDIAN);
            if (power != null) b.put((byte) 5).putShort((short) Math.round(clamp(power, 0, 4000)));
            else b.put((byte) 17).putShort((short) 0).putShort((short) Math.round(clamp(grade * 100, -32768, 32767)))
                .put((byte) Math.round(clamp(crr * 10000, 0, 255))).put((byte) Math.round(clamp(cw * 100, 0, 255)));
            return b.array();
        }
    }
    public static final class Control {
        public double difficulty = 1, crr = .004, ftp = 200, intensity = 1;
        public double ratio = 0, referenceRatio = 1, mass = 85, cda = .32, airDensity = 1.225;
        public Double target = null;
        public double[][] segments = new double[0][];
        public double elapsed = 0;
        public boolean classClock = false, erg = false;
    }
    private final Consumer<Sample> sink;
    private double ftmsPower, cpsPower;
    private Double cadence, embeddedHeartRate, strapHeartRate;
    private long ftmsAt = Long.MIN_VALUE / 2, cpsAt = Long.MIN_VALUE / 2;
    private long cadenceAt = Long.MIN_VALUE / 2, heartAt = Long.MIN_VALUE / 2, strapAt = Long.MIN_VALUE / 2;
    private int crankRevs = -1, crankTime;
    private long crankChangedAt;
    private long lastTick = -1, lastSample = Long.MIN_VALUE / 2, stateAt = Long.MIN_VALUE / 2;
    private double speed, routeM;
    private String route;
    private boolean hasState;
    private double dragFactor = 1;
    private long draftAt = Long.MIN_VALUE / 2;
    private double grade, easedGrade;
    private boolean hasGrade;
    public double distance, durationS;
    public boolean paused, background;
    public Control control = new Control();
    public final Map<String, Double> routeLengths = new HashMap<>();
    public final Map<String, Boolean> routeLoops = new HashMap<>();

    public RideEngine(Consumer<Sample> sink) { this.sink = sink; }

    /** Malformed/truncated radio packets cannot partially update a reading. */
    public synchronized void packet(String role, String characteristic, String hex, long now) {
        try {
            String clean = hex.replace(" ", "");
            if (clean.length() % 2 != 0) return;
            byte[] bytes = new byte[clean.length() / 2];
            for (int i = 0; i < bytes.length; i++) bytes[i] = (byte) Integer.parseInt(clean.substring(i * 2, i * 2 + 2), 16);
            ByteBuffer b = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN);
            if (characteristic.equals("2ad2") && role.equals("trainer")) {
                int flags = u16(b), p = 2;
                if ((flags & 1) == 0) p += 2;
                if ((flags & 2) != 0) p += 2;
                Double nextCadence = null, nextPower = null, nextHr = null;
                if ((flags & 4) != 0) { nextCadence = (double) Short.toUnsignedInt(b.getShort(p)) / 2; p += 2; }
                if ((flags & 8) != 0) p += 2;
                if ((flags & 16) != 0) p += 3;
                if ((flags & 32) != 0) p += 2;
                if ((flags & 64) != 0) { nextPower = (double) b.getShort(p); p += 2; }
                if ((flags & 128) != 0) p += 2;
                if ((flags & 256) != 0) p += 5;
                if ((flags & 512) != 0) nextHr = (double) Byte.toUnsignedInt(b.get(p));
                if (nextPower != null) { ftmsPower = clamp(nextPower, 0, 4000); ftmsAt = now; }
                if (nextCadence != null) { cadence = clamp(nextCadence, 0, 250); cadenceAt = now; }
                if (nextHr != null) { embeddedHeartRate = validHr(nextHr); heartAt = now; }
            } else if (characteristic.equals("2a63") && role.equals("trainer")) {
                int flags = u16(b);
                double power = b.getShort();
                int p = 4 + ((flags & 1) != 0 ? 1 : 0) + ((flags & 4) != 0 ? 2 : 0) + ((flags & 16) != 0 ? 6 : 0);
                if ((flags & 32) != 0) crank(Short.toUnsignedInt(b.getShort(p)), Short.toUnsignedInt(b.getShort(p + 2)), now);
                cpsPower = clamp(power, 0, 4000); cpsAt = now;
            } else if (characteristic.equals("2a37") && role.equals("hr")) {
                int flags = Byte.toUnsignedInt(b.get());
                strapHeartRate = validHr((flags & 1) == 0 ? Byte.toUnsignedInt(b.get()) : u16(b));
                strapAt = now;
            }
        } catch (IllegalArgumentException | IndexOutOfBoundsException | java.nio.BufferUnderflowException ignored) {
            // The next valid notification can still be used.
        }
    }

    private void crank(int revs, int time, long now) {
        if (crankRevs >= 0) {
            int dRevs = (revs - crankRevs + 65536) % 65536, dTime = (time - crankTime + 65536) % 65536;
            if (dRevs > 0 && dTime > 0) { cadence = clamp(dRevs * 60.0 * 1024 / dTime, 0, 250); crankChangedAt = now; }
            else if (now - crankChangedAt > 3000) cadence = 0.0;
            cadenceAt = now;
        } else crankChangedAt = now;
        crankRevs = revs; crankTime = time;
    }

    public synchronized boolean fresh(long now) { return now - Math.max(ftmsAt, cpsAt) <= 5000; }
    public synchronized double progress() {
        double total = 0; for (double[] s : control.segments) total += s[0];
        if (total > 0) return clamp(control.elapsed / total, 0, 1);
        double length = routeLengths.getOrDefault(route, 0.0);
        return length > 0 ? clamp(routeM / length, 0, 1) : -1;
    }
    public synchronized double power(long now) {
        if (now - ftmsAt <= 2000) return ftmsPower;
        return now - cpsAt <= 5000 ? cpsPower : now - ftmsAt <= 5000 ? ftmsPower : 0;
    }
    public synchronized Double cadence(long now) { return now - cadenceAt <= 5000 ? cadence : null; }
    public synchronized Double heartRate(long now) { return now - strapAt <= 5000 ? strapHeartRate : now - heartAt <= 5000 ? embeddedHeartRate : null; }
    public synchronized double[] telemetry(long now) { Double rpm = cadence(now); return new double[] {power(now), rpm == null ? Double.NaN : rpm}; }
    public synchronized void disconnected() { ftmsAt = cpsAt = cadenceAt = Long.MIN_VALUE / 2; }
    public synchronized void resistance(double grade) { if (!Double.isFinite(grade)) return; this.grade = grade; if (!hasGrade) easedGrade = grade; hasGrade = true; }

    /** Server positions wrap on a lap. Do not invent distance during an outage. */
    public synchronized void state(String nextRoute, double metres, double nextSpeed, long now) {
        if (!Double.isFinite(metres) || !Double.isFinite(nextSpeed)) return;
        if (hasState && !paused && now - stateAt <= 3000) {
            double delta = metres - routeM;
            boolean same = java.util.Objects.equals(route, nextRoute);
            if (same && delta < 0 && routeLengths.containsKey(route)) delta += routeLengths.get(route);
            double estimated = Math.max(0, nextSpeed) * Math.max(0, now - stateAt) / 1000;
            distance += same && delta >= 0 && delta <= estimated * 3 + 20 ? delta : estimated;
        }
        route = nextRoute; routeM = metres; speed = Math.max(0, nextSpeed); stateAt = now; hasState = true;
    }
    public synchronized void resetPosition() { hasState = false; }

    /** Same nearest-rider, lane, loop and rounded saving rules as ride/draft.js. */
    public synchronized void draft(long riderId, List<Rider> riders, long now) {
        dragFactor = 1; draftAt = now;
        Rider me = null;
        for (Rider rider : riders) if (rider.id == riderId) { me = rider; break; }
        if (me == null || me.route == null || !Double.isFinite(me.lane) || !Double.isFinite(me.distance)) return;
        double nearest = Double.POSITIVE_INFINITY;
        for (Rider other : riders) {
            if (other.id == me.id || !me.route.equals(other.route) || !Double.isFinite(other.lane)
                || !Double.isFinite(other.distance) || Math.abs(other.lane - me.lane) >= .5) continue;
            double gap = other.distance - me.distance;
            double length = routeLengths.getOrDefault(me.route, 0.0);
            if (routeLoops.getOrDefault(me.route, false) && length > 0) {
                gap = ((gap % length) + length) % length;
                if (gap > length / 2) gap -= length;
            }
            if (gap > 0 && gap < nearest) nearest = gap;
        }
        if (nearest <= 6.5) {
            double saving = Math.round(30 * (1 - (Math.max(nearest, 2) - 2) / 4.5));
            dragFactor = 1 - saving / 100;
        }
    }

    public synchronized void tick(long wall, long now) {
        double dt = lastTick < 0 ? 0 : Math.max(0, now - lastTick) / 1000.0;
        lastTick = now;
        if (!paused) durationS += dt;
        if (background && !paused) {
            Double rpm = cadence(now);
            if (control.classClock || (now - Math.max(ftmsAt, cpsAt) <= 5000 && (rpm == null || rpm >= 15))) control.elapsed += dt;
        }
        if (hasGrade) {
            double gap = grade - easedGrade, step = gap * (1 - Math.exp(-dt / 1.5));
            easedGrade += clamp(step, -1.5 * dt, 1.5 * dt);
            if (Math.abs(grade - easedGrade) < .05) easedGrade = grade;
        }
        if (!paused && now - lastSample >= 1000) {
            lastSample = now;
            sink.accept(new Sample(wall, distance, power(now), cadence(now), heartRate(now),
                now - stateAt <= 2000 ? speed : 0, route, hasState ? routeM : null));
        }
    }

    public synchronized Command command(long now) {
        Control c = control;
        if (paused || now - Math.max(ftmsAt, cpsAt) > 5000) return new Command(null, 0, c.crr, .51);
        Double target = c.target;
        if (c.segments.length > 0 && c.erg) {
            double elapsed = c.elapsed;
            target = c.ftp * .5;
            for (double[] segment : c.segments) {
                if (elapsed < 0) break;
                if (elapsed < segment[0]) { target = (segment[1] + (segment[2] - segment[1]) * elapsed / segment[0]) * c.ftp * c.intensity; break; }
                elapsed -= segment[0];
            }
        }
        if (c.erg && target != null) return new Command(clamp(target, 0, 4000), 0, c.crr, .51);
        double road = easedGrade >= 0 ? easedGrade * clamp(c.difficulty, 0, 1) : easedGrade * .5;
        if (c.ratio > 0 && c.referenceRatio > 0) {
            double theta = Math.atan(easedGrade / 100), weight = Math.max(1, c.mass) * 9.80665;
            double v = now - stateAt <= 2000 ? speed : 0;
            double draft = now - draftAt <= 2000 ? dragFactor : 1;
            double force = weight * (Math.sin(theta) + c.crr * Math.cos(theta)) + .5 * c.airDensity * c.cda * draft * v * v;
            double wanted = c.ratio / c.referenceRatio * Math.max(force, weight * .015);
            double sin = clamp(wanted / weight - c.crr, -.99, .99);
            road = clamp(Math.round(Math.tan(Math.asin(sin)) * 1000) / 10.0, -10, 20);
            return new Command(null, road, c.crr, 0);
        }
        return new Command(null, road, c.crr, .51);
    }
    private static int u16(ByteBuffer b) { return Short.toUnsignedInt(b.getShort()); }
    private static Double validHr(double value) { return value > 0 && value <= 255 ? value : null; }
    private static double clamp(double v, double lo, double hi) { return Math.min(hi, Math.max(lo, v)); }
}
