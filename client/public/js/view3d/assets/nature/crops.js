/**
 * Farm crop fields that follow the season. A field is one draped rectangle
 * (a few hundred vertices): rows, tramlines and wind waves are drawn in the
 * shader. Pumpkins and round bales lie on top as instances. Restyled from
 * the reference's `crop-field.js`, `pumpkin.js` and `hay-bale.js`.
 */
import * as THREE from "../../../three.js";
import { addHook, cloudShadows } from "../materials.js";
import { CROP_COLOR, CROP_FRAGMENT_HEAD, CROP_VERTEX, CROP_VERTEX_HEAD } from "./cropShader.js";
import { colour, cylinder, deepFreeze, ico, merge } from "./geom.js";

/**
 * h crop height (m), a main colour, b row colour, period row spacing (m), stripe row contrast,
 * speck blossoms or heads over the canopy, tram tractor tramlines, sway wind waves, furrow
 * shaded furrows, walls the field has crop walls at its edge, side the colour of those walls.
 */
export const CROPS = deepFreeze({
  rapeseed: { h: 1.15, a: "#efd22e", b: "#9fb84a", period: 0.45, stripe: 0.16, speck: 0.35, side: "#7d9a3c", tram: 0.55, sway: 0.8, walls: true },
  wheat: { h: 0.95, a: "#dcb860", b: "#bf9340", period: 0.22, stripe: 0.2, side: "#a8843a", tram: 0.6, sway: 1, walls: true },
  sunflower: { h: 1.8, a: "#f0b51f", b: "#4f7a2e", period: 0.7, stripe: 0.4, speck: 0.55, specky: "#5a3a1c", side: "#557f30", sway: 0.35, walls: true },
  corn: { h: 2.1, a: "#7ea03c", b: "#58802c", period: 0.75, stripe: 0.45, side: "#5b8a30", sway: 0.45, walls: true },
  stubble: { h: 0.06, a: "#d9c38a", b: "#a38a55", period: 6.0, stripe: 0.5 },
  ploughed: { h: 0.1, a: "#4c3524", b: "#7a5a40", period: 0.9, stripe: 0.9, furrow: 1 },
  pumpkin: { h: 0.1, a: "#5a4230", b: "#61803a", period: 1.6, stripe: 0.7, furrow: 1 },
  lavender: { h: 0.55, a: "#8a63b8", b: "#6f8a5a", period: 0.9, stripe: 0.75, speck: 0.2, specky: "#b79ad6", side: "#6f8a5a", sway: 0.3 },
});

/**
 * The shader material of one crop.
 * @param {string} crop id from CROPS
 * @param {ReturnType<typeof import("../materials.js").createSharedUniforms>} uniforms
 * @returns {import("../../../three.js").MeshStandardMaterial}
 */
export function cropMaterial(crop, uniforms) {
  const p = CROPS[crop];
  const material = new THREE.MeshStandardMaterial({ roughness: p.h > 0.5 ? 1 : 0.96, side: THREE.DoubleSide });
  const own = {
    uA: { value: colour(p.a) },
    uB: { value: colour(p.b) },
    uSide: { value: colour(p.side ?? p.b) },
    uSpeckC: { value: colour(p.specky ?? p.b) },
    uPeriod: { value: p.period },
    uStripe: { value: p.stripe },
    uSpeck: { value: p.speck ?? 0 },
    uTram: { value: p.tram ?? 0 },
    uSway: { value: p.sway ?? 0 },
    uFurrow: { value: p.furrow ?? 0 },
  };
  const hook = (shader) => {
    Object.assign(shader.uniforms, own, { uTime: uniforms.time, uWind: uniforms.wind });
    shader.vertexShader = CROP_VERTEX_HEAD + shader.vertexShader.replace("#include <begin_vertex>", CROP_VERTEX); // i18n-ok
    shader.fragmentShader = CROP_FRAGMENT_HEAD + shader.fragmentShader.replace("#include <color_fragment>", CROP_COLOR); // i18n-ok
  };
  addHook(material, Object.assign(hook, { key: `crop${crop}` }));
  return addHook(material, cloudShadows(uniforms));
}

