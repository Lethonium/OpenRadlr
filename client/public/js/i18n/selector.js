import { SUPPORTED_LOCALES } from "./i18n.js";

/** Pressed state of each language button for the current locale. */
export function languageButtonStates(current) {
  return Object.fromEntries(SUPPORTED_LOCALES.map((code) => [code, code === current]));
}
