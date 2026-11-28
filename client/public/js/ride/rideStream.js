/**
 * A ride stream: every second of a finished ride, kept compactly so its files,
 * curves and charts can be made again later (docs/superpowers/specs/2026-11-25-ride-streams-design.md).
 *
 * The recorder's samples become one column per field, as integers at a fixed
 * precision; fields that change little from second to second store the
 * difference to the one before. Time, power, heart rate and cadence come back as
 * the files write them; distance, elevation, road position and position to the
 * centimetre, speed to the mm/s. Gzipped, an hour is about 45 KB.
 *
 * `decodeColumns` returns what `RideRecorder.from` takes, so the recorder's own
 * `toFit`, `toTcx`, `toGpx` and `summary`, and powerAnalysis.js, work on it.
 */

export const STREAM_VERSION = 1;

/** Field, integer steps per unit, stored as a difference to the sample before. */
const FIELDS = [
  ["t", 1, true],
  ["distance", 100, true],
  ["power", 10, false],
  ["cadence", 1, false],
  ["heartRate", 1, false],
  ["speed", 1000, true],
  ["elevation", 100, true],
  ["lat", 1e7, true],
  ["lon", 1e7, true],
  ["routeM", 100, true],
];

const malformed = (why) => new Error(`malformed ride stream: ${why}`); // i18n-ok (an error for logs)

/** Integers for one field; after a missing value the next is whole again, not a difference. */
function column(samples, field, scale, delta) {
  let before = null;
  return samples.map((sample) => {
    const value = sample[field];
    if (value === null || value === undefined || !Number.isFinite(value)) {
      before = null;
      return null;
    }
    const whole = Math.round(value * scale);
    const stored = delta && before !== null ? whole - before : whole;
    before = whole;
    return stored;
  });
}

/** Where the road changes: [sample index, route id or null]. */
function roadChanges(samples) {
  const changes = [];
  samples.forEach((sample, i) => {
    if (i === 0 || sample.route !== samples[i - 1].route) changes.push([i, sample.route]);
  });
  return changes;
}

/**
 * The stream document of a recording (a `RideRecorder` or its `toJSON()`).
 * @param {{samples: object[], pauses?: {from: number, to: ?number}[], intervalMs?: number}} recording
 * @param {string} rideId the ride record's id
 */
export function encodeColumns(recording, rideId) {
  const { samples, pauses = [], intervalMs = 1000 } = recording;
  return {
    version: STREAM_VERSION,
    rideId,
    intervalMs,
    pauses: pauses.map(({ from, to }) => ({ from, to })),
    routes: roadChanges(samples),
    columns: Object.fromEntries(FIELDS.map(([field, scale, delta]) => [field, column(samples, field, scale, delta)])),
  };
}

/** The recording a stream document holds, in the form `RideRecorder.from` takes. */
export function decodeColumns(doc) {
  if (doc?.version !== STREAM_VERSION) throw new Error(`unknown ride stream version: ${doc?.version}`); // i18n-ok
  const columns = doc.columns ?? {};
  const length = columns.t?.length ?? 0;
  for (const [field] of FIELDS) {
    if (!Array.isArray(columns[field]) || columns[field].length !== length) throw malformed(`column ${field}`);
  }
  const values = Object.fromEntries(
    FIELDS.map(([field, scale, delta]) => {
      let before = null;
      return [
        field,
        columns[field].map((stored) => {
          if (stored === null) {
            before = null;
            return null;
          }
          const whole = delta && before !== null ? before + stored : stored;
          before = whole;
          return whole / scale;
        }),
      ];
    }),
  );
  const routeAt = [];
  const changes = Array.isArray(doc.routes) ? doc.routes : [];
  changes.forEach(([from, route], k) => {
    const to = k + 1 < changes.length ? changes[k + 1][0] : length;
    for (let i = from; i < to; i += 1) routeAt[i] = route;
  });
  const samples = Array.from({ length }, (_, i) => ({
    t: values.t[i],
    distance: values.distance[i] ?? 0,
    power: values.power[i] ?? 0,
    cadence: values.cadence[i],
    heartRate: values.heartRate[i],
    speed: values.speed[i] ?? 0,
    elevation: values.elevation[i],
    lat: values.lat[i],
    lon: values.lon[i],
    route: routeAt[i] ?? null,
    routeM: values.routeM[i],
  }));
  return { samples, pauses: (doc.pauses ?? []).map(({ from, to }) => ({ from, to })), intervalMs: doc.intervalMs ?? 1000 };
}

async function pipe(bytes, transform) {
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(transform)).arrayBuffer());
}

/**
 * The stream of a recording, gzipped. The compression is injected for tests.
 * @returns {Promise<Uint8Array>}
 */
export async function encodeStream(recording, rideId, { CompressionStream = globalThis.CompressionStream } = {}) {
  const json = new TextEncoder().encode(JSON.stringify(encodeColumns(recording, rideId)));
  return pipe(json, new CompressionStream("gzip"));
}

/**
 * The ride id and recording a gzipped stream holds.
 * @param {Uint8Array} bytes
 * @returns {Promise<{rideId: string, recording: {samples: object[], pauses: object[], intervalMs: number}}>}
 */
export async function decodeStream(bytes, { DecompressionStream = globalThis.DecompressionStream } = {}) {
  const doc = JSON.parse(new TextDecoder().decode(await pipe(bytes, new DecompressionStream("gzip"))));
  return { rideId: doc.rideId, recording: decodeColumns(doc) };
}
