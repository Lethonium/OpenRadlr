/**
 * Client side of the wire protocol (see docs/protocol.md).
 * Builders return plain objects; the connection serialises them.
 */

/** 2: one world per map (#14), riders carry their route; state is culled to the riders around you. */
export const PROTOCOL_VERSION = 2;
export const CLIENT_VERSION = "web-0.1.0";

export const ClientMessages = Object.freeze({
  hello: () => ({ type: "hello", protocol_version: PROTOCOL_VERSION, client_version: CLIENT_VERSION }),
  join: ({ name, weightKg, publicKey, routeId, ftp, level, device, vehicleCode, resumeToken, resume }) => ({
    type: "join",
    name,
    weight_kg: weightKg,
    ...(publicKey ? { public_key: publicKey } : {}),
    ...(routeId ? { route_id: routeId } : {}),
    // The spin studio sets targets from it; route worlds ignore it.
    ...(Number.isFinite(ftp) && ftp > 0 ? { ftp_w: ftp } : {}),
    // How hard the rider really rides; the server sizes bots and groups from it.
    ...(Number.isFinite(level) && level > 0 ? { level_w: level } : {}),
    // "sim" or "paddle"; a real trainer is the default and is left out.
    ...(device && device !== "trainer" ? { device } : {}),
    // Board a shared vehicle on joining; the server picks the world from the code.
    ...(vehicleCode ? { vehicle_code: vehicleCode } : {}),
    // Back after a dropped connection: the same rider if the server still holds them (#73).
    ...(resumeToken ? { resume_token: resumeToken } : {}),
    // Otherwise start where the ride left off.
    ...(resume ? { resume: { route_id: resume.routeId, distance_m: resume.distanceM } } : {}),
  }),
  telemetry: ({ power, cadence }) => ({
    type: "telemetry",
    power: Number.isFinite(power) ? power : 0,
    ...(Number.isFinite(cadence) ? { cadence } : {}),
  }),
  laneLeft: () => ({ type: "input", action: "lane_left" }),
  laneRight: () => ({ type: "input", action: "lane_right" }),
  startRace: (laps) => ({ type: "start_race", laps }),
  joinRace: () => ({ type: "join_race" }),
  leaveRace: () => ({ type: "leave_race" }),
  joinEvent: (id) => ({ type: "join_event", event_id: id }),
  leaveEvent: () => ({ type: "leave_event" }),
  /** The road to take at the next junction (#15); null for the default. */
  turn: (edge) => ({ type: "turn", edge: edge ?? null }),
  createVehicle: ({ kind, seats, bots }) => ({ type: "create_vehicle", kind, seats, bots }),
  boardVehicle: (code) => ({ type: "board_vehicle", code }),
  leaveVehicle: () => ({ type: "leave_vehicle" }),
  /** The café workout's current exercise (#77); null between exercises. */
  workout: (exercise) => ({ type: "workout", exercise: exercise ?? null }),
  /** Pulling over for a pause (#89), and riding on after it. */
  pause: () => ({ type: "pause" }),
  resume: () => ({ type: "resume" }),
  chat: (text) => ({ type: "chat", text }),
  /** Leaving on purpose: the server removes the rider at once. */
  leave: () => ({ type: "leave" }),
});

const SERVER_TYPES = new Set(["welcome", "joined", "state", "studio_state", "resistance", "event", "chat", "error"]);

/**
 * Parses a server frame. Returns null for anything that is not a known message.
 * @param {string} text
 */
export function parseServerMessage(text) {
  let message;
  try {
    message = JSON.parse(text);
  } catch {
    return null;
  }
  if (!message || typeof message !== "object" || !SERVER_TYPES.has(message.type)) return null;
  return message;
}

/** WebSocket URL of the server that served this page. */
export function defaultServerUrl(location = globalThis.location) {
  const scheme = location.protocol === "https:" ? "wss:" : "ws:";
  return `${scheme}//${location.host}/ws`;
}
