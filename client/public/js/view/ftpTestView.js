import { RAMP_TO_FTP } from "../ride/ftpTest.js";

/** Hint on the entry while the FTP is still the built-in default. */
const DEFAULT_HINT = "No measured FTP yet. Take the ramp test.";

/**
 * The FTP test panel's text for a session state. Watts only, so no unit switch.
 * `ftp` is the profile's current FTP (the "keep" choice), `source` where it came from.
 * @returns {{heading: string, body: string, primary: ?{id: string, label: string}, secondary: ?{id: string, label: string}, fields: boolean}}
 */
export function ftpTestState({ state, startW, stepW, liveMinuteW = null, result = null, ftp, source }) {
  const view = (heading, body, primary = null, secondary = null, fields = false) => ({ heading, body, primary, secondary, fields });
  switch (state) {
    case "warmup": {
      const best = liveMinuteW === null ? "–" : `${Math.round(liveMinuteW)} W`;
      return view("Warm up", `Ride freely at your own level. Your best minute so far: ${best}.`, { id: "proceed", label: "I'm warm, set up the ramp" });
    }
    case "settings":
      return view("Ramp setup", `Starts at ${startW} W and adds ${stepW} W every minute until you can't hold the target.`, { id: "start", label: "Start ramp" }, { id: "back", label: "Back to warmup" }, true);
    case "countdown":
      return view("Get ready", "The ramp starts in a moment.");
    case "ramp":
      return view("Ramp test", "Hold the target as long as you can.", { id: "done", label: "I'm done" });
    case "result": {
      const keep = { id: "keep", label: `Keep ${ftp} W` };
      if (result?.tooShort) return view("That ramp was too short to trust.", "", { id: "retry", label: "Try again" }, keep);
      const percent = Math.round(RAMP_TO_FTP * 100);
      return view(`Your FTP ≈ ${result.ftp} W`, `${percent} % of your best minute (${result.bestMinuteW} W). It is an estimate.`, { id: "use", label: `Use ${result.ftp} W` }, keep);
    }
    default:
      return view("FTP test", source === "default" ? DEFAULT_HINT : "", { id: "begin", label: "FTP test" });
  }
}
