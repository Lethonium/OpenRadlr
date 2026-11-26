/**
 * The spin studio: a glass box with one training room per storey. `createStudioShell` is the building (plinth, a slab per
 * storey, render walls, mullions and a glass front pane per storey, the roof with the lit "SPIN STUDIO" sign) in site-local
 * space: origin on the ground in the middle of the footprint, the glass front at `FOOTPRINT.front`, up is +Y.
 * `createStudioRoom` is one storey's interior in floor-local space (floor top at y = 0, riders face -z): oak floor, stage,
 * a riser under the back row, speakers, wall props, a ceiling with light panels, a smart trainer under every seat's rear
 * axle, the lit lemon/orange strips and the wall screen. No riders and no bikes: they come from the rider layer.
 * Colours are sRGB hex through `colour`; nothing random but a fixed seed, no canvas.
 */
import * as THREE from "../../../three.js";
import { seededRandom } from "../../../world/noise.js";
import { FLOOR_HEIGHT, FOOTPRINT, INSTRUCTOR, RISER, ROOM, ROW_GAP, SEAT_GAP, SLAB, STAGE, seatPosition } from "../../../world/studioLayout.js";
import { createOwner } from "../owner.js";
import { addHook, cloudShadows, createSharedUniforms, heightFog } from "../materials.js";
import { box, colour, cylinder, merge, paint, rod } from "../geom.js";
import { bikeGeometry } from "../riders/bicycle.js";
import { textTexture, toSrgb } from "../textTexture.js";

/** The roof sign's words (a brand name, not translated). */
export const SIGN_TEXT = "SPIN STUDIO"; // i18n-ok (brand name)

const COL = Object.freeze({
  slab: "#b9b8b2", render: "#f4f2ed", frame: "#3b4249", plinth: "#8d8c87", door: "#2c4a5c", board: "#23272b", lemon: "#f5d000", orange: "#ff7a1a",
  ceiling: "#eceae4", walls: "#f4f1ea", stage: "#e6e2da", riser: "#c9a878", trainer: "#2a2d31", foot: "#6d7176", metal: "#5b6066", iron: "#33363a",
  wood: "#b98f5c", terracotta: "#c0653d", leaf: "#4f8a46", white: "#fbfaf7", water: "#79b8e0", screen: "#1d2227", glow: "#7fd4e6", panel: "#fffbea",
});
const MATS = ["#6ba5a0", "#d98a8a", "#8e8bc4"];
const WALL = 0.3;
const GLASS = "#cfe6ee";
/** The sign board: texture width in texels and the board's size in metres. */
const SIGN = Object.freeze({ texels: 1024, ratio: 13.2 / 1.8, width: 13.2, height: 1.8 });
/** Wall props hug the side walls; centre distance from the room's middle line. */
const WALL_X = ROOM.halfWidth - 0.7;
const PROPS = Object.freeze([
  ["rack", 1, -6.8], ["kettlebell", 1, -4.9], ["kettlebell", 1, -4.3], ["mat", -1, -7.2], ["mat", -1, -6.5], ["plant", -1, -8.7],
  ["plant", 1, -8.7], ["plant", 1, 5.6], ["water", 1, 0.4], ["bench", -1, 3.2], ["plant", -1, 5.6],
]);
const OPEN_COLOUR = 1;
const CLOSED_TINT = 0.35;

export const meta = Object.freeze({
  id: "spin-studio",
  name: "Spin studio", // i18n-ok
  category: "buildings", // i18n-ok
  description: "OpenRadlr's glass spin studio: storeys, roof sign, oak room with stage, riser, props and a smart trainer at every seat.", // i18n-ok
  options: Object.freeze({
    storeys: Object.freeze({ type: "range", min: 1, max: 3, step: 1, default: 1 }),
    open: Object.freeze({ type: "bool", default: true }),
    cutaway: Object.freeze({ type: "bool", default: true }),
  }),
});

const C = colour;
const mesh = (geometry, material, name) => Object.assign(new THREE.Mesh(geometry, material), { name });

/** Oak planks along z: vertex colours that differ plank by plank, from a fixed seed. */
function oakFloor(random) {
  const { halfWidth, front, back } = ROOM;
  const count = Math.round((halfWidth * 2) / 0.5);
  const width = (halfWidth * 2) / count;
  const planks = [];
  for (let i = 0; i < count; i += 1) {
    const shade = 0.88 + random() * 0.2;
    planks.push(box(width - 0.012, 0.04, back - front, C("#d9b98c").multiplyScalar(shade), -halfWidth + (i + 0.5) * width, -0.02, (front + back) / 2));
  }
  return planks;
}

