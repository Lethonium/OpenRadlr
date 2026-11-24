/**
 * Paints a rider's kit (skin, jersey and its pattern, shorts, socks, shoes, gloves, hair and face) into one square
 * texture, as bytes: a tiny rectangle / polygon / ellipse rasteriser on a `Uint8Array`, no canvas, so node can build
 * every rider. The atlas has one region per body part (`KIT_ATLAS`); the rig's UVs point into them.
 */
import * as THREE from "../../../three.js";

/** Atlas regions `[u0, u1, v0, v1]` of the body parts, v = 0 at the bottom of the texture. */
export const KIT_ATLAS = Object.freeze({
  torso: Object.freeze([0, 0.5, 0, 0.5]),
  arm: Object.freeze([0.5, 0.75, 0, 0.5]),
  leg: Object.freeze([0.75, 1, 0, 0.5]),
  head: Object.freeze([0, 0.25, 0.5, 1]),
  hand: Object.freeze([0.25, 0.375, 0.5, 0.75]),
  foot: Object.freeze([0.375, 0.5, 0.5, 0.75]),
});

/**
 * Skin tones, sRGB hex. The same table as `RIDER_SKINS` in `view3d/riderLook.js` (assets may not import from there;
 * a test keeps the two equal).
 */
export const SKIN_TONES = Object.freeze({
  light: "#f3d2b8",
  fair: "#eac3a0",
  tan: "#cf9f78",
  olive: "#b88660",
  brown: "#8d5a3c",
  dark: "#5e3b28",
});

/** The side the reference painted at, so its pixel-sized details (eyes, dots) scale with the texture. */
const REFERENCE_SIZE = 512;
/** Where the jersey ends and the bib shorts begin, as a fraction of the torso region's height. */
const HEM = 0.06;
/** Sleeve and trouser lengths by kit, as a fraction of the arm or leg region. */
const SLEEVE = Object.freeze({ road: 0.32, long: 1, skinsuit: 0.36, casual: 0.24 });
const TROUSER = Object.freeze({ road: 0.29, long: 1, skinsuit: 0.3, casual: 0.24 });
/** Sub-samples per axis when covering a pixel with a polygon or an ellipse. */
const SAMPLES = 3;

const WHITE = "#f4f1ea";
const WHITE_SHOE = "#f2f2ee";
const BLACK_SOLE = "#1c1c1e";
const IRIS = "#2a2420";

/** `#rrggbb` as `[r, g, b]` bytes. */
const bytes = (hex) => {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
};

/**
 * A square RGBA surface with fractional coverage: shapes blend by how much of each pixel they cover.
 * @param {number} size
 */
