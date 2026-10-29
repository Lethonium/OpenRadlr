/**
 * Ride photos: snapshots of the world with a small stats overlay, and a
 * summary card for the end of the ride. Both are drawn on a 2D canvas (no
 * DOM screenshot), so they look the same on every device and are ready to
 * attach to a Strava activity. The browser keeps them in memory until the
 * page is closed; the finish dialog lists them for download or sharing.
 */

import { formatDistanceWithUnit, formatDuration, formatSpeed, speedUnit } from "../util/format.js";
import { t } from "../i18n/i18n.js";

export const MAX_PHOTOS = 30;
const SANS = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'; // i18n-ok
const NUM = '"Barlow Condensed", "Roboto Condensed", "Arial Narrow", system-ui, sans-serif'; // i18n-ok
const ACCENT = "#ff7a1a";

/** "openradlr-2026-10-14-1530-rolling-hills-3.png" */
export function photoFileName(t, routeId = "ride", suffix = "") {
  const d = new Date(t);
  const pad = (n) => String(n).padStart(2, "0");
  const safe = String(routeId).replace(/[^a-z0-9-]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "ride";
  const tail = suffix === "" ? "" : `-${suffix}`;
  return `openradlr-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}-${safe}${tail}.png`;
}

/**
 * The photos taken during one ride, oldest first. Holds blobs plus object
 * URLs for the thumbnails; the oldest photo is dropped beyond `max`.
 */
export class PhotoAlbum {
  /** @type {{id: number, blob: Blob, url: string, name: string, takenAt: number}[]} */
  photos = [];
  /** The ride's summary card, regenerated whenever the finish dialog opens. */
  summary = null;
  #nextId = 1;

  /** @param {{max?: number, createUrl?: (blob: Blob) => string, revokeUrl?: (url: string) => void}} [options] */
  constructor({ max = MAX_PHOTOS, createUrl = (blob) => URL.createObjectURL(blob), revokeUrl = (url) => URL.revokeObjectURL(url) } = {}) {
    this.max = max;
    this.createUrl = createUrl;
    this.revokeUrl = revokeUrl;
  }

  /** Number of photos taken (the summary image doesn't count). */
  get size() {
    return this.photos.length;
  }

  /** Everything to download or share: the summary first, then the photos. */
  get images() {
    return this.summary ? [this.summary, ...this.photos] : [...this.photos];
  }

  setSummary(blob, { name, takenAt = Date.now() }) {
    if (this.summary) this.revokeUrl(this.summary.url);
    this.summary = { id: 0, blob, url: this.createUrl(blob), name, takenAt, summary: true };
    return this.summary;
  }

  add(blob, { name, takenAt = Date.now() }) {
    const photo = { id: this.#nextId++, blob, url: this.createUrl(blob), name, takenAt };
    this.photos.push(photo);
    while (this.photos.length > this.max) this.revokeUrl(this.photos.shift().url);
    return photo;
  }

  remove(id) {
    const index = this.photos.findIndex((photo) => photo.id === id);
    if (index < 0) return false;
    this.revokeUrl(this.photos[index].url);
    this.photos.splice(index, 1);
    return true;
  }

  /** Drops every photo and the summary card, e.g. when a new ride starts. */
  clear() {
    for (const image of this.images) this.revokeUrl(image.url);
    this.photos = [];
    this.summary = null;
  }
}

/** The stats shown on an in-ride photo, in display order. */
export function photoStats({ distanceM, elapsedS, power, speed, gradePercent }) {
  return [
    [t("photos.stat.distance"), formatDistanceWithUnit(distanceM)],
    [t("photos.stat.time"), formatDuration(elapsedS)],
    [t("photos.stat.power"), `${Math.round(power || 0)} W`],
    [t("photos.stat.speed"), `${formatSpeed(speed || 0)} ${speedUnit()}`],
    [t("photos.stat.grade"), `${gradePercent >= 0 ? "" : "−"}${Math.abs(gradePercent || 0).toFixed(1)} %`],
  ];
}

/**
 * Splits values into `count` buckets and averages each; used to draw the
 * power and elevation lines of a long ride on a small chart.
 * @param {number[]} values
 */
export function downsample(values, count) {
  if (values.length <= count) return [...values];
  const out = [];
  for (let i = 0; i < count; i += 1) {
    const from = Math.floor((i * values.length) / count);
    const to = Math.max(from + 1, Math.floor(((i + 1) * values.length) / count));
    let sum = 0;
    for (let j = from; j < to; j += 1) sum += values[j];
    out.push(sum / (to - from));
  }
  return out;
}

/**
 * Copies the visible world into a new canvas. Call it in the same frame as
 * the WebGL render: without preserveDrawingBuffer the buffer is cleared once
 * the browser has shown it.
 * @param {HTMLCanvasElement} source
 */
export function grabScene(source, doc = document) {
  const canvas = doc.createElement("canvas");
  canvas.width = source.width;
  canvas.height = source.height;
  canvas.getContext("2d").drawImage(source, 0, 0);
  return canvas;
}

/**
 * Draws a ride photo: the scene with a stats band along the bottom.
 * @param {HTMLCanvasElement} scene from grabScene
 * @param {{routeName: string, stats: [string, string][], when: Date}} info
 */
export function composePhoto(scene, { routeName, stats, when }, doc = document) {
  const canvas = doc.createElement("canvas");
  canvas.width = scene.width;
  canvas.height = scene.height;
  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;
  ctx.drawImage(scene, 0, 0);

  const u = Math.max(w, h * 1.6) / 1280; // layout unit, 1 at 1280 px wide
  const band = 92 * u;
  const fade = ctx.createLinearGradient(0, h - band * 1.8, 0, h);
  fade.addColorStop(0, "rgba(8, 10, 13, 0)");
  fade.addColorStop(0.45, "rgba(8, 10, 13, 0.55)");
  fade.addColorStop(1, "rgba(8, 10, 13, 0.82)");
  ctx.fillStyle = fade;
  ctx.fillRect(0, h - band * 1.8, w, band * 1.8);

  const pad = 28 * u;
  const baseline = h - pad;
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = ACCENT;
  ctx.font = `800 ${14 * u}px ${SANS}`;
  ctx.fillText("OPENRADLR", pad, baseline - 30 * u);
  ctx.fillStyle = "#fff";
  ctx.font = `600 ${24 * u}px ${SANS}`;
  ctx.fillText(fit(ctx, routeName, w * 0.3), pad, baseline);

  // Stats from the right edge leftwards.
  let x = w - pad;
  for (const [label, value] of [...stats].reverse()) {
    ctx.font = `700 ${36 * u}px ${NUM}`;
    const valueWidth = ctx.measureText(value).width;
    ctx.font = `700 ${12 * u}px ${SANS}`;
    const width = Math.max(valueWidth, ctx.measureText(label.toUpperCase()).width);
    if (x - width < w * 0.36) break; // keep clear of the route name on narrow screens
    ctx.textAlign = "right";
    ctx.fillStyle = "rgba(255, 255, 255, 0.7)";
    ctx.fillText(label.toUpperCase(), x, baseline - 38 * u);
    ctx.fillStyle = "#fff";
    ctx.font = `700 ${36 * u}px ${NUM}`;
    ctx.fillText(value, x, baseline);
    ctx.textAlign = "left";
    x -= width + 30 * u;
  }

  ctx.textAlign = "right";
  ctx.fillStyle = "rgba(255, 255, 255, 0.75)";
  ctx.font = `500 ${13 * u}px ${SANS}`;
  ctx.fillText(when.toLocaleString([], { dateStyle: "medium", timeStyle: "short" }), w - pad, pad + 13 * u);
  ctx.textAlign = "left";
  return canvas;
}

/**
 * Draws the end-of-ride card (1600 × 900): the last view of the world
 * behind a dark panel with the totals, an elevation profile and the power
 * line of the whole ride.
 * @param {{routeName: string, serverName: string, when: Date, stats: [string, string][],
 *          power: number[], elevation: (number|null)[], scene?: HTMLCanvasElement | null}} info
 */
export function composeSummary({ routeName, serverName, when, stats, power, elevation, scene = null }, doc = document) {
  const W = 1600;
  const H = 900;
  const canvas = doc.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#0f1216";
  ctx.fillRect(0, 0, W, H);
  if (scene && scene.width > 0 && scene.height > 0) {
    // Cover: scale to fill, crop the overflow.
    const scale = Math.max(W / scene.width, H / scene.height);
    const sw = W / scale;
    const sh = H / scale;
    ctx.drawImage(scene, (scene.width - sw) / 2, (scene.height - sh) / 2, sw, sh, 0, 0, W, H);
  }
  const shade = ctx.createLinearGradient(0, 0, W, 0);
  shade.addColorStop(0, "rgba(15, 18, 22, 0.94)");
  shade.addColorStop(0.62, "rgba(15, 18, 22, 0.86)");
  shade.addColorStop(1, "rgba(15, 18, 22, 0.35)");
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, W, H);

  const left = 80;
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = ACCENT;
  ctx.font = `800 22px ${SANS}`;
  ctx.fillText(t("photos.cardTitle"), left, 104);
  ctx.fillStyle = "#fff";
  ctx.font = `700 56px ${SANS}`;
  ctx.fillText(fit(ctx, routeName, 980), left, 172);
  ctx.fillStyle = "#aab3c0";
  ctx.font = `500 24px ${SANS}`;
  ctx.fillText(fit(ctx, `${when.toLocaleString([], { dateStyle: "long", timeStyle: "short" })} · ${serverName}`, 980), left, 214);

  // Totals in a grid of up to 4 columns.
  const columns = 4;
  const cellW = 250;
  stats.slice(0, 8).forEach(([label, value], i) => {
    const x = left + (i % columns) * cellW;
    const y = 300 + Math.floor(i / columns) * 128;
    ctx.fillStyle = "#8a94a3";
    ctx.font = `700 18px ${SANS}`;
    ctx.fillText(label.toUpperCase(), x, y);
    ctx.fillStyle = "#fff";
    let size = 64;
    do ctx.font = `700 ${size}px ${NUM}`;
    while (ctx.measureText(value).width > cellW - 24 && (size -= 4) > 28);
    ctx.fillText(value, x, y + 64);
  });

  // Elevation (filled) and power (line) over the ride.
  const chart = { x: left, y: 600, w: 980, h: 200 };
  ctx.fillStyle = "#8a94a3";
  ctx.font = `700 18px ${SANS}`;
  ctx.fillText("POWER", chart.x, chart.y - 18);
  ctx.fillStyle = "#5fb47c";
  ctx.fillText("ELEVATION", chart.x + 100, chart.y - 18);
  const heights = elevation.filter((v) => v !== null && Number.isFinite(v));
  if (heights.length > 1) {
    const series = downsample(elevation.map((v) => (v === null || !Number.isFinite(v) ? heights[0] : v)), 240);
    const lo = Math.min(...series);
    const hi = Math.max(...series, lo + 20);
    ctx.beginPath();
    ctx.moveTo(chart.x, chart.y + chart.h);
    series.forEach((v, i) => ctx.lineTo(chart.x + (i / (series.length - 1)) * chart.w, chart.y + chart.h - ((v - lo) / (hi - lo)) * chart.h * 0.7));
    ctx.lineTo(chart.x + chart.w, chart.y + chart.h);
    ctx.closePath();
    ctx.fillStyle = "rgba(95, 180, 124, 0.28)";
    ctx.fill();
  }
  if (power.length > 1) {
    const series = downsample(power, 240);
    const top = Math.max(...series, 100) * 1.1;
    ctx.beginPath();
    series.forEach((v, i) => {
      const x = chart.x + (i / (series.length - 1)) * chart.w;
      const y = chart.y + chart.h - (v / top) * chart.h;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = 3;
    ctx.lineJoin = "round";
    ctx.stroke();
  }
  ctx.strokeStyle = "rgba(255, 255, 255, 0.15)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(chart.x, chart.y + chart.h + 0.5);
  ctx.lineTo(chart.x + chart.w, chart.y + chart.h + 0.5);
  ctx.stroke();
  return canvas;
}

/** Shortens text with an ellipsis until it fits `maxWidth`. */
function fit(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let cut = text;
  while (cut.length > 1 && ctx.measureText(`${cut}…`).width > maxWidth) cut = cut.slice(0, -1);
  return `${cut}…`;
}

/** Resolves with a PNG blob of the canvas. */
export function canvasToPng(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("could not encode the image"))), "image/png");
  });
}

/** Saves a blob as a file through a temporary link. */
export function downloadBlob(blob, name, doc = document) {
  const url = URL.createObjectURL(blob);
  const link = Object.assign(doc.createElement("a"), { href: url, download: name });
  doc.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** True when the device can hand image files to other apps (e.g. the Strava app on a phone). */
export function canShareFiles(nav = globalThis.navigator) {
  try {
    const probe = new File([new Uint8Array(1)], "probe.png", { type: "image/png" });
    return Boolean(nav?.canShare?.({ files: [probe] }));
  } catch {
    return false;
  }
}