/** One trainer around the rear axle: the rear block and feet, and the block under the front wheel (in front, -z). */
function trainerGeometry(fit) {
  const front = -fit.front.x - Math.abs(fit.rear.x);
  return merge([
    box(0.3, 0.4, 0.42, C(COL.trainer), 0, 0.2, 0),
    box(0.9, 0.06, 0.16, C(COL.foot), 0, 0.03, 0),
    box(0.6, 0.04, 0.1, C(COL.foot), 0, 0.02, 0.25),
    box(0.24, 0.1, 0.36, C(COL.trainer), 0, 0.05, front),
  ]);
}

function plant(parts, x, z, random) {
  parts.push(cylinder(0.24, 0.18, 0.45, 12, C(COL.terracotta), x, 0.22, z));
  for (let k = 0; k < 9; k += 1) {
    const a = k * 2.4;
    const r = 0.12 + (k % 3) * 0.08;
    const leaf = paint(new THREE.SphereGeometry(0.2, 8, 6), C(COL.leaf).multiplyScalar(0.85 + (k % 3) * 0.1 + random() * 0.05));
    leaf.scale(1.3, 0.45, 0.7);
    leaf.rotateY(a).rotateZ(0.5).translate(x + Math.cos(a) * r, 0.65 + k * 0.08, z + Math.sin(a) * r);
    parts.push(leaf);
  }
}

function prop(parts, kind, side, z, random) {
  const x = side * WALL_X;
  if (kind === "rack") {
    parts.push(box(0.5, 0.05, 1.6, C(COL.metal), x, 0.5, z), box(0.5, 0.05, 1.6, C(COL.metal), x, 0.95, z));
    for (const e of [-0.75, 0.75]) parts.push(box(0.5, 1.0, 0.05, C(COL.metal), x, 0.5, z + e));
    for (let i = 0; i < 5; i += 1) {
      for (const y of [0.62, 1.07]) {
        const at = z - 0.6 + i * 0.3;
        parts.push(cylinder(0.02, 0.02, 0.34, 6, C("#8d949b")).rotateX(Math.PI / 2).translate(x, y, at));
        for (const e of [-0.12, 0.12]) parts.push(cylinder(0.07 + i * 0.008, 0.07 + i * 0.008, 0.06, 12, C(COL.iron)).rotateZ(Math.PI / 2).translate(x, y, at + e));
      }
    }
  } else if (kind === "kettlebell") {
    parts.push(paint(new THREE.SphereGeometry(0.15, 12, 8), C(COL.iron)).translate(x, 0.16, z), paint(new THREE.TorusGeometry(0.09, 0.018, 6, 14, Math.PI), C(COL.iron)).translate(x, 0.28, z));
  } else if (kind === "mat") {
    parts.push(cylinder(0.13, 0.13, 0.66, 14, C(MATS[Math.floor(random() * MATS.length)])).rotateX(Math.PI / 2).translate(x, 0.13, z));
  } else if (kind === "plant") {
    plant(parts, x, z, random);
  } else if (kind === "water") {
    parts.push(box(0.42, 1.0, 0.42, C(COL.white), x, 0.5, z), cylinder(0.15, 0.15, 0.42, 14, C(COL.water), x, 1.22, z), box(0.06, 0.06, 0.1, C("#2f5f9e"), x - side * 0.22, 0.8, z));
  } else if (kind === "bench") {
    parts.push(box(0.44, 0.06, 1.7, C(COL.wood), x, 0.44, z), box(0.34, 0.08, 0.5, C(COL.white), x, 0.51, z - 0.45));
    for (const e of [-0.7, 0.7]) parts.push(box(0.4, 0.42, 0.06, C(COL.iron), x, 0.21, z + e));
  }
}

/** The glowing material: a flat colour that emits itself. */
const glowing = (hex, intensity, own) => own(new THREE.MeshStandardMaterial({ color: hex, emissive: hex, emissiveIntensity: intensity, roughness: 0.5 }));

/**
 * One storey's interior.
 * @param {{own?: Function, uniforms?: object, ceiling?: boolean}} [options] `own` registers resources
 * @returns {{object: import("../../../three.js").Group, setOpen: (open: boolean) => void}}
 */
