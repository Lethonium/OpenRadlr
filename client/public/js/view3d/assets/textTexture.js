/**
 * Words painted into a texture from the pixel font (no canvas: assets stay free of the document), for the beams of
 * the route arches and banners. Written as sRGB bytes into a `DataTexture`; the glyphs are `pixelFont.js`'s.
 */
import * as THREE from "../../three.js";
import { COLS, GLYPHS, ROWS } from "./pixelFont.js";

/** How much of the width, and of the height, the text may fill. */
const FILL = 0.9;

/** A linear RGB colour as sRGB 0-1, the space `textTexture` is written in. */
export function toSrgb([r, g, b]) {
  const out = { r: 0, g: 0, b: 0 };
  new THREE.Color().setRGB(r, g, b).getRGB(out, THREE.SRGBColorSpace);
  return [out.r, out.g, out.b];
}

const bytes = (rgb) => rgb.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255));

/**
 * `text` centred on a `background` field in `ink` (sRGB 0–1 colours), scaled to fit 90 % of the width (and height).
 * Lowercase reads as uppercase, accents fold to their base letter, characters the font lacks as a space.
 * @param {string} text
 * @param {{background: number[], ink: number[], width: number, height: number}} look
 * @param {<T>(resource: T) => T} own registers the texture for disposal
 * @returns {import("../../three.js").DataTexture}
 */
export function textTexture(text, { background, ink, width, height }, own) {
  const chars = [...text.normalize("NFD").replace(/\p{M}/gu, "").toUpperCase()].map((char) => GLYPHS[char] ?? GLYPHS[" "]);
  const columns = Math.max(1, chars.length * (COLS + 1) - 1);
  const cell = Math.min((width * FILL) / columns, (height * FILL) / ROWS);
  const left = (width - columns * cell) / 2;
  const top = (height - ROWS * cell) / 2;
  const [bg, fg] = [bytes(background), bytes(ink)];
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    // Texture rows run bottom to top; glyph rows top to bottom.
    const row = Math.floor((height - 1 - y + 0.5 - top) / cell);
    for (let x = 0; x < width; x += 1) {
      const column = Math.floor((x + 0.5 - left) / cell);
      const char = chars[Math.floor(column / (COLS + 1))];
      const inside = row >= 0 && row < ROWS && column >= 0 && column < columns && column % (COLS + 1) < COLS;
      const lit = inside && char[row][column % (COLS + 1)] === "#";
      data.set(lit ? fg : bg, (y * width + x) * 4);
      data[(y * width + x) * 4 + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return own(texture);
}
