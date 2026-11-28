/**
 * Paints poster pictures on a 2D canvas context: default (flat art + line), the rider's own upload and a goal board.
 * The canvas comes from an injected factory so the world code never touches the document in tests.
 */
import { t } from "../../i18n/i18n.js";
import { ATLAS_SLOTS } from "./choose.js";
import { POSTERS } from "./lines.js";
import { drawArt } from "./art.js";

const POSTER_BY_ID = new Map(POSTERS.map((poster) => [poster.id, poster]));
const KIND_STYLE = {
  general: { background: "#ffd23f", stripe: "#f2b705", ink: "#2b2118" },
  climb: { background: "#1b998b", stripe: "#157a6f", ink: "#ffffff" },
  lastKm: { background: "#f46036", stripe: "#c94a28", ink: "#ffffff" },
};
const GOAL = { background: "#22356f", stripe: "#1a2a5a", ink: "#ffffff" };
const UPLOAD_BAR = "#d62828";
const BAR_SHARE = 0.12;
const FONT_FAMILY = `system-ui, "Segoe UI", Roboto, sans-serif`; // i18n-ok
const FONT = (px) => `800 ${px}px ${FONT_FAMILY}`;
const MAX_LINES = 3;
const MIN_FONT = 6;

/** Greedy word wrap by measured width. */
function wrap(ctx, text, maxWidth) {
  const lines = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function ellipsize(ctx, line, maxWidth) {
  let text = line;
  while (text.length > 1 && ctx.measureText(`${text}…`).width > maxWidth) text = text.slice(0, -1);
  return `${text}…`;
}

/** The largest font (down to MIN_FONT) at which the text wraps into MAX_LINES lines within the box. */
function fitText(ctx, text, { width, height, maxFont }) {
  for (let px = maxFont; px >= MIN_FONT; px -= 2) {
    ctx.font = FONT(px);
    const lines = wrap(ctx, text, width);
    const widest = Math.max(...lines.map((line) => ctx.measureText(line).width));
    if (lines.length <= MAX_LINES && lines.length * px * 1.15 <= height && widest <= width) return { px, lines };
  }
  ctx.font = FONT(MIN_FONT);
  const lines = wrap(ctx, text, width).slice(0, MAX_LINES);
  return { px: MIN_FONT, lines: lines.map((line) => (ctx.measureText(line).width > width ? ellipsize(ctx, line, width) : line)) };
}

function drawText(ctx, text, box, color, align = "left") {
  if (!text) return;
  const { px, lines } = fitText(ctx, text, { ...box, maxFont: box.height * 0.5 });
  ctx.font = FONT(px);
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = "middle";
  const lineHeight = px * 1.15;
  const top = box.y + (box.height - lineHeight * lines.length) / 2 + lineHeight / 2;
  const x = align === "center" ? box.x + box.width / 2 : box.x;
  lines.forEach((line, i) => ctx.fillText(line, x, top + i * lineHeight));
}

function backdrop(ctx, style, width, height) {
  ctx.fillStyle = style.background;
  ctx.fillRect(0, 0, width, height);
  // a slanted stripe for the print-ad feel
  ctx.fillStyle = style.stripe;
  ctx.beginPath();
  ctx.moveTo(width * 0.3, 0);
  ctx.lineTo(width * 0.36, 0);
  ctx.lineTo(width * 0.3, height);
  ctx.lineTo(width * 0.24, height);
  ctx.closePath();
  ctx.fill();
}

function paintDefault(ctx, poster, { width, height }) {
  const entry = POSTER_BY_ID.get(poster.id);
  const style = KIND_STYLE[entry?.kind] ?? KIND_STYLE.general;
  backdrop(ctx, style, width, height);
  const art = Math.min(height * 0.82, width * 0.3);
  drawArt(ctx, entry?.art ?? "lemon", { x: width * 0.03, y: (height - art) / 2, size: art });
  drawText(ctx, t(`boards.line.${poster.id}`), { x: width * 0.38, y: height * 0.08, width: width * 0.58, height: height * 0.84 }, style.ink);
}

function paintGoal(ctx, poster, { width, height }) {
  backdrop(ctx, GOAL, width, height);
  const art = height * 0.34;
  drawArt(ctx, "lemon", { x: width * 0.03, y: height * 0.08, size: art });
  drawText(ctx, poster.text, { x: width * 0.08, y: height * 0.4, width: width * 0.84, height: height * 0.52 }, GOAL.ink);
}

function paintUpload(ctx, poster, { width, height }) {
  ctx.fillStyle = "#333";
  ctx.fillRect(0, 0, width, height);
  const image = poster.image;
  if (image) {
    // cover: the biggest centred 2:1 crop of the picture
    const iw = image.width || width;
    const ih = image.height || height;
    const ratio = width / height;
    const sw = iw / ih > ratio ? ih * ratio : iw;
    const sh = iw / ih > ratio ? ih : iw / ratio;
    ctx.drawImage(image, (iw - sw) / 2, (ih - sh) / 2, sw, sh, 0, 0, width, height);
  }
  const barHeight = height * BAR_SHARE;
  if (poster.text) {
    const band = height * 0.26;
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillRect(0, height - barHeight - band, width, band);
    drawText(ctx, poster.text, { x: width * 0.04, y: height - barHeight - band, width: width * 0.92, height: band }, "#ffffff", "center");
  }
  ctx.fillStyle = UPLOAD_BAR;
  ctx.fillRect(0, height - barHeight, width, barHeight);
  ctx.font = FONT(barHeight * 0.75);
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(t("boards.yourUpload"), width * 0.03, height - barHeight / 2);
}

/**
 * poster: { type: "default", id } | { type: "upload", image?, text? } | { type: "goal", text }.
 * Paints into the rectangle (0, 0, width, height) of ctx.
 */
export function paintPoster(ctx, poster, size) {
  ctx.save();
  if (poster.type === "upload") paintUpload(ctx, poster, size);
  else if (poster.type === "goal") paintGoal(ctx, poster, size);
  else paintDefault(ctx, poster, size);
  ctx.restore();
}

const COLUMNS = 2;
const ROWS = ATLAS_SLOTS / COLUMNS;

/** [u0, v0, u1, v1] of atlas slot i in the fixed 2 x 4 grid; row 0 is at the top, so v counts up from the bottom. */
export function slotUv(i) {
  const column = i % COLUMNS;
  const row = i >> 1;
  return [column / COLUMNS, 1 - (row + 1) / ROWS, (column + 1) / COLUMNS, 1 - row / ROWS];
}

/** Default canvas factory: OffscreenCanvas where there is one, else a <canvas> element. */
export function createCanvas(width, height) {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(width, height);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/**
 * Paint the chosen slots into one atlas canvas (2 columns, ATLAS_SLOTS cells). A slot is a poster as choosePosters
 * returns it; upload slots take their picture and text from uploadsById.
 */
export function paintAtlas(makeCanvas, slots, { slotWidth, slotHeight, uploadsById = new Map() }) {
  const canvas = makeCanvas(slotWidth * COLUMNS, slotHeight * ROWS);
  const ctx = canvas.getContext("2d");
  slots.forEach((slot, i) => {
    const poster = slot.type === "upload" ? { type: "upload", ...uploadsById.get(slot.id) } : slot;
    ctx.save();
    ctx.translate((i % COLUMNS) * slotWidth, (i >> 1) * slotHeight);
    ctx.beginPath();
    ctx.rect(0, 0, slotWidth, slotHeight);
    ctx.clip();
    paintPoster(ctx, poster, { width: slotWidth, height: slotHeight });
    ctx.restore();
  });
  return canvas;
}