/** The world position of a point (lx, lz) of a field centred at (x, z) and turned by `yaw`. */
const toWorld = ({ x, z, yaw }) => {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return (lx, lz) => [x + lx * c - lz * s, z + lx * s + lz * c];
};

/** Share of the crop's height the ground-level edge of a field with plants keeps: the plants stand there, not a wall. */
const EDGE_DIP = 0.22;

/**
 * The coordinates of one axis of the field grid: every `step` metres, with a line at `band` and at half of it from
 * both ends, so the dipped edge has vertices where it ramps.
 */
function axis(length, step, band) {
  const n = Math.max(2, Math.ceil(length / step));
  const list = Array.from({ length: n + 1 }, (_, i) => -length / 2 + (i * length) / n);
  if (band > 0 && band < length / 2 - 0.5) {
    for (const edge of [0.5, 1]) list.push(-length / 2 + band * edge, length / 2 - band * edge);
  }
  const sorted = list.sort((a, b) => a - b);
  return sorted.filter((v, i) => i === 0 || v - sorted[i - 1] > 0.4);
}

/**
 * A field rectangle draped over the ground.
 * @param {{width: number, depth: number, x?: number, z?: number, yaw?: number, crop: string, heightAt?: (x: number, z: number) => number, step?: number, edgeBand?: number}} field
 *   `width` runs along `yaw`; `heightAt` is the ground height in world space; `edgeBand` metres along the edges
 *   where individual plants stand: the canopy dips there, so they are not hidden behind a wall
 * @returns {import("../../../three.js").BufferGeometry} non-indexed with an `aF` attribute (row coordinate, along, wall)
 */
