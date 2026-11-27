/**
 * The roadside bike cafés, one look per café of the valley map: "valley" (a plastered café with a glass front and a
 * striped awning), "hut" (a stone-and-timber mountain hut with a steep roof, a balcony and long tables), "hilltop" (a
 * glass pavilion with a cantilevered roof and a view terrace) and "beach" (a plank kiosk on a deck with straw
 * parasols, loungers, surfboards and string lights). The front, the terrace side, faces +z. Every style has a name
 * board (painted into a texture by textTexture.js) and a bike rack with three parked bikes baked into one mesh from
 * `createBike`. Ground at y = 0; the building's foot reaches below it so a slope never shows. Colours are sRGB hex
 * through `colour` (so linear in the vertices); nothing random but a fixed seed.
 */
import * as THREE from "../../../three.js";
import { mergeGeometries } from "../../../../vendor/three/addons/utils/BufferGeometryUtils.js";
import { seededRandom } from "../../../world/noise.js";
import { createOwner } from "../owner.js";
import { addHook, cloudShadows, createSharedUniforms, heightFog } from "../materials.js";
import { box, colour, cylinder, merge, paint, rod } from "../geom.js";
import { createFaceMaterial } from "../props/roadSigns.js";
import { createBike } from "../riders/bicycle.js";
import { textTexture, toSrgb } from "../textTexture.js";
import { gable } from "./shapes.js";

export const CAFE_STYLES = Object.freeze(["valley", "hut", "hilltop", "beach"]);

/** How the café's name board reads: texture width in texels, and the board's width-to-height ratio. */
const BOARD = Object.freeze({ texels: 512, ratio: 5 });
const BOARD_INK = Object.freeze([0.96, 0.94, 0.88]);
const BOARD_BACK = Object.freeze([0.17, 0.2, 0.22]);
const SNOW = "#f4f8fb";
const GLASS = "#cfe4ea";

export const meta = Object.freeze({
  id: "bike-cafe",
  name: "Bike café", // i18n-ok
  category: "buildings", // i18n-ok
  description: "OpenRadlr's route cafés in four styles (valley, mountain hut, hilltop pavilion, beach kiosk): terrace, name board, bike rack with bikes.", // i18n-ok
  options: Object.freeze({
    style: Object.freeze({ type: "select", values: CAFE_STYLES, default: "valley" }),
    name: Object.freeze({ type: "text", default: "Valley Café" }), // i18n-ok
    snow: Object.freeze({ type: "bool", default: false }),
  }),
});

const C = colour;
const tilted = (geometry, tilt, x, y, z) => geometry.rotateX(tilt).translate(x, y, z);
const sphere = (radius, color, x, y, z) => paint(new THREE.SphereGeometry(radius, 6, 4), color).translate(x, y, z);

/** A round table with chairs, and a parasol over it (straw ones are tall and shaggy). */
function tableSet(parts, x, z, { top = "#e9e4d8", frame = "#3b2f27", parasol = null, straw = false, chairs = 3 }) {
  const dark = C(frame);
  parts.push(cylinder(0.5, 0.5, 0.06, 14, C(top), x, 0.98, z), cylinder(0.05, 0.05, 0.75, 6, dark, x, 0.6, z));
  for (let k = 0; k < chairs; k += 1) {
    const a = (k / chairs) * Math.PI * 2 + 0.3;
    const cx = x + Math.cos(a) * 0.8;
    const cz = z + Math.sin(a) * 0.8;
    parts.push(box(0.42, 0.05, 0.42, dark, cx, 0.6, cz));
    parts.push(box(0.42, 0.45, 0.05, dark).rotateY(-a + Math.PI / 2).translate(cx + Math.cos(a) * 0.2, 0.86, cz + Math.sin(a) * 0.2));
    for (const [lx, lz] of [[-0.17, -0.17], [0.17, -0.17], [-0.17, 0.17], [0.17, 0.17]]) parts.push(box(0.03, 0.6, 0.03, dark, cx + lx, 0.3, cz + lz));
  }
  if (!parasol) return;
  parts.push(cylinder(0.03, 0.03, 2.4, 5, C("#d9d5cc"), x, 1.4, z));
  const canopy = paint(new THREE.ConeGeometry(straw ? 1.7 : 1.5, straw ? 0.9 : 0.55, straw ? 14 : 8, straw ? 3 : 1), C(parasol));
  if (straw) {
    const { position, color } = canopy.attributes;
    for (let i = 0; i < position.count; i += 1) {
      const shade = 0.85 + ((i * 7) % 5) * 0.05;
      color.setXYZ(i, color.getX(i) * shade, color.getY(i) * shade, color.getZ(i) * shade);
    }
  }
  parts.push(canopy.translate(x, straw ? 2.75 : 2.65, z));
}

