/** The splits table of the finish screen (#83). */
import { compareSplits } from "../ride/splits.js";
import { formatDistanceWithUnit, formatDuration, formatElevation, formatSpeed, speedUnit } from "../util/format.js";
import { splitLabel } from "./hud.js";

const percent = (delta) => {
  const n = Math.round(delta * 100);
  return n > 0 ? `+${n} %` : n < 0 ? `−${-n} %` : "0 %";
};

/**
 * One row of strings per split; `best` marks the fastest comparable split and
 * `hint` how a comparable one differs from the average of the comparable ones.
 */
export function splitRows(splits, unitM = 1000) {
  const compared = compareSplits(splits);
  return splits.map((split, i) => ({
    label: splitLabel(split, unitM),
    time: formatDuration(split.durationS),
    distance: formatDistanceWithUnit(split.distanceM),
    speed: `${formatSpeed(split.avgSpeed)} ${speedUnit()}`,
    power: `${Math.round(split.avgPower)} W`,
    heartRate: split.avgHeartRate === null ? "–" : `${Math.round(split.avgHeartRate)} bpm`,
    gain: formatElevation(split.elevationGainM),
    best: compared[i].best,
    hint: compared[i].comparable && compared[i].speedDelta !== null ? percent(compared[i].speedDelta) : "",
  }));
}

const COLUMNS = [
  ["label", "Split"],
  ["time", "Time"],
  ["distance", "Distance"],
  ["speed", "Speed"],
  ["power", "Power"],
  ["heartRate", "Heart"],
  ["gain", "Climb"],
  ["hint", ""],
];

/** Fills `table`; it stays hidden for a single split (nothing to compare). */
export function renderSplits(table, splits, unitM = 1000) {
  table.hidden = splits.length < 2;
  if (table.hidden) return table.replaceChildren();
  const rows = splitRows(splits, unitM);
  const columns = COLUMNS.filter(([key]) => key !== "heartRate" || splits.some((split) => split.avgHeartRate !== null));
  const doc = table.ownerDocument;
  const cell = (tag, text) => Object.assign(doc.createElement(tag), { textContent: text });
  const head = doc.createElement("tr");
  head.append(...columns.map(([, title]) => cell("th", title)));
  const body = rows.map((row) => {
    const tr = doc.createElement("tr");
    if (row.best) tr.className = "best";
    tr.append(...columns.map(([key]) => cell("td", row[key])));
    return tr;
  });
  const thead = doc.createElement("thead");
  thead.append(head);
  const tbody = doc.createElement("tbody");
  tbody.append(...body);
  table.replaceChildren(thead, tbody);
}
