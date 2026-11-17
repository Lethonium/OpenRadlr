import { t } from "../i18n/i18n.js";

/** The first letter of `name` (a whole grapheme, uppercased), or "?" for a rider without a name. */
function initialOf(name) {
  const first = [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(name)][0]?.segment;
  return first ? first.toLocaleUpperCase() : "?";
}

/**
 * The switcher's rows: one per rider of the roster, in its order.
 * @param {{active: string, ids: string[]}} roster
 * @param {(id: string) => string} nameOf the rider's profile name
 * @returns {{id: string, name: string, initial: string, active: boolean}[]}
 */
export function riderRows(roster, nameOf) {
  return roster.ids.map((id) => {
    const name = String(nameOf(id) ?? "").trim();
    return { id, name: name || t("riders.unnamed"), initial: initialOf(name), active: id === roster.active };
  });
}
