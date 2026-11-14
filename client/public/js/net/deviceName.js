// Device names are product names, not prose: they are the same in every language.
/** A short, human name for the device a browser runs on, from its user agent. */
export function deviceName(userAgent) {
  const ua = userAgent ?? "";
  if (/OculusBrowser/.test(ua)) return /Quest 3/.test(ua) ? "Quest 3" : "Quest"; // i18n-ok
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua)) return "iPad";
  if (/Android/.test(ua)) return /Mobile/.test(ua) ? "Android phone" : "Android tablet"; // i18n-ok
  return "Browser"; // i18n-ok
}
