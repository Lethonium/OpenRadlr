/**
 * The arches over the road at the start/finish line, climbs and sprints, and the banners counting down climbs and
 * marking halfway. An arch is two round posts and a beam; a banner two thin posts and a cloth. The words are painted
 * into a texture (textTexture.js) and shown on both faces, reading left to right for riders coming from either side.
 * Spans x = ±halfWidth and faces ±z; the layer turns it to the road. Colours are linear RGB.
 */
import * as THREE from "../../../three.js";
import { createOwner } from "../owner.js";
import { addHook, cloudShadows, heightFog } from "../materials.js";
import { box, cylinder, merge } from "../geom.js";
import { textTexture } from "../textTexture.js";

/** The beam of an arch: how tall and deep, and how far it overhangs the posts on each side. */
const BEAM = Object.freeze({ height: 1.2, depth: 0.5, overhang: 0.5 });
/** An arch's posts: radius at the top and at the foot. */
const POST = Object.freeze({ top: 0.4, foot: 0.5 });
/** A banner's thin posts (radius), cloth height and depth. */
const CLOTH = Object.freeze({ post: 0.07, height: 0.95, depth: 0.06 });
/** Texture width in texels; the height follows the face's proportions. */
const TEXTURE_WIDTH = 512;
/** Squares in the start/finish line's chequered strip under the beam. */
const CHEQUERS = 12;
/** How far the lettering floats in front of the face (metres). */
const LIFT = 0.012;

const linear = ([r, g, b]) => new THREE.Color().setRGB(r, g, b);
/** A linear colour as sRGB 0–1, the space the texture is written in. */
const srgb = (rgb) => {
  const out = { r: 0, g: 0, b: 0 };
  linear(rgb).getRGB(out, THREE.SRGBColorSpace);
  return [out.r, out.g, out.b];
};

export const meta = Object.freeze({
  id: "route-arch",
  name: "Route arch", // i18n-ok
  category: "props", // i18n-ok
  description: "An arch over the road for the start/finish line, climbs and sprints, or a banner: posts, a beam and the words on both faces.", // i18n-ok
  options: Object.freeze({
    kind: Object.freeze({ type: "select", values: ["start_finish", "climb", "sprint", "halfway"], default: "start_finish" }),
    text: Object.freeze({ type: "text", default: "OPENRADLR" }),
  }),
});

const DEFAULT_COLORS = Object.freeze({
  post: [0.85, 0.85, 0.85],
  beam: { start_finish: [0.11, 0.17, 0.27], climb: [0.78, 0.22, 0.18], sprint: [0.18, 0.54, 0.31], halfway: [1.0, 0.82, 0.1] },
  chequer: [[0.95, 0.95, 0.95], [0.1, 0.1, 0.1]],
});

/**
 * @param {{kind?: string, text?: string, halfWidth?: number, height?: number, banner?: boolean,
 *   colors?: {post: number[], beam: number[], ink: number[], chequer?: number[][]}, own?: Function, track?: Function, uniforms?: object}} [options]
 *   `height` is the beam's centre over the road (arch) or the cloth's top (banner); `own` registers resources (else `track` makes one)
 * @returns {import("../../../three.js").Group}
 */
export function createRouteArch(options = {}) {
  const { kind = "start_finish", text = "OPENRADLR", halfWidth = 6.2, banner = false, uniforms } = options;
  const height = options.height ?? (banner ? 5.05 : 5.2);
  const colors = options.colors ?? { post: DEFAULT_COLORS.post, beam: DEFAULT_COLORS.beam[kind] ?? DEFAULT_COLORS.beam.climb, ink: [1, 1, 1], chequer: DEFAULT_COLORS.chequer };
  const own = options.own ?? ((resource) => resource);
  const post = linear(colors.post);
  const beam = linear(colors.beam);

  const parts = [];
  let face;
  if (banner) {
    const top = height;
    for (const side of [-1, 1]) parts.push(cylinder(CLOTH.post, CLOTH.post, top, 6, post, side * halfWidth, top / 2, 0));
    parts.push(box(2 * halfWidth, CLOTH.height, CLOTH.depth, beam, 0, top - CLOTH.height / 2, 0));
    face = { width: 2 * halfWidth, height: CLOTH.height, depth: CLOTH.depth, y: top - CLOTH.height / 2 };
  } else {
    const reach = height + BEAM.height / 2;
    for (const side of [-1, 1]) parts.push(cylinder(POST.top, POST.foot, reach, 12, post, side * halfWidth, reach / 2, 0));
    const width = 2 * halfWidth + 2 * BEAM.overhang;
    parts.push(box(width, BEAM.height, BEAM.depth, beam, 0, height, 0));
    face = { width, height: BEAM.height, depth: BEAM.depth, y: height };
    if (kind === "start_finish") {
      const squares = colors.chequer ?? DEFAULT_COLORS.chequer;
      const step = (width - 0.4) / CHEQUERS;
      for (let i = 0; i < CHEQUERS; i += 1) parts.push(box(step, 0.02, BEAM.depth, linear(squares[i % 2]), -width / 2 + 0.2 + (i + 0.5) * step, height - BEAM.height / 2 - 0.005, 0));
    }
  }

  const hook = (material) => (uniforms ? addHook(addHook(material, cloudShadows(uniforms)), heightFog(uniforms)) : material);
  const solid = new THREE.Mesh(own(merge(parts)), hook(own(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55 }))));
  solid.castShadow = true;
  const group = new THREE.Group();
  group.name = `route-${banner ? "banner" : "arch"}`;
  group.add(solid);

  const map = textTexture(text, { background: srgb(colors.beam), ink: srgb(colors.ink), width: TEXTURE_WIDTH, height: Math.max(16, Math.round((TEXTURE_WIDTH * face.height) / face.width)) }, own);
  const lettering = hook(own(new THREE.MeshStandardMaterial({ map, roughness: 0.6 })));
  const plane = own(new THREE.PlaneGeometry(face.width, face.height));
  for (const side of [1, -1]) {
    const letters = new THREE.Mesh(plane, lettering);
    letters.position.set(0, face.y, side * (face.depth / 2 + LIFT));
    if (side < 0) letters.rotation.y = Math.PI;
    group.add(letters);
  }
  return group;
}

/** Workbench entry: the arch with the biome's usual colours. */
export function create({ track, uniforms, kind, text } = {}) {
  const owner = createOwner(track);
  const object = createRouteArch({ kind, text, own: owner.own, uniforms });
  return { object, update() {}, dispose: () => owner.disposeAll() };
}
