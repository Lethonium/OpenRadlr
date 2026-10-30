import { RAMP_TO_FTP } from "../ride/ftpTest.js";
import { t } from "../i18n/i18n.js";

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
      return view(t("ftp.test.warmup.title"), t("ftp.test.warmup.body", { best }), { id: "proceed", label: t("ftp.test.warmup.proceed") });
    }
    case "settings":
      return view(t("ftp.test.settings.title"), t("ftp.test.settings.body", { start: startW, step: stepW }), { id: "start", label: t("ftp.test.settings.start") }, { id: "back", label: t("ftp.test.settings.back") }, true);
    case "countdown":
      return view(t("ftp.test.countdown.title"), t("ftp.test.countdown.body"));
    case "ramp":
      return view(t("ftp.test.ramp.title"), t("ftp.test.ramp.body"), { id: "done", label: t("ftp.test.ramp.done") });
    case "result": {
      const keep = { id: "keep", label: t("ftp.test.result.keep", { ftp }) };
      if (result?.tooShort) return view(t("ftp.test.result.tooShort"), "", { id: "retry", label: t("ftp.test.result.retry") }, keep);
      const percent = Math.round(RAMP_TO_FTP * 100);
      return view(t("ftp.test.result.title", { ftp: result.ftp }), t("ftp.test.result.body", { percent, best: result.bestMinuteW }), { id: "use", label: t("ftp.test.result.use", { ftp: result.ftp }) }, keep);
    }
    default:
      return view(t("ftp.test.entry"), source === "default" ? t("ftp.test.defaultHint") : "", { id: "begin", label: t("ftp.test.entry") });
  }
}
