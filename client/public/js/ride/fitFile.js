/**
 * FIT activity files (Garmin's binary format), written for Strava: a FIT
 * session can say it was a virtual ride (`sub_sport` virtual_activity),
 * which TCX and GPX can't, and Strava keeps such a ride's own elevation
 * instead of looking it up on its map (where our world is open sea).
 *
 * Only what an activity needs: file_id, timer events, one record per
 * sample, one lap, one session and the activity. Little-endian throughout.
 */

/** FIT time counts seconds from 1989-12-31 00:00 UTC. */
const FIT_EPOCH_S = 631065600;

const TYPES = Object.freeze({
  enum: { id: 0x00, size: 1, invalid: 0xff },
  uint8: { id: 0x02, size: 1, invalid: 0xff },
  uint16: { id: 0x84, size: 2, invalid: 0xffff },
  sint32: { id: 0x85, size: 4, invalid: 0x7fffffff },
  uint32: { id: 0x86, size: 4, invalid: 0xffffffff },
  uint32z: { id: 0x8c, size: 4, invalid: 0 },
});

const SPORT_CYCLING = 2;
const SUB_SPORT_VIRTUAL = 58;
/** A spin class: indoors, no map. */
const SUB_SPORT_INDOOR = 6;
/** Manufacturer "development": no registered maker id needed. */
const MANUFACTURER_DEVELOPMENT = 255;

/**
 * The messages used, by global number, with their fields as
 * `[field number, name, type]`.
 */
const MESSAGES = Object.freeze({
  fileId: [0, [[0, "type", "enum"], [1, "manufacturer", "uint16"], [2, "product", "uint16"], [3, "serial", "uint32z"], [4, "created", "uint32"]]],
  event: [21, [[253, "timestamp", "uint32"], [0, "event", "enum"], [1, "eventType", "enum"]]],
  record: [
    20,
    [
      [253, "timestamp", "uint32"],
      [0, "lat", "sint32"],
      [1, "lon", "sint32"],
      [2, "altitude", "uint16"],
      [3, "heartRate", "uint8"],
      [4, "cadence", "uint8"],
      [5, "distance", "uint32"],
      [6, "speed", "uint16"],
      [7, "power", "uint16"],
    ],
  ],
  lap: [
    19,
    [
      [253, "timestamp", "uint32"],
      [0, "event", "enum"],
      [1, "eventType", "enum"],
      [2, "startTime", "uint32"],
      [7, "elapsed", "uint32"],
      [8, "timer", "uint32"],
      [9, "distance", "uint32"],
      [13, "avgSpeed", "uint16"],
      [15, "avgHeartRate", "uint8"],
      [20, "maxPower", "uint16"],
      [21, "ascent", "uint16"],
      [19, "avgPower", "uint16"],
      [24, "trigger", "enum"],
      [25, "sport", "enum"],
      [39, "subSport", "enum"],
    ],
  ],
  session: [
    18,
    [
      [253, "timestamp", "uint32"],
      [0, "event", "enum"],
      [1, "eventType", "enum"],
      [2, "startTime", "uint32"],
      [5, "sport", "enum"],
      [6, "subSport", "enum"],
      [7, "elapsed", "uint32"],
      [8, "timer", "uint32"],
      [9, "distance", "uint32"],
      [20, "avgPower", "uint16"],
      [21, "maxPower", "uint16"],
      [22, "ascent", "uint16"],
      [25, "firstLap", "uint16"],
      [26, "laps", "uint16"],
    ],
  ],
  activity: [
    34,
    [
      [253, "timestamp", "uint32"],
      [0, "timer", "uint32"],
      [1, "sessions", "uint16"],
      [2, "type", "enum"],
      [3, "event", "enum"],
      [4, "eventType", "enum"],
      [5, "localTimestamp", "uint32"],
    ],
  ],
});

const CRC_TABLE = [0x0000, 0xcc01, 0xd801, 0x1400, 0xf001, 0x3c00, 0x2800, 0xe401, 0xa001, 0x6c00, 0x7800, 0xb401, 0x5000, 0x9c01, 0x8801, 0x4400];

