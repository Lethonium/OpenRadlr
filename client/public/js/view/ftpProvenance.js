/** One line under the FTP field saying where the profile's FTP came from. */
export function ftpProvenance(profile, { locale } = {}) {
  if (!profile.ftpSource || profile.ftpSource === "default") {
    return "Default value: take the FTP test or ride a hard effort to measure it.";
  }
  const how = { typed: "Entered by hand", estimated: "Estimated from your rides", tested: "Measured by the ramp test" }[profile.ftpSource];
  if (!how) return "";
  if (!profile.ftpDate) return `${how}.`;
  const format = { day: "numeric", month: "short" };
  const when = new Date(profile.ftpDate);
  let date;
  try {
    date = when.toLocaleDateString(locale, format);
  } catch {
    // A malformed browser locale (e.g. "en-US@posix") throws a RangeError
    date = when.toLocaleDateString(undefined, format);
  }
  return `${how} on ${date}.`;
}
