/**
 * The road's signs and the flamme rouge as vertex-coloured parts: the warning triangle and the village name board
 * on their posts (facing −Z, standing on y = 0) and the pennant over the road one kilometre before the finish
 * (spanning x = ±halfWidth, its face toward −Z). Each returns `{geometry, glow}`: the posts and frames, and the
 * painted faces, which glow a little at dusk and night (`createFaceMaterial`). The colours are the biome's palette.
 */
import * as THREE from "../../../three.js";
import { createOwner } from "../owner.js";
import { addHook } from "../materials.js";
import { box, merge, paint } from "../geom.js";

/** The colours the parts need; the biome's palette has all of them. */
export const SIGN_COLORS = Object.freeze({
  metal: [0.74, 0.76, 0.78],
  white: [0.95, 0.95, 0.95],
  red: [0.82, 0.16, 0.14],
  yellow: [0.96, 0.8, 0.18],
  black: [0.08, 0.08, 0.09],
});

const linear = ([r, g, b]) => new THREE.Color().setRGB(r, g, b);

/** A flat triangle painted `color`, facing −Z (corners given left to right as seen from there). */
function triangle(a, b, c, color) {
  const source = new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute([...a, ...c, ...b], 3));
  source.computeVertexNormals();
  return paint(source, color);
}

/** The warning sign: a post and a red, white and black triangle on it. */
export function warningSignParts(palette = SIGN_COLORS) {
  const c = (name) => linear(palette[name]);
  const triangleAt = (r, z, color) => triangle([-r, 2.1 - r * 0.6, z], [r, 2.1 - r * 0.6, z], [0, 2.1 + r * 1.1, z], color);
  return {
    geometry: merge([box(0.08, 2.2, 0.08, c("metal"), 0, 1.1, 0)]),
    glow: merge([triangleAt(0.55, -0.06, c("red")), triangleAt(0.38, -0.08, c("white")), triangle([-0.22, 2.0, -0.1], [0.22, 2.0, -0.1], [0.22, 2.22, -0.1], c("black"))]),
  };
}

/** The village name board: two posts and a yellow board with a black frame and name strip. */
export function villageSignParts(palette = SIGN_COLORS) {
  const c = (name) => linear(palette[name]);
  return {
    geometry: merge([-0.6, 0.6].map((x) => box(0.07, 1.8, 0.07, c("metal"), x, 0.9, 0))),
    glow: merge([box(1.6, 0.7, 0.05, c("black"), 0, 1.75, -0.05), box(1.48, 0.58, 0.03, c("yellow"), 0, 1.75, -0.08), box(1.0, 0.12, 0.02, c("black"), 0, 1.75, -0.1)]),
  };
}

/** The flamme rouge: white posts and a bar over the road, a red pennant hanging from it. */
export function flammeRougeParts(halfWidth, palette = SIGN_COLORS) {
  const c = (name) => linear(palette[name]);
  const posts = [-1, 1].map((side) => box(0.25, 5.2, 0.25, c("white"), side * halfWidth, 2.6, 0));
  posts.push(box(2 * halfWidth + 0.3, 0.3, 0.2, c("white"), 0, 5.3, 0));
  return { geometry: merge(posts), glow: merge([triangle([-1.4, 5.15, -0.12], [1.4, 5.15, -0.12], [0, 3.6, -0.12], c("red"))]) };
}

/**
 * The material of the painted faces: lit like the rest, plus an emissive share of their own vertex colour that the
 * layer raises with the night (`emissiveIntensity`).
 */
export function createFaceMaterial(own) {
  const material = own(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, emissive: new THREE.Color(1, 1, 1), emissiveIntensity: 0.05 }));
  const hook = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\n totalEmissiveRadiance *= vColor.rgb;");
  };
  return addHook(material, Object.assign(hook, { key: "faceglow" }));
}

const workbenchSign = (id, name, description, parts) => {
  const meta = Object.freeze({ id, name, category: "props", description, options: Object.freeze({}) }); // i18n-ok
  return Object.freeze({
    meta,
    create({ track } = {}) {
      const owner = createOwner(track);
      const { geometry, glow } = parts();
      const object = new THREE.Group();
      object.add(new THREE.Mesh(owner.own(geometry), owner.own(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 }))));
      object.add(new THREE.Mesh(owner.own(glow), createFaceMaterial(owner.own)));
      for (const mesh of object.children) mesh.castShadow = true;
      return { object, update() {}, dispose: () => owner.disposeAll() };
    },
  });
};

export const warningSign = workbenchSign("warning-sign", "Warning sign", "The triangular warning sign before and after each climb: a post with a red-bordered triangle.", warningSignParts); // i18n-ok
export const villageSign = workbenchSign("village-sign", "Village sign", "The yellow village name board on two posts, set at both ends of a village.", villageSignParts); // i18n-ok