export function createStudioRoom({ own = (resource) => resource, ceiling = true } = {}) {
  const random = seededRandom(0x5917);
  const { halfWidth: w, front: f, back: b, height: h } = ROOM;
  const mid = (f + b) / 2;
  const solid = [...oakFloor(random)];
  const lit = { panel: [], lemon: [], orange: [], screen: [] };
  if (ceiling) {
    solid.push(box(w * 2, 0.04, b - f, C(COL.ceiling), 0, h - 0.02, mid));
    for (const x of [-4.5, 0, 4.5]) lit.panel.push(box(0.6, 0.04, b - f - 2, C("#ffffff"), x, h - 0.06, mid));
  }
  solid.push(box(STAGE.halfWidth * 2, STAGE.height, STAGE.depth, C(COL.stage), 0, STAGE.height / 2, STAGE.z), box(1.4, STAGE.height / 2, 0.5, C(COL.stage), 0, STAGE.height / 4, STAGE.z + STAGE.depth / 2 + 0.25));
  solid.push(box(SEAT_GAP * 8 + 0.6, RISER, 2.2, C(COL.riser), 0, RISER / 2, ROW_GAP));
  lit.lemon.push(box(STAGE.halfWidth * 2, 0.04, 0.06, C("#ffffff"), 0, STAGE.height + 0.02, STAGE.z + STAGE.depth / 2), box(w * 2 - 0.4, 0.25, 0.04, C("#ffffff"), 0, 1.1, b - 0.06));
  lit.orange.push(box(w * 2 - 0.4, 0.08, 0.04, C("#ffffff"), 0, 0.85, b - 0.06));
  for (const s of [-1, 1]) solid.push(box(0.4, 0.6, 0.35, C("#1d1f24"), s * 3.2, 1.9, STAGE.z), rod([s * 3.2, 0, STAGE.z], [s * 3.2, 1.6, STAGE.z], 0.025, C(COL.metal), 5));
  for (const [kind, side, z] of PROPS) prop(solid, kind, side, z, random);
  solid.push(box(0.08, 1.3, 2.2, C(COL.screen), -(w - 0.05), 1.9, -2.2));
  lit.screen.push(box(0.02, 1.1, 2.0, C("#ffffff"), -(w - 0.09), 1.9, -2.2));

  // The coach's trainer faces the room; the seats' are one instanced mesh under each rear axle.
  const fit = bikeGeometry("road");
  const rear = Math.abs(fit.rear.x);
  const [coachX, coachY, coachZ] = INSTRUCTOR.position;
  solid.push(trainerGeometry(fit).rotateY(Math.PI).translate(coachX, coachY, coachZ - rear));

  const group = new THREE.Group();
  group.name = "studio-room";
  const material = own(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 }));
  const body = mesh(own(merge(solid)), material, "room");
  body.receiveShadow = true;
  body.castShadow = true;
  group.add(body);
  const emitters = [];
  for (const [name, hex, intensity] of [["panel", COL.panel, 1.3], ["lemon", COL.lemon, 1.6], ["orange", COL.orange, 1.6], ["screen", COL.glow, 1.1]]) {
    if (!lit[name].length) continue;
    const glow = glowing(hex, intensity, own);
    emitters.push({ glow, intensity });
    group.add(mesh(own(merge(lit[name])), glow, `lit-${name}`));
  }
  const trainers = new THREE.InstancedMesh(own(trainerGeometry(fit)), own(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 })), 16);
  trainers.name = "trainer";
  trainers.frustumCulled = false;
  trainers.castShadow = true;
  for (let seat = 0; seat < 16; seat += 1) {
    const [x, y, z] = seatPosition(seat);
    trainers.setMatrixAt(seat, new THREE.Matrix4().makeTranslation(x, y, z + rear));
  }
  group.add(trainers);

  return {
    object: group,
    /** An open room is lit; a closed one is dark (accents and panels off, the room's colour dimmed). */
    setOpen(open) {
      for (const { glow, intensity } of emitters) glow.emissiveIntensity = open ? intensity : 0;
      material.color.setScalar(open ? OPEN_COLOUR : CLOSED_TINT);
    },
  };
}

/**
 * The building: plinth, a slab and walls per storey, the glass fronts, the roof with its sign.
 * @param {{floors: number, own?: Function, uniforms?: object, roof?: boolean}} options `roof: false` leaves the top open
 * @returns {{object: import("../../../three.js").Group, glass: import("../../../three.js").Mesh[]}} one pane per storey
 */
