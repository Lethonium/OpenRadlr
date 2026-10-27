/**
 * Start menu: how the rider rides (smart trainer, phone paddles or the
 * simulator) and which Bluetooth add-ons go with it. Pure helpers only;
 * main.js connects the devices.
 */

const MODES = {
  trainer: { label: "Smart trainer", hint: "Bluetooth" },
  paddles: { label: "Phone paddles", hint: "No bike needed" },
  sim: { label: "Simulator", hint: "Just try it" },
};

/**
 * The ways to ride this server allows for the picked card. Paddles stay listed in
 * the studio, unavailable with the reason, so the choice doesn't vanish from under the rider.
 * @returns {{id: string, label: string, hint: string, available: boolean, reason: string}[]}
 */
export function rideModes({ info, picked }) {
  const ids = ["trainer"];
  if (info?.paddle_mode !== false) ids.push("paddles");
  if (info?.simulated_trainer !== false) ids.push("sim");
  return ids.map((id) => {
    const unavailable = id === "paddles" && picked?.kind === "studio";
    return { id, ...MODES[id], available: !unavailable, reason: unavailable ? "Studio classes need a trainer or the simulator." : "" };
  });
}

/** The remembered way to ride while it's available, else what this browser can do best. */
export function chooseRideMode(saved, modes, bluetooth) {
  const usable = (id) => modes.some((mode) => mode.id === id && mode.available);
  if (usable(saved)) return saved;
  if (bluetooth) return "trainer";
  return ["paddles", "sim"].find(usable) ?? "trainer";
}

/** Heart rate and controller go with Bluetooth riding; the workout keeps heart rate only. */
export function addonsShown(mode, bluetooth, picked) {
  if (!bluetooth) return { hr: false, controller: false };
  if (picked?.kind === "workout") return { hr: true, controller: false };
  const riding = mode !== "paddles";
  return { hr: riding, controller: riding };
}

/**
 * A failed connect in plain words: what to try, not what the browser said.
 * The browser's message stays in the device log (Settings → Device diagnostics).
 */
export function connectErrorText(error, deviceName = null) {
  const name = error?.name;
  const message = error?.message ?? "";
  if (/adapter/i.test(message)) return "Bluetooth is off on this computer. Turn it on and try again.";
  if (name === "NotFoundError") return "Cancelled";
  if (/already connected/i.test(message)) return `That half is already connected: pick the other ${message.replace(/ is already connected\.?$/i, "")} (wake it with a button press).`;
  if (name === "TimeoutError") return `No answer from ${deviceName ?? "the device"}. Is it awake, and free of other apps (Zwift, the trainer's app)?`;
  if (name === "SecurityError" || name === "NotAllowedError") return "Bluetooth is blocked for this site in the browser settings.";
  if (/neither FTMS|subscribe to any power/i.test(message)) return "This device doesn't send power data: pick your trainer, not a sensor.";
  if (name === "NetworkError" || /GATT|connection/i.test(message)) return "Couldn't connect. Wake it with a few pedal strokes, close other apps using it, then try again.";
  return `Couldn't connect (${message}). Settings → Device diagnostics has the details.`;
}

/** After this long without a packet the trainer is probably asleep or taken by another app. */
export const SILENT_AFTER_MS = 5000;

/**
 * The live check under the trainer: is data arriving, and is it real?
 * `sinceDataMs`: time since the last packet (null: none yet).
 * @returns {{state: "waiting" | "idle" | "live" | "silent", text: string}}
 */
export function liveCheck({ sinceDataMs, power, cadence }) {
  if (sinceDataMs === null || sinceDataMs === undefined) return { state: "waiting", text: "Connected · waiting for data…" };
  if (sinceDataMs > SILENT_AFTER_MS) return { state: "silent", text: `No data for ${Math.floor(sinceDataMs / 1000)} s: is the trainer awake and free of other apps?` };
  if (power > 0) return { state: "live", text: `✓ ${Math.round(power)} W · ${Number.isFinite(cadence) ? Math.round(cadence) : "–"} rpm` };
  return { state: "idle", text: "Connected · pedal to check" };
}

/**
 * A device line's actions: Reconnect for a remembered device that isn't
 * connected (the chooser then reads "Other"), else one button to connect,
 * change or (controllers come in pairs) add another.
 * @returns {{reconnect: boolean, other: string}}
 */
