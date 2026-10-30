/**
 * Records a ride once per second and turns it into a summary, a TCX file
 * (Garmin Training Center XML), a GPX file and a FIT file, which Strava,
 * intervals.icu, TrainingPeaks and Garmin Connect all import with power,
 * cadence and heart rate. Positions (see route/geo.js) give the ride a map
 * track. Strava gets the FIT file: only FIT can say it was a virtual ride.
 */
import { encodeFitActivity } from "./fitFile.js";

const xmlEscape = (text) =>
  String(text).replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]);

const finite = (value) => Number.isFinite(value);

const iso = (t) => new Date(t).toISOString().replace(/\.\d{3}Z$/, "Z");

const hasPosition = (p) => p.lat !== null && p.lon !== null;

export class RideRecorder {
  /** @type {{t: number, distance: number, power: number, cadence: ?number, heartRate: ?number, speed: number, elevation: ?number, lat: ?number, lon: ?number, route: ?string, routeM: ?number}[]} */
  samples = [];
  /** Gaps the ride was not going on (a crash until "Continue", #73), epoch ms. @type {{from: number, to: ?number}[]} */
  pauses = [];

  /** @param {{intervalMs?: number}} [options] */
  constructor({ intervalMs = 1000 } = {}) {
    this.intervalMs = intervalMs;
  }

  /** A recorder from `toJSON()` output (an autosaved ride). */
  static from({ samples = [], pauses = [], intervalMs = 1000 } = {}) {
    const recorder = new RideRecorder({ intervalMs });
    recorder.samples = samples.map((sample) => ({ ...sample }));
    recorder.pauses = pauses.map((pause) => ({ ...pause }));
    return recorder;
  }

  toJSON() {
    return { samples: this.samples, pauses: this.pauses, intervalMs: this.intervalMs };
  }

  /** Starts a pause at `t` (no-op while one is open). */
  pause(t) {
    if (this.pauses.at(-1)?.to === null) return;
    this.pauses.push({ from: t, to: null });
  }

  /** Ends the open pause at `t` (no-op without one). */
  resume(t) {
    const open = this.pauses.at(-1);
    if (open?.to === null) open.to = t;
  }

