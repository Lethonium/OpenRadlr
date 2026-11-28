/**
 * The My boards page's lines: pure builders of the texts shown, from the uploads and the cap.
 * main.js writes them into the markup with textContent.
 */

import { t } from "../i18n/i18n.js";

const ERROR_KEYS = {
  full: "boards.error.full",
  empty: "boards.error.empty",
  tooLong: "boards.error.tooLong",
  unreadable: "boards.error.unreadable",
  storage: "boards.error.save",
};

/** The message key for a failed add or prepare (`full`, `empty`, `tooLong`, `unreadable`, `storage`). */
export function boardErrorKey(reason) {
  return ERROR_KEYS[reason] ?? ERROR_KEYS.storage;
}

/**
 * @param {unknown[]} entries the rider's uploads
 * @param {{max: number}} limits
 * @returns {{count: string, canAdd: boolean, empty: string | null}}
 */
export function myBoardsLines(entries, { max }) {
  return {
    count: t("boards.page.count", { n: entries.length, max }),
    canAdd: entries.length < max,
    empty: entries.length === 0 ? t("boards.page.empty") : null,
  };
}

/**
 * The pixel size of a poster thumbnail shown `cssWidth` CSS pixels wide (the poster is 2:1) on a screen of `ratio`
 * device pixels per CSS pixel, so it is painted at the size it is displayed at, not stretched.
 * @returns {{width: number, height: number}}
 */
export function thumbSize(cssWidth, ratio = 1) {
  const width = Math.max(1, Math.round(cssWidth * (ratio > 0 ? ratio : 1)));
  return { width, height: Math.round(width / 2) };
}