export function createStudioShell({ floors, own = (resource) => resource, uniforms = createSharedUniforms(), roof = true }) {
  const { halfWidth: W, front: F, back: B } = FOOTPRINT;
  const depth = B - F;
  const mid = (F + B) / 2;
  const hook = (material) => addHook(addHook(material, cloudShadows(uniforms)), heightFog(uniforms));
  const parts = [box(W * 2, 0.3, depth, C(COL.plinth), 0, -0.15, mid)];
  const wallHeight = FLOOR_HEIGHT - SLAB;
  for (let s = 0; s < floors; s += 1) {
    const y0 = s * FLOOR_HEIGHT;
    const wallY = y0 + SLAB + wallHeight / 2;
    parts.push(box(W * 2, SLAB, depth, C(COL.slab), 0, y0 + SLAB / 2, mid));
    for (const side of [-1, 1]) parts.push(box(WALL, wallHeight, depth, C(COL.render), side * (W - WALL / 2 - 0.1), wallY, mid));
    parts.push(box(W * 2 - 0.2 - WALL * 2, wallHeight, WALL, C(COL.render), 0, wallY, B - WALL / 2));
    for (let x = -W + 0.5; x <= W - 0.5; x += 2) parts.push(box(0.12, wallHeight, 0.2, C(COL.frame), x, wallY, F + 0.12));
    parts.push(box(W * 2, 0.16, 0.22, C(COL.frame), 0, y0 + SLAB + 0.08, F + 0.12), box(W * 2, 0.16, 0.22, C(COL.frame), 0, y0 + FLOOR_HEIGHT - 0.08, F + 0.12));
  }
  parts.push(box(1.8, 2.4, 0.1, C(COL.door), W - 2.2, SLAB + 1.2, F + 0.05));
  const top = floors * FLOOR_HEIGHT;
  if (roof) {
    parts.push(box(W * 2, SLAB, depth, C(COL.slab), 0, top + SLAB / 2, mid));
    for (const z of [F + 0.15, B - 0.15]) parts.push(box(W * 2, 0.7, 0.3, C(COL.render), 0, top + SLAB + 0.35, z));
    for (const side of [-1, 1]) parts.push(box(0.3, 0.7, depth - 0.6, C(COL.render), side * (W - 0.15), top + SLAB + 0.35, mid));
  }
  const signY = top + SLAB + 1.6;
  parts.push(box(13.6, 2.0, 0.2, C(COL.board), 0, signY, F + 0.45));
  for (const side of [-1, 1]) parts.push(box(0.12, 1.6, 0.12, C(COL.frame), side * 6, top + SLAB + 0.8, F + 0.6));

  const object = new THREE.Group();
  object.name = "studio-shell";
  const building = mesh(own(merge(parts)), hook(own(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 }))), "building");
  building.castShadow = true;
  building.receiveShadow = true;
  object.add(building);

  const paneMaterial = own(new THREE.MeshStandardMaterial({ color: GLASS, transparent: true, opacity: 0.2, roughness: 0.04, metalness: 0.2, depthWrite: false, side: THREE.DoubleSide }));
  const pane = own(new THREE.PlaneGeometry(W * 2 - 0.2, wallHeight));
  const glass = [];
  for (let s = 0; s < floors; s += 1) {
    const each = mesh(pane, paneMaterial, "glass");
    each.position.set(0, s * FLOOR_HEIGHT + SLAB + wallHeight / 2, F + 0.02);
    each.renderOrder = 2;
    glass.push(each);
    object.add(each);
  }

  const light = (hex) => toSrgb([C(hex).r, C(hex).g, C(hex).b]);
  const map = textTexture(SIGN_TEXT, { background: light(COL.board), ink: light(COL.lemon), width: SIGN.texels, height: Math.round(SIGN.texels / SIGN.ratio) }, own);
  const sign = mesh(own(new THREE.PlaneGeometry(SIGN.width, SIGN.height)), own(new THREE.MeshStandardMaterial({ map, emissive: 0xffffff, emissiveMap: map, emissiveIntensity: 0.9, roughness: 0.5 })), "sign");
  sign.position.set(0, signY, F + 0.34);
  sign.rotation.y = Math.PI;
  object.add(sign);
  return { object, glass };
}

/** Workbench entry: the shell with a room in every storey (the top one open to the sky when `cutaway`). */
export function create({ track, uniforms, storeys = 1, open = true, cutaway = true } = {}) {
  const owner = createOwner(track);
  const floors = Math.max(1, Math.min(3, Math.round(storeys)));
  const object = new THREE.Group();
  object.name = "spin-studio";
  object.add(createStudioShell({ floors, own: owner.own, uniforms, roof: !cutaway }).object);
  for (let s = 0; s < floors; s += 1) {
    const room = createStudioRoom({ own: owner.own, uniforms, ceiling: !cutaway || s < floors - 1 });
    room.setOpen(open);
    room.object.position.y = s * FLOOR_HEIGHT + SLAB;
    object.add(room.object);
  }
  return { object, update() {}, dispose: () => owner.disposeAll() };
}