export function deviceActions({ kind, connected, remembered, otherHalf = false }) {
  if (connected) return { reconnect: false, other: kind !== "controller" ? "Change" : otherHalf ? "Add other half" : "Add another" };
  if (remembered) return { reconnect: true, other: "Other" };
  return { reconnect: false, other: kind === "trainer" ? "Connect" : "Add" };
}

const BUTTON_NAMES = {
  shiftUp: "shift up (+)",
  shiftDown: "shift down (−)",
  up: "up",
  down: "down",
  left: "left",
  right: "right",
  a: "A",
  b: "B",
  y: "Y",
  z: "Z",
};

/**
 * The controller check under the line: + and − confirmed one by one (with two
 * Click halves each half has to arrive), other buttons by name.
 * @param {{seen: Set<string>, last?: {label: string, buttons: string[]} | null}} state
 */
export function controllerCheck({ seen, last = null }) {
  const up = seen.has("shiftUp");
  const down = seen.has("shiftDown");
  if (up && down) return "✓ + and − both work";
  if (up) return "✓ + works · press − to check";
  if (down) return "✓ − works · press + to check";
  if (last?.buttons?.length) return `✓ ${last.label}: ${last.buttons.map((button) => BUTTON_NAMES[button] ?? `button ${button}`).join(", ")} · press + and − to check`;
  return "Press + and − to check";
}

/** A controller's side from what it sent: a Click v2 or Play half shifts only one way. Null: unknown, or both. */
export function controllerSide(seen) {
  const up = seen.has("shiftUp");
  const down = seen.has("shiftDown");
  if (up === down) return null;
  return up ? "+" : "−";
}

/** "Zwift Click − 70 % · + 68 %": a pair names the controller once, then each half by side. */
export function controllerLine(controllers) {
  const pair = controllers.length > 1 && controllers.every((c) => c.label === controllers[0].label);
  const parts = controllers.map((c, i) => {
    const state = !c.connected ? "reconnecting…" : c.battery !== null && c.battery !== undefined ? `${c.battery} %` : "";
    const side = controllerSide(c.seen);
    const name = pair && i > 0 ? "" : c.label;
    return [name, side, state].filter(Boolean).join(" ");
  });
  // A pair's second half before its first press or battery: still say it's there.
  if (pair && parts.slice(1).every((part) => !part)) return controllers.every((c) => controllerSide(c.seen) === null && (c.battery === null || c.battery === undefined)) ? `${parts[0]} · both halves` : `${parts[0]} · other half`;
  return parts.map((part) => part || "other half").join(" · ");
}

/**
 * Click v2 and Play come as two halves: with one connected, the other is expected.
 * A Click's halves differ (one relays the other, one sends only its own side), so
 * both are connected and their presses merged (MergedControllers). Not once one
 * half has sent both + and −: that one relays.
 */
export function expectsOtherHalf(controllers) {
  if (controllers.length !== 1) return false;
  const [only] = controllers;
  return /zwift (click|play)/i.test(only.label) && !(only.seen.has("shiftUp") && only.seen.has("shiftDown"));
}

/**
 * A lone Click half that only sends its own buttons (no battery, no status) can't
 * shift the other way: say which side is missing. Null when nothing is missing.
 */
export function missingHalfHint(controllers) {
  if (controllers.length !== 1) return null;
  const [only] = controllers;
  if (!/zwift click/i.test(only.label) || only.relays) return null;
  // The half that doesn't relay is the right one (it never locks): B covers shifting down.
  return "Right half only: + shifts up, B shifts down. Add the other half for the − lever.";
}

const isClickV2Half = (controller) => /zwift click/i.test(controller.label);

/**
 * A Click v2's − lever is on its left half, which Zwift's firmware locks about a
 * minute after connecting unless the Zwift app unlocked it (riders' reports;
 * BikeControl documents the same). The right half never locks. So shifting down
 * needs a fallback button on the right half when no unlocked left half is there:
 * none connected (`relays` false: the right half alone) or the left one locked.
 */
export function needsDownButton(controllers) {
  const halves = controllers.filter((c) => c.connected && isClickV2Half(c));
  if (halves.length === 0) return false;
  return !halves.some((c) => c.relays && !c.locked);
}

/** The right half's button that shifts down when needed: B, as in BikeControl's right-side mode. */
export const DOWN_BUTTON = "b";

/** While the fallback is needed, B shifts down instead of its usual action. */
export function remapForDown(pressed, active) {
  return active ? pressed.map((button) => (button === DOWN_BUTTON ? "shiftDown" : button)) : pressed;
}