export function fieldGeometry({ width: w, depth: d, x = 0, z = 0, yaw = 0, crop, heightAt = () => 0, step = 4, edgeBand = 0 }) {
  const p = CROPS[crop];
  const tall = Boolean(p.walls);
  const xs = axis(w, step, edgeBand);
  const zs = axis(d, step, edgeBand);
  const [nx, nz] = [xs.length - 1, zs.length - 1];
  const world = toWorld({ x, z, yaw });
  const pos = [];
  const nrm = [];
  const af = [];
  const idx = [];
  const lift = tall ? p.h : p.h + 0.05;
  const top = (lx, lz) => {
    const [px, pz] = world(lx, lz);
    const g = heightAt(px, pz);
    const bump = tall ? (Math.sin(px * 0.21 + pz * 0.13) * 0.5 + Math.sin(px * 0.07 - pz * 0.17) * 0.5) * 0.07 * p.h : 0;
    const e = 1.2;
    const nxs = heightAt(px - e, pz) - heightAt(px + e, pz);
    const nzs = heightAt(px, pz - e) - heightAt(px, pz + e);
    const l = Math.hypot(nxs, 2 * e, nzs);
    const inside = edgeBand > 0 ? Math.min(1, Math.min(w / 2 + lx, w / 2 - lx, d / 2 + lz, d / 2 - lz) / edgeBand) : 1;
    const dip = EDGE_DIP + (1 - EDGE_DIP) * inside * inside * (3 - 2 * inside);
    return { x: px, z: pz, y: g + lift * dip + bump * dip, g, n: [nxs / l, (2 * e) / l, nzs / l] };
  };
  for (let j = 0; j <= nz; j += 1) {
    for (let i = 0; i <= nx; i += 1) {
      const [lx, lz] = [xs[i], zs[j]];
      const t = top(lx, lz);
      pos.push(t.x, t.y, t.z);
      nrm.push(...t.n);
      af.push(lx, lz + d / 2, 1);
    }
  }
  for (let j = 0; j < nz; j += 1) {
    for (let i = 0; i < nx; i += 1) {
      const a = j * (nx + 1) + i;
      const b = a + nx + 1;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  if (tall) {
    const ring = [];
    for (let i = 0; i < nx; i += 1) ring.push([xs[i], -d / 2]);
    for (let j = 0; j < nz; j += 1) ring.push([w / 2, zs[j]]);
    for (let i = nx; i > 0; i -= 1) ring.push([xs[i], d / 2]);
    for (let j = nz; j > 0; j -= 1) ring.push([-w / 2, zs[j]]);
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    ring.forEach(([ax, az], k) => {
      const [bx, bz] = ring[(k + 1) % ring.length];
      const ta = top(ax, az);
      const tb = top(bx, bz);
      const o = pos.length / 3;
      const len = Math.hypot(bz - az, bx - ax) || 1;
      const ex = (bz - az) / len;
      const ez = -(bx - ax) / len;
      const wx = ex * c - ez * s;
      const wz = ex * s + ez * c;
      pos.push(ta.x, ta.g - 0.3, ta.z, tb.x, tb.g - 0.3, tb.z, ta.x, ta.y, ta.z, tb.x, tb.y, tb.z);
      for (let q = 0; q < 4; q += 1) nrm.push(wx, 0.25, wz);
      af.push(ax, az + d / 2, 0, bx, bz + d / 2, 0, ax, az + d / 2, 0.97, bx, bz + d / 2, 0.97);
      idx.push(o, o + 1, o + 2, o + 2, o + 1, o + 3);
    });
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3));
  geometry.setAttribute("aF", new THREE.Float32BufferAttribute(af, 3));
  geometry.setIndex(idx);
  const flat = geometry.toNonIndexed();
  geometry.dispose();
  return flat;
}

const PUMPKIN_COLOURS = Object.freeze(["#e8782a", "#f2c14a", "#d9d2b8"]);

/**
 * Things lying on a field, in world space: pumpkins on a pumpkin patch,
 * round bales on stubble.
 * @param {{width: number, depth: number, x?: number, z?: number, yaw?: number, crop: string, heightAt?: (x: number, z: number) => number, random: () => number}} field
 * @returns {{pumpkins: {x: number, y: number, z: number, s: number, sy: number, yaw: number, color: string}[], bales: {x: number, y: number, z: number, s: number, yaw: number}[]}}
 */
export function fieldExtras({ width: w, depth: d, x = 0, z = 0, yaw = 0, crop, heightAt = () => 0, random }) {
  const out = { pumpkins: [], bales: [] };
  const world = toWorld({ x, z, yaw });
  const range = (a, b) => a + random() * (b - a);
  if (crop === "pumpkin") {
    for (let lz = -d / 2 + 1; lz < d / 2 - 1; lz += CROPS.pumpkin.period) {
      for (let lx = -w / 2 + 1; lx < w / 2 - 1; lx += range(1.2, 3.4)) {
        if (random() < 0.35) continue;
        const [px, pz] = world(lx + range(-0.3, 0.3), lz + range(-0.2, 0.2));
        const sy = range(0.45, 0.75);
        const pick = random();
        out.pumpkins.push({ x: px, y: heightAt(px, pz) + 0.6 * sy - 0.06, z: pz, s: range(0.55, 1.15), sy, yaw: range(0, 6), color: PUMPKIN_COLOURS[pick < 0.85 ? 0 : pick < 0.93 ? 1 : 2] });
      }
    }
  }
  if (crop === "stubble") {
    const n = Math.floor((w * d) / 260);
    for (let k = 0; k < n; k += 1) {
      const [px, pz] = world(range(-w / 2 + 3, w / 2 - 3), range(-d / 2 + 3, d / 2 - 3));
      out.bales.push({ x: px, y: heightAt(px, pz) + 0.75, z: pz, s: range(0.95, 1.1), yaw: range(0, 6) });
    }
  }
  return out;
}

/** One pumpkin centred on the origin with its stalk, unit size (scale by `s`, `sy`; `fieldExtras` gives the height). */
export function pumpkinGeometry() {
  return merge([ico(0.6, 1, colour("#f28a1e")), cylinder(0.06, 0.08, 0.4, 4, colour("#3f6b2a"), 0, 0.7, 0)]);
}

/** One round bale lying on its side, centred on the origin raised by `lift` (0.8 stands it on the ground). */
export const baleGeometry = (segments = 12, lift = 0) => cylinder(0.8, 0.8, 1.6, segments, colour("#e2bd57")).rotateZ(Math.PI / 2).translate(0, lift, 0);
