import { SEASON_MODES } from "../world/seasons.js";

/** i18n keys spelled out so the unused-key check can see them. */
const LABELS = Object.freeze({
  auto: "season.auto",
  spring: "season.spring",
  summer: "season.summer",
  autumn: "season.autumn",
  winter: "season.winter",
});

/**
 * What the season pickers offer: automatic, then the four seasons.
 * @returns {{id: string, label: string}[]} `label` is an i18n key
 */
export function seasonChoices() {
  return SEASON_MODES.map((id) => ({ id, label: LABELS[id] }));
}
