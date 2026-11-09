import { t } from "../i18n/i18n.js";

/** Wording of the "new FTP" offer on the finish screen. */
export function ftpPromptText({ ftp, delta, basis, source }) {
  const sign = delta < 0 ? "−" : "+";
  const detail = source === "test" ? t("ftp.prompt.test") : basis === "twenty" ? t("ftp.prompt.twenty") : t("ftp.prompt.recent");
  return { title: t("ftp.prompt.title", { ftp, delta: `${sign}${Math.abs(delta)}` }), detail };
}
