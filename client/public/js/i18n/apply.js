// Applies translations to elements marked data-i18n (text) and data-i18n-attr
// ("attr:key,attr:key"). Only textContent and setAttribute: never innerHTML.
import { t } from "./i18n.js";

function translate(el) {
  if (el.dataset.i18n !== undefined) el.textContent = t(el.dataset.i18n);
  if (el.dataset.i18nAttr !== undefined) {
    for (const pair of el.dataset.i18nAttr.split(",")) {
      const [attr, key] = pair.trim().split(":");
      if (attr && key) el.setAttribute(attr, t(key));
    }
  }
}

export function applyTranslations(root = document) {
  if (root.matches?.("[data-i18n],[data-i18n-attr]")) translate(root);
  for (const el of root.querySelectorAll("[data-i18n]")) translate(el);
  for (const el of root.querySelectorAll("[data-i18n-attr]")) {
    if (el.dataset.i18n === undefined) translate(el);
  }
}