/** A bike rack along z at `x`, `count` places from `z0`; the bikes it holds are returned as spots to bake. */
function bikeRack(parts, x, z0, count = 4) {
  const steel = C("#8d949b");
  parts.push(box(0.06, 0.06, count * 1.1 + 0.4, steel, x, 0.7, z0 + (count - 1) * 0.55));
  for (let k = 0; k <= count; k += 1) parts.push(box(0.06, 0.7, 0.06, steel, x, 0.35, z0 - 0.55 + k * 1.1));
  return Array.from({ length: 3 }, (_, k) => ({ x: x + 0.25, z: z0 + k * 1.1 }));
}

function valley(p, glass, snow) {
  const wood = C("#7a5233");
  const wall = C("#efe8dc");
  const stone = C("#9a948a");
  p.push(box(13, 4, 9, stone, 0, -1.7, -2), box(12, 3.6, 8, wall, 0, 1.8, -2), box(12.2, 0.3, 8.2, wood, 0, 3.6, -2), gable(14, 10.4, 2.6, C("#4e5258")).translate(0, 3.6, -2));
  if (snow) p.push(gable(14.1, 10.5, 2.65, C(SNOW)).translate(0, 3.72, -2));
  for (let i = -2; i <= 2; i += 1) {
    glass.push(box(1.7, 2.3, 0.1, C(GLASS), i * 2.2, 1.7, 2.06));
    p.push(box(0.18, 2.6, 0.2, wood, i * 2.2 + 1.1, 1.7, 2.08));
  }
  p.push(box(11.6, 0.18, 0.25, wood, 0, 2.95, 2.1), box(11.6, 0.18, 0.25, wood, 0, 0.45, 2.1));
  for (let i = 0; i < 8; i += 1) p.push(tilted(box(1.5, 0.06, 2.4, C(i % 2 ? "#f2efe8" : "#2f6b4f")), 0.28, -5.25 + i * 1.5, 3.05, 3.1));
  p.push(box(13, 0.25, 7, wood, 0, 0.12, 5.6));
  for (const [x, z, c] of [[-4, 4.6, "#c8382e"], [0, 5.8, "#e9e4d8"], [4, 4.6, "#2f6b4f"], [-2, 7.6, "#e9e4d8"], [2.5, 7.8, "#c8382e"]]) tableSet(p, x, z, { parasol: c });
  return { bikes: bikeRack(p, 7.6, 2), board: { y: 4.35, z: 3.18, width: 5, tilt: -0.12 } };
}

