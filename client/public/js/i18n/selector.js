import { SUPPORTED_LOCALES } from "./i18n.js";

/** Each language in its own name (never translated), so a rider finds theirs in any language. */
const NATIVE_NAMES = { en: "English", de: "Deutsch" };

/** The language dropdown's options, one per supported locale, with the current one selected. */
export function languageOptions(current) {
  return SUPPORTED_LOCALES.map((code) => ({ code, label: NATIVE_NAMES[code] ?? code.toUpperCase(), selected: code === current }));
}
