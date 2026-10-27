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
