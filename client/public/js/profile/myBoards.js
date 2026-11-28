/**
 * The rider's own roadside-board posters (a picture, a line of text, or both). They
 * stay on this device: one IndexedDB per rider (ride/rideStores.js), never in the
 * account backup, the data export or any message to a server (profile/localData.js).
 * Pictures are cropped to the poster's 2:1 shape, downscaled and re-encoded here, which
 * also drops EXIF and GPS data.
 */

export const MAX_BOARDS = 12;
export const UPLOAD_SIZE = { width: 1024, height: 512 };
const MAX_TEXT = 80;
const MAX_ZOOM = 8;
const JPEG = { type: "image/jpeg", quality: 0.85 };

/**
 * One rider's uploads over a key-value store (`indexedDbStore`).
 * @typedef {{id: string, text: string, blob: Blob | null, crop: {x: number, y: number, scale: number} | null, addedAt: number}} BoardUpload
 */
export class MyBoards {
  #counter = 0;
  #queue = Promise.resolve();

  /** @param {{store: {get: Function, put: Function, delete: Function, keys: Function}, now?: () => number}} options */
  constructor({ store, now = Date.now }) {
    this.store = store;
    this.now = now;
  }

  /** Every upload, oldest first. */
  async list() {
    const entries = await Promise.all((await this.store.keys()).map((key) => this.store.get(key)));
    return entries.filter(Boolean).sort((a, b) => a.addedAt - b.addedAt);
  }

  /**
   * Adds an upload: `blob` (already prepared, see `prepareImage`) and/or `text` (trimmed, at most 80 characters).
   * @param {{blob?: Blob | null, text?: string, crop?: {x: number, y: number, scale: number} | null}} upload
   * @returns {Promise<{ok: true, id: string} | {ok: false, reason: "full" | "empty" | "tooLong" | "storage"}>}
   */
  add({ blob = null, text = "", crop = null } = {}) {
    const trimmed = String(text ?? "").trim();
    if (!blob && !trimmed) return Promise.resolve({ ok: false, reason: "empty" });
    if (trimmed.length > MAX_TEXT) return Promise.resolve({ ok: false, reason: "tooLong" });
    // One add at a time, so several started together can't pass the cap check together.
    const run = this.#queue.then(async () => {
      try {
        if ((await this.store.keys()).length >= MAX_BOARDS) return { ok: false, reason: "full" };
        const addedAt = this.now();
        const id = `b-${addedAt}-${(this.#counter += 1)}`;
        await this.store.put(id, { id, text: trimmed, blob: blob ?? null, crop, addedAt });
        return { ok: true, id };
      } catch {
        return { ok: false, reason: "storage" };
      }
    });
    this.#queue = run;
    return run;
  }

  /** @param {string} id */
  async remove(id) {
    await this.store.delete(id);
  }
}

const clamp = (value, lo, hi) => Math.min(hi, Math.max(lo, Number.isFinite(value) ? value : lo));

/** An offscreen canvas where there is one, else a page canvas. */
export function defaultCanvas(width, height) {
  if (typeof OffscreenCanvas === "function") return new OffscreenCanvas(width, height);
  return Object.assign(document.createElement("canvas"), { width, height });
}

const encode = (canvas) =>
  canvas.convertToBlob
    ? canvas.convertToBlob(JPEG)
    : new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("no blob"))), JPEG.type, JPEG.quality));

/**
 * The region of a `width` × `height` picture the poster shows: the largest 2:1 window that fits,
 * shrunk by `scale` (1 = all of it, up to 8), placed by `x` and `y` (0..1 across the room left over).
 */
export function cropWindow(width, height, { x = 0.5, y = 0.5, scale = 1 } = {}) {
  const ratio = UPLOAD_SIZE.width / UPLOAD_SIZE.height;
  const baseW = Math.min(width, height * ratio);
  const sw = baseW / clamp(scale, 1, MAX_ZOOM);
  const sh = sw / ratio;
  return { sx: (width - sw) * clamp(x, 0, 1), sy: (height - sh) * clamp(y, 0, 1), sw, sh };
}

/**
 * Crops `file` to the poster's 2:1 shape, scales it to 1024×512 and re-encodes it as JPEG 0.85.
 * A file the browser can't decode (or encode) is `unreadable`; nothing throws.
 * @param {Blob} file
 * @param {{x: number, y: number, scale: number}} crop
 * @param {{decode?: (file: Blob) => Promise<{width: number, height: number, close?: () => void}>, createCanvas?: (width: number, height: number) => any}} [deps]
 * @returns {Promise<{ok: true, blob: Blob} | {ok: false, reason: "unreadable"}>}
 */
export async function prepareImage(file, crop, { decode = (source) => createImageBitmap(source), createCanvas = defaultCanvas } = {}) {
  let image = null;
  try {
    image = await decode(file);
    if (!(image.width > 0 && image.height > 0)) throw new Error("empty image");
    const { sx, sy, sw, sh } = cropWindow(image.width, image.height, crop);
    const canvas = createCanvas(UPLOAD_SIZE.width, UPLOAD_SIZE.height);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff"; // under transparent pixels, which JPEG can't keep
    ctx.fillRect(0, 0, UPLOAD_SIZE.width, UPLOAD_SIZE.height);
    ctx.drawImage(image, sx, sy, sw, sh, 0, 0, UPLOAD_SIZE.width, UPLOAD_SIZE.height);
    return { ok: true, blob: await encode(canvas) };
  } catch {
    return { ok: false, reason: "unreadable" };
  } finally {
    image?.close?.();
  }
}