function hut(p, glass, snow, random) {
  const stone = C("#8f877c");
  const timber = C("#5e4330");
  const dark = C("#3b2f27");
  const red = C("#a8322a");
  const pick = (list) => list[Math.floor(random() * list.length)];
  const between = (low, high) => low + (high - low) * random();
  p.push(box(12, 3.2, 9, stone, 0, 1.0, -2));
  for (let i = 0; i < 60; i += 1) p.push(box(between(0.5, 1.1), between(0.25, 0.45), 0.06, stone.clone().multiplyScalar(between(0.8, 1.15)), between(-5.6, 5.6), between(0.2, 2.5), 2.52));
  p.push(box(12.2, 3.0, 9.2, timber, 0, 4.1, -2));
  for (let x = -5.8; x <= 5.8; x += 0.4) p.push(box(0.06, 3.0, 0.05, dark, x, 4.1, 2.62));
  p.push(gable(15, 12.5, 4.2, C(snow ? "#eef3f7" : "#4a4440")).translate(0, 5.6, -2));
  if (snow) p.push(gable(15.2, 12.7, 4.3, C(SNOW)).translate(0, 5.72, -2));
  p.push(box(1.1, 3, 1.1, stone, 3.5, 8.2, -3));
  for (const x of [-3.6, -1.2, 1.2, 3.6]) {
    glass.push(box(1.1, 1.3, 0.1, C(GLASS), x, 1.7, 2.55));
    for (const s of [-1, 1]) p.push(box(0.55, 1.4, 0.06, red, x + s * 0.85, 1.7, 2.58));
  }
  for (const x of [-3.6, 0, 3.6]) {
    glass.push(box(1.1, 1.3, 0.1, C(GLASS), x, 4.2, 2.67));
    for (const s of [-1, 1]) p.push(box(0.55, 1.4, 0.06, red, x + s * 0.85, 4.2, 2.7));
  }
  // The balcony with its flower boxes.
  p.push(box(12.4, 0.15, 1.3, timber, 0, 2.95, 3.2));
  for (let x = -6; x <= 6.01; x += 0.25) p.push(box(0.08, 0.95, 0.05, dark, x, 3.5, 3.82));
  p.push(box(12.4, 0.1, 0.12, dark, 0, 4.0, 3.82));
  for (let x = -5.5; x <= 5.5; x += 2.2) {
    p.push(box(1.6, 0.22, 0.25, dark, x, 4.12, 3.95));
    for (let k = 0; k < 7; k += 1) {
      const bloom = pick(["#d9488f", "#c8382e", "#f4f1ea", "#c8382e"]);
      p.push(paint(new THREE.IcosahedronGeometry(0.13, 0), C(snow ? "#2f5a3a" : bloom)).translate(x - 0.7 + k * 0.23, 4.3, 3.95));
    }
  }
  // The stone terrace with long tables and benches, and the firewood.
  p.push(box(13, 0.3, 7, C("#a59d90"), 0, 0.0, 6));
  for (const [x, z] of [[-3.2, 5.0], [3.2, 5.0], [-3.2, 7.5], [3.2, 7.5]]) {
    p.push(box(3.2, 0.08, 0.8, timber, x, 0.95, z));
    for (const s of [-0.75, 0.75]) p.push(box(3.2, 0.06, 0.32, timber, x, 0.5, z + s));
    for (const lx of [-1.3, 1.3]) p.push(box(0.08, 0.9, 0.7, dark, x + lx, 0.47, z));
  }
  for (let i = 0; i < 40; i += 1) p.push(cylinder(0.13, 0.13, 0.9, 6, C(pick(["#8a6a4a", "#7a5a3c", "#9a7a55"]))).rotateX(Math.PI / 2).translate(-6.4 + (i % 8) * 0.28, 0.15 + Math.floor(i / 8) * 0.24, -1));
  return { bikes: bikeRack(p, 7.4, 3, 3), board: { y: 6.2, z: 3.9, width: 4.6, tilt: -0.05 } };
}

function hilltop(p, glass, snow) {
  const steel = C("#3b4249");
  p.push(box(13, 0.6, 9, C("#b9b6ae"), 0, 0, -2), box(13, 2.4, 9, C("#b9b6ae"), 0, -1.5, -2));
  glass.push(box(11.6, 2.9, 0.08, C(GLASS), 0, 1.75, 2.2), box(0.08, 2.9, 7.6, C(GLASS), -5.8, 1.75, -1.8), box(0.08, 2.9, 7.6, C(GLASS), 5.8, 1.75, -1.8));
  p.push(box(11.6, 3.2, 0.2, C("#efe8dc"), 0, 1.9, -5.8));
  for (let x = -5.8; x <= 5.81; x += 1.45) p.push(box(0.09, 3.0, 0.09, steel, x, 1.8, 2.25));
  // The cantilevered flat roof.
  p.push(box(16, 0.35, 12, C("#f2f0eb"), 0, 3.45, -0.5), box(16.1, 0.06, 12.1, steel, 0, 3.27, -0.5));
  if (snow) p.push(box(16.1, 0.2, 12.1, C(SNOW), 0, 3.72, -0.5));
  // The view terrace: a timber deck, tables, loungers and a coin telescope.
  p.push(box(15, 0.25, 7.5, C("#9a7a55"), 0, 0.18, 6.2));
  for (let x = -7.4; x <= 7.4; x += 0.18) p.push(box(0.02, 0.01, 7.5, C("#7a5a3c"), x, 0.31, 6.2));
  p.push(box(15, 0.06, 0.08, steel, 0, 1.25, 9.9));
  glass.push(box(15, 0.95, 0.03, C(GLASS), 0, 0.8, 9.9));
  for (const [x, z] of [[-4.5, 5.2], [-1.5, 6.8], [1.5, 5.2], [4.5, 6.8]]) tableSet(p, x, z, { top: "#f4f2ed", frame: "#3b4249", chairs: 2 });
  for (const x of [-6, 6]) p.push(box(0.8, 0.4, 1.8, C("#e9e4d8"), x, 0.5, 8.5), box(0.8, 0.6, 0.15, C("#e9e4d8"), x, 0.85, 7.7));
  p.push(rod([6.8, 0.3, 9.4], [6.8, 1.2, 9.4], 0.04, steel, 6), cylinder(0.08, 0.1, 0.45, 10, steel).rotateZ(1.2).translate(6.95, 1.3, 9.4));
  return { bikes: bikeRack(p, -7.6, 3, 4), board: { y: 3.95, z: 5.5, width: 5.2, tilt: 0 } };
}

