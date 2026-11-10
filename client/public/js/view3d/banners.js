/**
 * Words over the road: the names on the arches, and banners counting down the
 * last kilometre of a climb and marking halfway round a loop. The texts are
 * the same in every language (numbers, units, "KOM", the brand), so the world
 * stays one world for everyone. See docs/superpowers/specs/2026-11-10-banners-design.md.
 */
import { add, normalize, scale } from "./math.js";
import { pixelText, textWidth } from "./pixelFont.js";
import { temperate } from "./biomes/index.js";
import { roadFrame, roadHalfWidth } from "./world.js";

/** What each arch says, by marker type. */
export const ARCH_TEXT = Object.freeze({ start_finish: "OPENRADLR", climb: "KOM", sprint: "SPRINT" });

export const BANNERS = Object.freeze({
  text: Object.freeze({ halfway: "1/2", climb1000: "1 KM ^", climb500: "500 M ^" }),
  /** Loops at least this long get a halfway banner. */
  halfwayFromM: 3000,
  /** A countdown banner needs this much climb below it. */
  climbBelowM: 150,
  /** No banner this close to an arch. */
  clearOfArchM: 60,
  /** Banner cloth: bottom edge and height (metres over the road); lemon yellow for halfway. */
  bottom: 4.1,
  height: 0.95,
  halfway: [1.0, 0.82, 0.1],
});

const INK = Object.freeze({ light: [1, 1, 1], dark: [0.12, 0.12, 0.14] });

/**
 * Where banners hang on a route: `{distance, kind, text}` in riding order —
 * "climb" 1 km and 500 m before each climb's top where the climb is long
 * enough, "halfway" round a loop.
 */
export function bannerSpots(route) {
  const spots = [];
  for (const marker of route.markers) {
    if (marker.type !== "climb") continue;
    const top = marker.distance + (marker.length ?? 0);
    for (const [before, text] of [
      [1000, BANNERS.text.climb1000],
      [500, BANNERS.text.climb500],
    ]) {
      if ((marker.length ?? 0) >= before + BANNERS.climbBelowM) spots.push({ distance: top - before, kind: "climb", text });
    }
  }
  if (route.loop && route.length >= BANNERS.halfwayFromM) spots.push({ distance: route.length / 2, kind: "halfway", text: BANNERS.text.halfway });
  const arches = route.markers.map((m) => m.distance);
  const clear = (d) => arches.every((a) => Math.abs(route.loop ? route.signedGap(a, d) : d - a) >= BANNERS.clearOfArchM);
  return spots.filter((s) => clear(s.distance)).sort((a, b) => a.distance - b.distance);
}

/**
 * Letters `text` on both faces of a beam or banner across the road: the face
 * towards riders coming reads left to right for them, and so does the back.
 * @param {{center: number[], right: number[], forward: number[], width: number, height: number, depth: number}} beam
 */
export function letterBeam(mesh, beam, text, color) {
  const pixel = Math.min(beam.height * 0.11, (beam.width * 0.88) / (textWidth(text, 1) || 1));
  for (const side of [-1, 1]) {
    const facing = scale(beam.forward, side);
    pixelText(mesh, text, {
      origin: add(beam.center, scale(beam.forward, side * (beam.depth / 2 + 0.015))),
      right: scale(beam.right, -side),
      up: [0, 1, 0],
      facing,
      pixel,
      color,
    });
  }
}

/** The road's frame at `distance` with its level forward direction. */
function levelFrame(route, distance) {
  const frame = roadFrame(route, distance);
  return { ...frame, level: normalize([frame.forward[0], 0, frame.forward[2]]) };
}

/** Banners on two thin posts over the road at every spot of `bannerSpots`. */
export function buildBanners(mesh, route, { biome = temperate } = {}) {
  const posts = biome.arch.post;
  const halfWidth = roadHalfWidth(route.lanes) + 0.6;
  for (const spot of bannerSpots(route)) {
    const frame = levelFrame(route, spot.distance);
    const top = BANNERS.bottom + BANNERS.height;
    for (const side of [-1, 1]) {
      const foot = add(frame.center, scale(frame.right, side * halfWidth));
      mesh.orientedBox(add(foot, [0, top / 2, 0]), scale(frame.right, 0.14), [0, top, 0], scale(frame.level, 0.14), posts);
    }
    const color = spot.kind === "halfway" ? BANNERS.halfway : biome.arch.climb;
    const beam = { center: add(frame.center, [0, BANNERS.bottom + BANNERS.height / 2, 0]), right: frame.right, forward: frame.level, width: 2 * halfWidth, height: BANNERS.height, depth: 0.06 };
    mesh.orientedBox(beam.center, scale(frame.right, beam.width), [0, beam.height, 0], scale(frame.level, beam.depth), color);
    letterBeam(mesh, beam, spot.text, spot.kind === "halfway" ? INK.dark : INK.light);
  }
}

/** The name on an arch's beam (see `ARCH_TEXT`), white on its colour. */
export function letterArch(mesh, route, marker, { height, halfWidth, depth }) {
  const text = ARCH_TEXT[marker.type];
  if (!text) return;
  const frame = levelFrame(route, marker.distance);
  letterBeam(mesh, { center: add(frame.center, [0, height, 0]), right: frame.right, forward: frame.level, width: 2 * halfWidth, height: 1.0, depth }, text, INK.light);
}
