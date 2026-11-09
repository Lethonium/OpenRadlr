import { t } from "../i18n/i18n.js";

/** One line under the FTP field saying where the profile's FTP came from. */
export function ftpProvenance(profile, { locale } = {}) {
  if (!profile.ftpSource || profile.ftpSource === "default") {
    return t("ftp.source.default");
  }
  const how = { typed: t("ftp.source.typed"), estimated: t("ftp.source.estimated"), tested: t("ftp.source.tested") }[profile.ftpSource];
  if (!how) return "";
  if (!profile.ftpDate) return t("ftp.source.plain", { how });
  const format = { day: "numeric", month: "short" };
  const when = new Date(profile.ftpDate);
  let date;
  try {
    date = when.toLocaleDateString(locale, format);
  } catch {
    // A malformed browser locale (e.g. "en-US@posix") throws a RangeError
    date = when.toLocaleDateString(undefined, format);
  }
  return t("ftp.source.dated", { how, date });
}
