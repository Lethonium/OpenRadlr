/**
 * The cockpit's tile layout: a list of `{ id, size }` kept in localStorage.
 * Pure functions: every change returns a new array. Storage is injected.
 */
import { DEFAULT_LAYOUT, TILES, tileById } from "./tiles.js";

export const LAYOUT_KEY = "openradlr.cockpit.layout";

const defaultLayout = () => DEFAULT_LAYOUT.map((entry) => ({ ...entry }));

/** The valid entries of whatever was stored: known ids, allowed sizes, first of each id. */
function sanitize(stored) {
  if (!Array.isArray(stored)) return [];
  const seen = new Set();
  const layout = [];
  for (const entry of stored) {
    const tile = typeof entry?.id === "string" ? tileById(entry.id) : undefined;
    if (!tile || seen.has(tile.id) || !tile.sizes.includes(entry.size)) continue;
    seen.add(tile.id);
    layout.push({ id: tile.id, size: entry.size });
  }
  return layout;
}

/** The stored layout, or a copy of the default when there is none that can be used. */
export function loadLayout(storage) {
  try {
    const layout = sanitize(JSON.parse(storage.getItem(LAYOUT_KEY)));
    return layout.length > 0 ? layout : defaultLayout();
  } catch {
    return defaultLayout();
  }
}

export function saveLayout(storage, layout) {
  try {
    storage.setItem(LAYOUT_KEY, JSON.stringify(layout));
  } catch {
    // Storage full or blocked: the layout just doesn't survive a reload.
  }
}

export const resetLayout = defaultLayout;

const inRange = (layout, index) => Number.isInteger(index) && index >= 0 && index < layout.length;

export function moveTile(layout, from, to) {
  if (!inRange(layout, from) || !inRange(layout, to) || from === to) return layout.slice();
  const next = layout.slice();
  const [entry] = next.splice(from, 1);
  next.splice(to, 0, entry);
  return next;
}

export function addTile(layout, id) {
  const tile = tileById(id);
  if (!tile || layout.some((entry) => entry.id === id)) return layout.slice();
  return [...layout, { id, size: tile.sizes[0] }];
}

export function removeTile(layout, index) {
  return layout.filter((_, i) => i !== index);
}

export function resizeTile(layout, index) {
  if (!inRange(layout, index)) return layout.slice();
  const { id, size } = layout[index];
  const { sizes } = tileById(id);
  const next = sizes[(sizes.indexOf(size) + 1) % sizes.length];
  return layout.map((entry, i) => (i === index ? { id, size: next } : entry));
}

/** The catalogue tiles not in the layout, in catalogue order. */
export function hiddenTiles(layout) {
  const shown = new Set(layout.map((entry) => entry.id));
  return TILES.filter((tile) => !shown.has(tile.id));
}