function beach(p, glass, snow) {
  const teal = C("#3fa7a8");
  const white = C("#f4f1ea");
  const dark = C("#7a5a3c");
  p.push(box(14, 0.3, 11, C("#d8c6a2"), 0, 0.55, 2));
  for (let x = -6.5; x <= 6.5; x += 1.6) for (const z of [-3, 1, 5, 7.3]) p.push(cylinder(0.12, 0.12, 2.4, 8, dark, x, -0.6, z));
  for (let x = -6.9; x <= 6.9; x += 0.2) p.push(box(0.02, 0.01, 11, C("#b8a27a"), x, 0.71, 2));
  p.push(box(7, 2.8, 4.5, white, 0, 2.1, -1.6));
  for (let x = -3.4; x <= 3.4; x += 0.35) p.push(box(0.05, 2.8, 0.04, x % 0.7 < 0.35 ? teal : white, x, 2.1, 0.66));
  p.push(tilted(box(8.2, 0.25, 6, teal), -0.12, 0, 3.65, -1.2));
  if (snow) p.push(tilted(box(8.3, 0.2, 6.1, C(SNOW)), -0.12, 0, 3.85, -1.2));
  glass.push(box(4.2, 1.1, 0.06, C(GLASS), 0, 2.2, 0.7));
  p.push(tilted(box(4.6, 0.08, 1.3, teal), -0.5, 0, 3.0, 1.2));
  // The service counter with its stools.
  p.push(box(4.4, 0.12, 0.6, dark, 0, 1.55, 1.0));
  for (const x of [-1.5, 0, 1.5]) p.push(cylinder(0.2, 0.18, 0.08, 10, dark, x, 1.0, 1.7), cylinder(0.04, 0.04, 0.9, 5, white, x, 1.0, 1.7));
  for (const [x, z] of [[-4.5, 4.5], [0, 5.5], [4.5, 4.5]]) tableSet(p, x, z, { top: "#e9dcc2", frame: "#7a5a3c", parasol: "#d9be7a", straw: true });
  // Loungers, surfboards, a life ring and the string lights.
  [-5.5, -3.8, 3.8, 5.5].forEach((x, i) => {
    p.push(box(0.7, 0.1, 1.8, C(["#f2c84b", "#3fa7a8", "#e8473f", "#3fa7a8"][i])).translate(x, 1.05, 8.2));
    p.push(tilted(box(0.7, 0.08, 0.7, white), -0.9, x, 1.3, 7.3));
  });
  for (const [x, c] of [[6.4, "#e8473f"], [6.9, "#f4f1ea"], [-6.6, "#3fa7a8"]]) p.push(paint(new THREE.CapsuleGeometry(0.28, 1.9, 4, 10), C(c)).scale(1, 1, 0.18).rotateZ(0.12).translate(x, 1.9, -2.8));
  p.push(paint(new THREE.TorusGeometry(0.35, 0.09, 8, 18), C("#e8473f")).translate(3.6, 2.4, 0.7));
  for (let i = 0; i <= 14; i += 1) {
    const t = i / 14;
    glass.push(sphere(0.07, C("#ffe9b0"), -6.5 + t * 13, 3.4 - Math.sin(t * Math.PI) * 0.6, 7.8));
  }
  return { bikes: bikeRack(p, -7.6, 1, 4), board: { y: 4.35, z: 1.4, width: 4.6, tilt: -0.1 } };
}