/** FIT's CRC-16 over `bytes`. */
export function fitCrc(bytes, crc = 0) {
  for (const byte of bytes) {
    let tmp = CRC_TABLE[crc & 0xf];
    crc = (crc >> 4) & 0x0fff;
    crc = crc ^ tmp ^ CRC_TABLE[byte & 0xf];
    tmp = CRC_TABLE[crc & 0xf];
    crc = (crc >> 4) & 0x0fff;
    crc = crc ^ tmp ^ CRC_TABLE[(byte >> 4) & 0xf];
  }
  return crc;
}

class Writer {
  bytes = [];
  u8(v) {
    this.bytes.push(v & 0xff);
  }
  value(type, v) {
    const { size, invalid } = TYPES[type];
    let n = Number.isFinite(v) ? Math.round(v) : invalid;
    if (type === "sint32" && n < 0) n += 2 ** 32;
    for (let i = 0; i < size; i += 1) this.u8(Math.floor(n / 256 ** i));
  }
}

const fitTime = (ms) => Math.round(ms / 1000) - FIT_EPOCH_S;
const semicircles = (degrees) => Math.round(degrees * (2 ** 31 / 180));
/** A value in range, else FIT's "invalid" for that field. */
const within = (v, lo, hi) => (Number.isFinite(v) && v >= lo && v <= hi ? v : NaN);

/**
 * Encodes recorded samples (see RideRecorder) as a FIT activity: a virtual
 * ride with positions, altitude, distance, speed, power, cadence and heart
 * rate.
 * @param {{t: number, distance: number, power: number, cadence: ?number, heartRate: ?number, speed: number, elevation: ?number, lat: ?number, lon: ?number}[]} samples
 * @param {{elevationGainM?: number, avgPower?: number, maxPower?: number}} [summary]
 * @param {{indoor?: boolean, pauses?: {from: number, to: number}[]}} [options] `indoor`: a spin class (indoor cycling) instead of a virtual ride;
 *        `pauses` (epoch ms): the timer stops for each and leaves it out of the timer time;
 *        `splits` (see ride/splits.js): one lap each, a single lap over the whole ride without
 * @returns {Uint8Array}
 */