function createSurface(size) {
  const pixels = new Uint8Array(size * size * 4);
  const scale = size / REFERENCE_SIZE;

  /** Blends `colour` over one pixel with strength `amount` (0..1). */
  const blend = (x, y, colour, amount) => {
    if (x < 0 || y < 0 || x >= size || y >= size || amount <= 0) return;
    const at = (y * size + x) * 4;
    for (let c = 0; c < 3; c += 1) pixels[at + c] = Math.round(pixels[at + c] * (1 - amount) + colour[c] * amount);
    pixels[at + 3] = 255;
  };

  /** A rectangle in pixels (fractional edges allowed). */
  const rectPixels = (x0, y0, x1, y1, colour, alpha = 1) => {
    for (let y = Math.max(0, Math.floor(y0)); y < Math.min(size, Math.ceil(y1)); y += 1) {
      const rows = Math.min(y + 1, y1) - Math.max(y, y0);
      for (let x = Math.max(0, Math.floor(x0)); x < Math.min(size, Math.ceil(x1)); x += 1) {
        const columns = Math.min(x + 1, x1) - Math.max(x, x0);
        blend(x, y, colour, alpha * rows * columns);
      }
    }
  };

  /** Any shape given as an inside test on pixel coordinates, over its pixel bounds. */
  const shape = (bounds, inside, colourAt, alpha = 1) => {
    const [x0, y0, x1, y1] = bounds;
    for (let y = Math.max(0, Math.floor(y0)); y < Math.min(size, Math.ceil(y1)); y += 1) {
      for (let x = Math.max(0, Math.floor(x0)); x < Math.min(size, Math.ceil(x1)); x += 1) {
        let hits = 0;
        for (let j = 0; j < SAMPLES; j += 1) {
          for (let i = 0; i < SAMPLES; i += 1) if (inside(x + (i + 0.5) / SAMPLES, y + (j + 0.5) / SAMPLES)) hits += 1;
        }
        if (hits) blend(x, y, colourAt(x, y), (alpha * hits) / (SAMPLES * SAMPLES));
      }
    }
  };

  /** Pixel of the point (u, v) inside `region`; v counts up, rows count down. */
  const pointIn = (region, u, v) => [(region[0] + (region[1] - region[0]) * u) * size, (1 - (region[2] + (region[3] - region[2]) * v)) * size];

  return {
    pixels,
    scale,
    pointIn,
    /** A rectangle given as fractions (u0..u1, v0..v1) of an atlas region. */
    rect(region, u0, u1, v0, v1, hex, alpha = 1) {
      const [x0, y1] = pointIn(region, u0, v0);
      const [x1, y0] = pointIn(region, u1, v1);
      rectPixels(x0, y0, x1, y1, bytes(hex), alpha);
    },
    rectPixels: (x, y, width, height, hex, alpha = 1) => rectPixels(x, y, x + width, y + height, bytes(hex), alpha),
    /** A polygon given as (u, v) fractions of an atlas region. */
    polygon(region, points, hex) {
      const corners = points.map(([u, v]) => pointIn(region, u, v));
      const xs = corners.map((corner) => corner[0]);
      const ys = corners.map((corner) => corner[1]);
      const colour = bytes(hex);
      const inside = (px, py) => {
        let within = false;
        for (let i = 0, j = corners.length - 1; i < corners.length; j = i, i += 1) {
          const [xi, yi] = corners[i];
          const [xj, yj] = corners[j];
          if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) within = !within;
        }
        return within;
      };
      shape([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)], inside, () => colour);
    },
    /** An ellipse around a pixel centre. */
    ellipse(cx, cy, rx, ry, hex) {
      const colour = bytes(hex);
      shape([cx - rx, cy - ry, cx + rx, cy + ry], (px, py) => ((px - cx) / rx) ** 2 + ((py - cy) / ry) ** 2 <= 1, () => colour);
    },
    /** A rectangle in pixels fading top to bottom between two colours. */
    verticalGradient(x0, y0, x1, y1, topHex, bottomHex) {
      const top = bytes(topHex);
      const bottom = bytes(bottomHex);
      const at = (y) => {
        const t = Math.min(1, Math.max(0, (y + 0.5 - y0) / (y1 - y0)));
        return top.map((channel, c) => Math.round(channel + (bottom[c] - channel) * t));
      };
      for (let y = Math.max(0, Math.floor(y0)); y < Math.min(size, Math.ceil(y1)); y += 1) rectPixels(x0, y, x1, y + 1, at(y), 1);
    },
  };
}

/**
 * Paints the whole atlas for a rider.
 * @param {import("../../riderLook.js").RiderLook} look
 * @param {number} [size] edge of the square texture in pixels
 * @returns {Uint8Array} RGBA bytes, row 0 is the top of the texture (v = 1), as a canvas would hold it
 */
export function paintKit(look, size = 256) {
  const s = createSurface(size);
  const { torso, arm, leg, hand, foot } = KIT_ATLAS;
  const skin = SKIN_TONES[look.skin] ?? look.skin;
  const { kit, pattern, primary, secondary, accent } = look;
  s.rectPixels(0, 0, size, size, skin);

  // torso: shorts or bib below the hem, jersey above
  s.rect(torso, 0, 1, 0, 1, kit === "skinsuit" ? primary : look.shorts);
  s.rect(torso, 0, 1, HEM, 1, primary);
  paintPattern(s, pattern, look);
  s.rect(torso, 0, 1, 0.965, 1, accent); // collar
  s.rect(torso, 0.247, 0.253, HEM, 0.97, "#141418", 0.55); // zip
  s.rect(torso, 0, 1, HEM - 0.012, HEM + 0.006, accent); // hem gripper

  // arms: sleeves
  const sleeve = SLEEVE[kit];
  s.rect(arm, 0, 1, 0, sleeve, pattern === "panels" ? secondary : primary);
  s.rect(arm, 0, 1, sleeve - 0.035, sleeve, kit === "long" ? accent : secondary);
  if (pattern === "hoops" && kit === "long") for (let v = 0.2; v < 0.9; v += 0.2) s.rect(arm, 0, 1, v, v + 0.05, secondary);

  // legs: shorts or tights, gripper, socks
  const trouser = TROUSER[kit];
  s.rect(leg, 0, 1, 0, trouser, kit === "skinsuit" ? primary : look.shorts);
  if (kit !== "long") s.rect(leg, 0, 1, trouser - 0.022, trouser, kit === "skinsuit" ? secondary : accent);
  if (kit === "skinsuit" || pattern === "panels") s.rect(leg, 0.45, 0.55, 0, trouser - 0.025, secondary);
  if (kit !== "long") {
    s.rect(leg, 0, 1, 0.86, 1, look.socks);
    s.rect(leg, 0, 1, 0.9, 0.92, secondary);
  } else s.rect(leg, 0, 1, 0.96, 1, look.socks);

  // hands: gloves
  if (look.gloves) {
    s.rect(hand, 0, 1, 0, kit === "long" ? 1 : 0.62, look.gloveColor);
    if (kit !== "long") s.rect(hand, 0, 1, 0.58, 0.62, accent);
  }

  // shoes
  s.rect(foot, 0, 1, 0, 1, look.shoes);
  s.rect(foot, 0.12, 0.38, 0, 1, kit === "casual" ? WHITE_SHOE : BLACK_SOLE);
  s.rect(foot, 0.7, 0.8, 0.3, 0.42, accent);
  s.rect(foot, 0, 1, 0, 0.16, accent);

  paintFace(s, look.hair);
  return s.pixels;
}

