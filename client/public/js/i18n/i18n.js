// Dependency-free i18n: module-state locale, flat dictionaries, {name} interpolation.
import en from "./en.js";
import de from "./de.js";

export const SUPPORTED_LOCALES = ["en", "de"];
export const DEFAULT_LOCALE = "en";
export const LOCALE_KEY = "openradlr.locale";

const dictionaries = { en, de };
let locale = DEFAULT_LOCALE;

function baseLanguage(tag) {
  return String(tag).toLowerCase().split("-")[0];
}

export function detectLocale({ saved, languages } = {}) {
  if (SUPPORTED_LOCALES.includes(saved)) return saved;
  for (const tag of languages ?? []) {
    const base = baseLanguage(tag);
    if (SUPPORTED_LOCALES.includes(base)) return base;
  }
  return DEFAULT_LOCALE;
}

export function getLocale() {
  return locale;
}

export function setLocale(code) {
  locale = SUPPORTED_LOCALES.includes(code) ? code : DEFAULT_LOCALE;
  return locale;
}

function lookup(key) {
  return dictionaries[locale]?.[key] ?? dictionaries[DEFAULT_LOCALE][key];
}

function interpolate(template, params) {
  return template.replace(/\{(\w+)\}/g, (match, name) =>
    params && name in params ? String(params[name]) : match);
}

export function t(key, params) {
  const template = lookup(key);
  return template === undefined ? key : interpolate(template, params);
}

export function tn(key, count, params) {
  const form = new Intl.PluralRules(locale).select(count);
  const withN = { ...params, n: count };
  const template = lookup(`${key}.${form}`) ?? lookup(`${key}.other`);
  return template === undefined ? key : interpolate(template, withN);
}

export function initLocale({ storage, languages } = {}) {
  let saved;
  try {
    saved = storage?.getItem(LOCALE_KEY);
  } catch {
    saved = undefined;
  }
  return setLocale(detectLocale({ saved, languages }));
}

export function saveLocale(code, storage) {
  try {
    storage?.setItem(LOCALE_KEY, code);
  } catch {
    // storage unavailable: the choice just won't persist
  }
}