  /** Closed pauses only: an open one hasn't ended yet. */
  get #closedPauses() {
    return this.pauses.filter((pause) => pause.to !== null);
  }

  /** Whether the interval between two samples spans a pause. */
  #spansPause(a, b) {
    return this.#closedPauses.some((pause) => a.t <= pause.from && b.t >= pause.to);
  }

  /** The samples split at each pause; empty pieces are dropped. */
  segments(samples = this.samples) {
    const segments = [];
    let current = [];
    for (const sample of samples) {
      if (current.length && this.#spansPause(current.at(-1), sample)) {
        segments.push(current);
        current = [];
      }
      current.push(sample);
    }
    if (current.length) segments.push(current);
    return segments;
  }

  /** Milliseconds of closed pauses within the recorded samples. */
  #pausedMs() {
    let paused = 0;
    for (let i = 1; i < this.samples.length; i += 1) {
      if (this.#spansPause(this.samples[i - 1], this.samples[i])) paused += this.samples[i].t - this.samples[i - 1].t;
    }
    return paused;
  }

  /**
   * Adds a sample if at least one interval passed since the last one.
   * @param {{t: number, distance: number, power?: number, cadence?: number, heartRate?: number, speed?: number, elevation?: number, lat?: number, lon?: number, route?: ?string, routeM?: ?number}} sample
   *        t = epoch milliseconds, distance = metres ridden so far, speed in m/s, lat/lon in degrees;
   *        route = id of the route the rider is on and routeM = metres along it (both null off route, see ride/splits.js)
   * @returns {boolean} whether the sample was kept
   */
  add(sample) {
    const last = this.samples[this.samples.length - 1];
    if (last && sample.t - last.t < this.intervalMs) return false;
    const positioned = finite(sample.lat) && finite(sample.lon);
    this.samples.push({
      t: sample.t,
      distance: Math.max(0, sample.distance ?? 0),
      power: finite(sample.power) ? Math.max(0, sample.power) : 0,
      cadence: finite(sample.cadence) ? sample.cadence : null,
      heartRate: finite(sample.heartRate) && sample.heartRate > 0 ? sample.heartRate : null,
      speed: finite(sample.speed) ? Math.max(0, sample.speed) : 0,
      elevation: finite(sample.elevation) ? sample.elevation : null,
      lat: positioned ? sample.lat : null,
      lon: positioned ? sample.lon : null,
      route: typeof sample.route === "string" && finite(sample.routeM) ? sample.route : null,
      routeM: typeof sample.route === "string" && finite(sample.routeM) ? sample.routeM : null,
    });
    return true;
  }

  get empty() {
    return this.samples.length < 2;
  }

  /** Totals for the end-of-ride screen. */
  summary() {
    const s = this.samples;
    if (s.length === 0) return { durationS: 0, distanceM: 0, avgPower: 0, maxPower: 0, avgHeartRate: null, avgSpeed: 0, elevationGainM: 0, kilojoules: 0 };
    // A pause is neither riding time nor work.
    const durationS = (s[s.length - 1].t - s[0].t - this.#pausedMs()) / 1000;
    const distanceM = s[s.length - 1].distance - s[0].distance;
    let joules = 0;
    let gain = 0;
    for (let i = 1; i < s.length; i += 1) {
      if (!this.#spansPause(s[i - 1], s[i])) joules += s[i].power * ((s[i].t - s[i - 1].t) / 1000);
      if (s[i].elevation !== null && s[i - 1].elevation !== null) gain += Math.max(0, s[i].elevation - s[i - 1].elevation);
    }
    const heartRates = s.map((x) => x.heartRate).filter((x) => x !== null);
    return {
      durationS,
      distanceM,
      avgPower: durationS > 0 ? Math.round(joules / durationS) : 0,
      maxPower: Math.round(Math.max(...s.map((x) => x.power))),
      avgHeartRate: heartRates.length ? Math.round(heartRates.reduce((a, b) => a + b, 0) / heartRates.length) : null,
      avgSpeed: durationS > 0 ? distanceM / durationS : 0,
      elevationGainM: Math.round(gain),
      kilojoules: Math.round(joules / 1000),
    };
  }

  /**
   * The ride as a FIT activity: a virtual ride with its own elevation (see
   * fitFile.js); `indoor` for a spin class.
   */
  toFit({ indoor = false, splits = [] } = {}) {
    return encodeFitActivity(this.samples, this.summary(), { indoor, pauses: this.#closedPauses, splits });
  }

  /**
   * The ride as TCX, with positions where the sample has one.
   * @param {{name?: string, splits?: object[]}} [options] `splits` (see ride/splits.js): one `<Lap>` each, one lap over the whole ride without
   */
  toTcx({ name = "OpenRadlr", splits = [] } = {}) {
    if (this.samples.length === 0) throw new Error("nothing recorded yet");
    const start = iso(this.samples[0].t);
    const summary = this.summary();
    const trackpoints = (samples) =>
      samples
        .map((p) => {
          const parts = [`<Trackpoint><Time>${iso(p.t)}</Time>`];
          if (hasPosition(p)) parts.push(`<Position><LatitudeDegrees>${p.lat.toFixed(7)}</LatitudeDegrees><LongitudeDegrees>${p.lon.toFixed(7)}</LongitudeDegrees></Position>`);
          if (p.elevation !== null) parts.push(`<AltitudeMeters>${p.elevation.toFixed(1)}</AltitudeMeters>`);
          parts.push(`<DistanceMeters>${p.distance.toFixed(1)}</DistanceMeters>`);
          if (p.heartRate !== null) parts.push(`<HeartRateBpm><Value>${Math.round(p.heartRate)}</Value></HeartRateBpm>`);
          if (p.cadence !== null) parts.push(`<Cadence>${Math.round(Math.min(254, p.cadence))}</Cadence>`);
          parts.push(`<Extensions><ns3:TPX><ns3:Speed>${p.speed.toFixed(2)}</ns3:Speed><ns3:Watts>${Math.round(p.power)}</ns3:Watts></ns3:TPX></Extensions></Trackpoint>`);
          return parts.join("");
        })
        .join("\n");
    // One track per stretch between pauses.
    const tracksOf = (samples) =>
      this.segments(samples)
        .map((segment) => `<Track>\n${trackpoints(segment)}\n</Track>`)
        .join("\n");
    const lapXml = (startTime, seconds, metres, kilojoules, trigger, samples) =>
      `<Lap StartTime="${startTime}"><TotalTimeSeconds>${seconds.toFixed(0)}</TotalTimeSeconds><DistanceMeters>${metres.toFixed(1)}</DistanceMeters><Calories>${kilojoules}</Calories><Intensity>Active</Intensity><TriggerMethod>${trigger}</TriggerMethod>\n${tracksOf(samples)}</Lap>`;
    // A split ends on the sample the next one starts with; each trackpoint is written once.
    const laps = splits.length
      ? splits.map((split, i) => {
          const end = i === splits.length - 1 ? split.endIndex + 1 : split.endIndex;
          return lapXml(iso(split.startT), split.durationS, split.distanceM, Math.round((split.avgPower * split.durationS) / 1000), split.kind === "distance" ? "Distance" : "Location", this.samples.slice(split.startIndex, end)); // i18n-ok
        })
      : [lapXml(start, summary.durationS, summary.distanceM, summary.kilojoules, "Manual", this.samples)]; // i18n-ok
    return `<?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2" xmlns:ns3="http://www.garmin.com/xmlschemas/ActivityExtension/v2">
<Activities><Activity Sport="Biking"><Id>${start}</Id>
${laps.join("\n")}
<Notes>${xmlEscape(name)}</Notes>
<Creator xsi:type="Device_t" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><Name>OpenRadlr</Name></Creator>
</Activity></Activities>
</TrainingCenterDatabase>
`;
  }

  /**
   * The ride as GPX 1.1. Power uses the `<power>` extension Strava reads,
   * heart rate and cadence Garmin's TrackPointExtension. Samples without a
   * position are left out.
   * @param {{name?: string}} [options]
   */
  toGpx({ name = "OpenRadlr" } = {}) {
    if (this.samples.length === 0) throw new Error("nothing recorded yet");
    const located = this.segments()
      .map((segment) => segment.filter(hasPosition))
      .filter((segment) => segment.length > 0);
    if (located.length === 0) throw new Error("the ride has no positions");
    const title = xmlEscape(name);
    const trackpoints = (samples) =>
      samples
        .map((p) => {
          const parts = [`<trkpt lat="${p.lat.toFixed(7)}" lon="${p.lon.toFixed(7)}">`];
          if (p.elevation !== null) parts.push(`<ele>${p.elevation.toFixed(1)}</ele>`);
          parts.push(`<time>${iso(p.t)}</time><extensions><power>${Math.round(p.power)}</power>`);
          const tpx = [];
          if (p.heartRate !== null) tpx.push(`<gpxtpx:hr>${Math.round(p.heartRate)}</gpxtpx:hr>`);
          if (p.cadence !== null) tpx.push(`<gpxtpx:cad>${Math.round(Math.min(254, p.cadence))}</gpxtpx:cad>`);
          if (tpx.length) parts.push(`<gpxtpx:TrackPointExtension>${tpx.join("")}</gpxtpx:TrackPointExtension>`);
          parts.push("</extensions></trkpt>");
          return parts.join("");
        })
        .join("\n");
    // One track segment per stretch between pauses.
    const trackSegments = located.map((segment) => `<trkseg>\n${trackpoints(segment)}\n</trkseg>`).join("\n");
    return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="OpenRadlr" xmlns="http://www.topografix.com/GPX/1/1" xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1">
<metadata><name>${title}</name><time>${iso(this.samples[0].t)}</time></metadata>
<trk><name>${title}</name><type>VirtualRide</type>${trackSegments}</trk>
</gpx>
`;
  }
}

/** "openradlr-2026-10-14-1530-rolling-hills.tcx" */
export function rideFileName(startT, routeId = "ride", extension = "tcx") {
  const d = new Date(startT);
  const pad = (n) => String(n).padStart(2, "0");
  const safe = String(routeId).replace(/[^a-z0-9-]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "ride";
  return `openradlr-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}-${safe}.${extension}`;
}