export function encodeFitActivity(samples, summary = {}, { indoor = false, pauses = [], splits = [] } = {}) {
  if (samples.length === 0) throw new Error("nothing recorded yet");
  const out = new Writer();
  const defined = new Set();
  const write = (kind, values) => {
    const [global, fields] = MESSAGES[kind];
    const local = Object.keys(MESSAGES).indexOf(kind);
    if (!defined.has(kind)) {
      defined.add(kind);
      out.u8(0x40 | local);
      out.u8(0); // reserved
      out.u8(0); // little-endian
      out.value("uint16", global);
      out.u8(fields.length);
      for (const [number, , type] of fields) {
        out.u8(number);
        out.u8(TYPES[type].size);
        out.u8(TYPES[type].id);
      }
    }
    out.u8(local);
    for (const [, name, type] of fields) out.value(type, values[name]);
  };

  const first = samples[0];
  const last = samples[samples.length - 1];
  const start = fitTime(first.t);
  const end = fitTime(last.t);
  const elapsedMs = Math.max(0, last.t - first.t);
  const distanceM = Math.max(0, last.distance - first.distance);

  write("fileId", { type: 4, manufacturer: MANUFACTURER_DEVELOPMENT, product: 1, serial: (first.t / 1000) % 2 ** 32 || 1, created: start });
  write("event", { timestamp: start, event: 0, eventType: 0 }); // timer start
  const inside = pauses.filter((pause) => pause.from >= first.t && pause.to <= last.t);
  const pausedMs = inside.reduce((sum, pause) => sum + (pause.to - pause.from), 0);
  let nextPause = 0;
  for (const s of samples) {
    // Timer stop when a pause began, start again when it ended.
    while (nextPause < inside.length && inside[nextPause].to <= s.t) {
      write("event", { timestamp: fitTime(inside[nextPause].from), event: 0, eventType: 1 });
      write("event", { timestamp: fitTime(inside[nextPause].to), event: 0, eventType: 0 });
      nextPause += 1;
    }
    const hasPosition = Number.isFinite(s.lat) && Number.isFinite(s.lon);
    write("record", {
      timestamp: fitTime(s.t),
      lat: hasPosition ? semicircles(s.lat) : NaN,
      lon: hasPosition ? semicircles(s.lon) : NaN,
      // Altitude: (metres + 500) × 5.
      altitude: within(Number.isFinite(s.elevation) ? (s.elevation + 500) * 5 : NaN, 0, 0xfffe),
      heartRate: within(s.heartRate, 1, 254),
      cadence: within(s.cadence, 0, 254),
      distance: within((s.distance - first.distance) * 100, 0, 0xfffffffe),
      speed: within(s.speed * 1000, 0, 0xfffe),
      power: within(s.power, 0, 0xfffe),
    });
  }
  write("event", { timestamp: end, event: 0, eventType: 4 }); // timer stop all
  const totals = {
    timestamp: end,
    startTime: start,
    elapsed: elapsedMs,
    timer: elapsedMs - pausedMs,
    distance: distanceM * 100,
    ascent: within(summary.elevationGainM, 0, 0xfffe),
    avgPower: within(summary.avgPower, 0, 0xfffe),
    sport: SPORT_CYCLING,
    subSport: indoor ? SUB_SPORT_INDOOR : SUB_SPORT_VIRTUAL,
  };
  const sessionEnd = 7;
  const laps = splits.length ? splits : [null];
  laps.forEach((split, i) => {
    const own = split
      ? {
          timestamp: fitTime(split.endT),
          startTime: fitTime(split.startT),
          elapsed: split.endT - split.startT,
          timer: split.durationS * 1000,
          distance: split.distanceM * 100,
          ascent: within(split.elevationGainM, 0, 0xfffe),
          avgPower: within(Math.round(split.avgPower), 0, 0xfffe),
          avgSpeed: within(split.avgSpeed * 1000, 0, 0xfffe),
          avgHeartRate: within(split.avgHeartRate, 1, 254),
          maxPower: within(split.maxPower, 0, 0xfffe),
          trigger: i === laps.length - 1 ? sessionEnd : split.kind === "distance" ? 2 : 4,
        }
      : {
          avgSpeed: within(summary.avgSpeed * 1000, 0, 0xfffe),
          avgHeartRate: within(summary.avgHeartRate, 1, 254),
          maxPower: within(summary.maxPower, 0, 0xfffe),
          trigger: sessionEnd,
        };
    write("lap", { ...totals, ...own, event: 9, eventType: 1 });
  });
  write("session", { ...totals, event: 8, eventType: 1, maxPower: within(summary.maxPower, 0, 0xfffe), firstLap: 0, laps: laps.length });
  const offset = -new Date(first.t).getTimezoneOffset() * 60;
  write("activity", { timestamp: end, timer: elapsedMs - pausedMs, sessions: 1, type: 0, event: 26, eventType: 1, localTimestamp: end + offset });

  const data = Uint8Array.from(out.bytes);
  const header = new Uint8Array(14);
  const view = new DataView(header.buffer);
  view.setUint8(0, 14);
  view.setUint8(1, 0x20); // protocol 2.0
  view.setUint16(2, 2132, true); // profile 21.32
  view.setUint32(4, data.length, true);
  header.set([0x2e, 0x46, 0x49, 0x54], 8); // ".FIT"
  view.setUint16(12, fitCrc(header.subarray(0, 12)), true);
  const file = new Uint8Array(14 + data.length + 2);
  file.set(header, 0);
  file.set(data, 14);
  const crc = fitCrc(file.subarray(0, 14 + data.length));
  file[file.length - 2] = crc & 0xff;
  file[file.length - 1] = crc >> 8;
  return file;
}