/** The jersey pattern over the torso region. */
function paintPattern(s, pattern, look) {
  const { torso } = KIT_ATLAS;
  const { primary, secondary, accent } = look;
  if (pattern === "hoops") for (let v = 0.3; v < 0.9; v += 0.13) s.rect(torso, 0, 1, v, v + 0.055, secondary);
  if (pattern === "band") {
    s.rect(torso, 0, 1, 0.52, 0.7, secondary);
    s.rect(torso, 0, 1, 0.5, 0.515, accent);
    s.rect(torso, 0, 1, 0.705, 0.72, accent);
  }
  if (pattern === "sash") {
    for (const u0 of [0, 0.5]) {
      s.polygon(torso, [[u0 + 0.02, 0.96], [u0 + 0.14, 0.96], [u0 + 0.48, 0.22], [u0 + 0.36, 0.22]], secondary);
    }
  }
  if (pattern === "panels") {
    for (const [u0, u1] of [[0.42, 0.58], [0, 0.08], [0.92, 1]]) s.rect(torso, u0, u1, HEM, 1, secondary);
    for (const [u0, u1] of [[0.41, 0.42], [0.58, 0.59]]) s.rect(torso, u0, u1, HEM, 1, accent);
  }
  if (pattern === "chevron") {
    for (const [hex, d] of [[secondary, 0], [accent, 0.07]]) {
      s.polygon(torso, [[0.06, 0.88 - d], [0.25, 0.58 - d], [0.44, 0.88 - d], [0.44, 0.8 - d], [0.25, 0.5 - d], [0.06, 0.8 - d]], hex);
    }
  }
  if (pattern === "dots") {
    for (let v = HEM + 0.06; v < 0.95; v += 0.085) {
      for (let u = 0; u < 1; u += 0.06) {
        const [x, y] = s.pointIn(torso, u + (Math.round(v * 100) % 2 ? 0.03 : 0), v);
        s.ellipse(x, y, 4.2 * s.scale, 4.2 * s.scale, secondary);
      }
    }
  }
  if (pattern === "fade") {
    const [, top] = s.pointIn(torso, 0, 1);
    const [, bottom] = s.pointIn(torso, 0, HEM);
    s.verticalGradient(0, top, s.pointIn(torso, 1, 0)[0], bottom, primary, secondary);
  }
}

/** Hair, eyes, brows and lips on the head region. */
function paintFace(s, hair) {
  const { head } = KIT_ATLAS;
  s.rect(head, 0.45, 1, 0.62, 1, hair);
  s.rect(head, 0, 0.05, 0.62, 1, hair);
  s.rect(head, 0, 1, 0.9, 1, hair);
  const k = s.scale;
  for (const du of [-0.035, 0.035]) {
    const [x, y] = s.pointIn(head, 0.25 + du, 0.54);
    s.ellipse(x, y, 2.6 * k, 1.7 * k, WHITE);
    s.ellipse(x, y, 1.3 * k, 1.3 * k, IRIS);
    s.rectPixels(x - 3 * k, y - 5 * k, 6 * k, 1.4 * k, hair);
  }
  const [x, y] = s.pointIn(head, 0.25, 0.3);
  s.rectPixels(x - 3 * k, y, 6 * k, 1.3 * k, "#96463c", 0.6);
}

/**
 * The kit as a sRGB texture (the bytes flipped so v = 0 is the first row, as an uploaded texture wants).
 * @param {import("../../riderLook.js").RiderLook} look
 * @param {<T>(resource: T) => T} own registers the texture
 * @param {number} [size]
 * @returns {import("../../../three.js").DataTexture}
 */
export function kitTexture(look, own, size = 256) {
  const painted = paintKit(look, size);
  const flipped = new Uint8Array(painted.length);
  const row = size * 4;
  for (let y = 0; y < size; y += 1) flipped.set(painted.subarray(y * row, (y + 1) * row), (size - 1 - y) * row);
  const texture = own(new THREE.DataTexture(flipped, size, size, THREE.RGBAFormat));
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}