const STYLES = { valley, hut, hilltop, beach };

/**
 * Three parked bikes, built from `createBike` and baked into one geometry in the café's frame (the bike material of the
 * first, which reads each vertex's finish, is the mesh's).
 * @returns {import("../../../three.js").Mesh}
 */
function parkedBikes(spots, random, { own, uniforms }) {
  const scrap = [];
  const keep = (resource) => {
    scrap.push(resource);
    return resource;
  };
  const types = ["road", "gravel"];
  const frames = ["#c8382e", "#2f5f9e", "#1d1f24"];
  const pieces = [];
  let material = null;
  spots.forEach((spot, k) => {
    const bike = createBike({ type: types[Math.floor(random() * types.length)], frame: frames[k % frames.length], own: keep, uniforms });
    bike.object.rotation.y = Math.PI / 2 + (random() - 0.5) * 0.12;
    bike.object.position.set(spot.x, 0, spot.z);
    bike.object.updateMatrixWorld(true);
    bike.object.traverse((mesh) => {
      if (!mesh.isMesh) return;
      material ??= mesh.material;
      const geometry = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
      pieces.push(geometry.applyMatrix4(mesh.matrixWorld));
    });
  });
  const baked = new THREE.Mesh(own(mergeGeometries(pieces)), own(material));
  for (const piece of pieces) piece.dispose();
  for (const resource of scrap) if (resource !== material) resource.dispose();
  baked.name = "bikes";
  baked.castShadow = true;
  baked.receiveShadow = true;
  return baked;
}

/**
 * @param {{style?: string, name?: string, snow?: boolean, own?: Function, uniforms?: object}} [options] `own` registers resources
 * @returns {import("../../../three.js").Group} named `bike-cafe`: the building, the glass and string lights (`userData.glow`,
 *   the material the layer brightens at night), the parked bikes and the name board
 */
export function createBikeCafe({ style = "valley", name = "Valley Café" /* i18n-ok */, snow = false, own = (resource) => resource, uniforms = createSharedUniforms() } = {}) {
  const build = STYLES[style] ?? valley;
  const random = seededRandom(0x5afe + CAFE_STYLES.indexOf(style));
  const hook = (material) => addHook(addHook(material, cloudShadows(uniforms)), heightFog(uniforms));
  const solidParts = [];
  const glassParts = [];
  const { bikes, board } = build(solidParts, glassParts, snow, random);
  const height = board.width / BOARD.ratio;
  solidParts.push(tilted(box(board.width + 0.2, height + 0.2, 0.08, C("#3b2f27")), board.tilt, 0, board.y, board.z));

  const group = new THREE.Group();
  group.name = "bike-cafe";
  const solid = new THREE.Mesh(own(merge(solidParts)), hook(own(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 }))));
  solid.castShadow = true;
  solid.receiveShadow = true;
  solid.name = "building";
  group.add(solid);
  const glow = createFaceMaterial(own);
  group.userData.glow = glow;
  const panes = new THREE.Mesh(own(merge(glassParts)), hook(glow));
  panes.name = "glass";
  group.add(panes);
  group.add(parkedBikes(bikes, random, { own, uniforms }));

  const map = textTexture(name, { background: toSrgb(BOARD_BACK), ink: toSrgb(BOARD_INK), width: BOARD.texels, height: Math.round(BOARD.texels / BOARD.ratio) }, own);
  const face = new THREE.Mesh(own(new THREE.PlaneGeometry(board.width, height)), hook(own(new THREE.MeshStandardMaterial({ map, roughness: 0.7 }))));
  face.name = "name-board";
  face.rotation.x = board.tilt;
  face.position.set(0, board.y, board.z).add(new THREE.Vector3(0, -Math.sin(board.tilt) * 0.05, Math.cos(board.tilt) * 0.05));
  group.add(face);
  return group;
}

/** Workbench entry. */
export function create({ track, uniforms, style, name, snow } = {}) {
  const owner = createOwner(track);
  const object = createBikeCafe({ style, name, snow, own: owner.own, uniforms });
  return { object, update() {}, dispose: () => owner.disposeAll() };
}
