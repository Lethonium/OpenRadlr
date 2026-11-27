/**
 * Pure poster choice: which poster stands on which billboard, and which atlas slot each board reads from. A slot is a
 * tile of the poster atlas (ATLAS_SLOTS of them); boards beyond that share slots of their own kind.
 */
import { seededRandom } from "../../world/noise.js";
import { POSTERS } from "./lines.js";

export const ATLAS_SLOTS = 8;

const POSTER_BY_ID = new Map(POSTERS.map((poster) => [poster.id, poster]));

function hashString(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

/**
 * boards: { kind, distance }[]. uploads: { id }[] in stored order. Returns the atlas slots and, per board, its slot index.
 * Uploads fill general boards in distance order; a rotation seeded by route and date picks which uploads when there
 * are more than fit. Every other board gets a default poster of its kind, never the same one twice in a row.
 */
export function choosePosters(boards, { routeId, uploads, dateKey }) {
  const pick = seededRandom(hashString(`${routeId}|${dateKey}`));
  const choose = (list) => list[Math.floor(pick() * list.length)];
  const order = boards.map((_, i) => i).sort((a, b) => boards[a].distance - boards[b].distance || a - b);
  const slots = [];
  const slotOf = new Array(boards.length);
  const kindOf = (slot) => (slot.type === "upload" ? "general" : POSTER_BY_ID.get(slot.id).kind);
  const lastPoster = new Map();
  const lastSlot = new Map();

  const newDefault = (kind) => {
    const avoid = lastPoster.get(kind);
    const options = POSTERS.filter((poster) => poster.kind === kind && poster.id !== avoid);
    const id = choose(options).id;
    lastPoster.set(kind, id);
    slots.push({ type: "default", id });
    return slots.length - 1;
  };

  // Every non-general kind gets its slot first, so uploads and general defaults can never starve a climb or last-km board.
  const otherKinds = [...new Set(boards.map((board) => board.kind))].filter((kind) => kind !== "general");
  for (const kind of otherKinds) newDefault(kind);

  // Uploads go to the first general boards; one slot stays free for a general default.
  const generals = order.filter((i) => boards[i].kind === "general");
  const cap = Math.min(uploads.length, generals.length, ATLAS_SLOTS - slots.length - 1);
  let chosen = uploads.slice(0, cap);
  if (uploads.length > cap) {
    const start = Math.floor(pick() * uploads.length);
    chosen = Array.from({ length: cap }, (_, k) => uploads[(start + k) % uploads.length]);
  }
  chosen.forEach((upload, k) => {
    slots.push({ type: "upload", id: upload.id });
    slotOf[generals[k]] = slots.length - 1;
  });

  for (const i of order) {
    if (slotOf[i] !== undefined) continue;
    const kind = boards[i].kind;
    if (slots.length < ATLAS_SLOTS) {
      slotOf[i] = newDefault(kind);
    } else {
      const sameKind = slots.map((slot, s) => s).filter((s) => kindOf(slots[s]) === kind);
      const options = sameKind.filter((s) => s !== lastSlot.get(kind));
      slotOf[i] = options.length ? choose(options) : sameKind[0];
    }
    lastSlot.set(kind, slotOf[i]);
  }

  return { slots, slotOf };
}
