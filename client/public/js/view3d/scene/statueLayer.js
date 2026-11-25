/**
 * The gyms' statue rows (#77): a row of plinths, each carrying the rigged rider (or penguin) frozen at the telling moment
 * of its exercise, baked once into stone. Plinths and figures of a row merge into one mesh; an emissive ring round a
 * plinth's top glows for the one the rider is told about. A row is built in its own frame (origin at its centre, figures
 * facing -Z) and placed with the gym's `statueRow`. The layer replaces its rows on `setRows`, freeing the old.
 */
import * as THREE from "../../three.js";
import { mergeGeometries } from "../../../vendor/three/addons/utils/BufferGeometryUtils.js";
import { addHook, cloudShadows, heightFog } from "../assets/materials.js";
import { bakeStatue } from "../assets/riders/statue.js";
import { CLIPS, STATUE_MOMENT } from "../clips.js";
import { poseAt } from "../riderPose.js";
import { PLINTHS, STATUE_MATERIALS, statueSlots } from "../statues.js";
import { createOwner } from "./tracker.js";

const SCALE = 1.15;
const GLOW = [1, 0.78, 0.4];
const GLOW_BAR = 0.06;
const GLOW_MARGIN = 0.08;
/** Per-face brightness of granite. */
const SPECKLE = [0.9, 1.08, 0.96, 1.04, 0.92, 1.0];
/** The rig's +x turned to a row's -Z. */
const FACE_ROW = Math.PI / 2;

/** A flat-coloured box `size` at `centre`, non-indexed, with position, normal and colour only. */
function paintedBox(centre, size, colour, speckle = false) {
  const geometry = new THREE.BoxGeometry(...size).toNonIndexed();
  geometry.deleteAttribute("uv");
  geometry.translate(...centre);
  const colours = new Float32Array(geometry.attributes.position.count * 3);
  for (let i = 0; i < geometry.attributes.position.count; i += 1) {
    const f = speckle ? SPECKLE[Math.floor(i / 6) % SPECKLE.length] : 1;
    colours.set([colour[0] * f, colour[1] * f, colour[2] * f], i * 3);
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colours, 3));
  return geometry;
}

function plinthGeometry([sx, sy, sz], material, name) {
  const parts = [paintedBox([0, sy / 2, 0], [sx, sy, sz], material.plinth, name === "granite")];
  if (material.accent) parts.push(paintedBox([0, sy - 0.05, 0], [sx + 0.02, 0.08, sz + 0.02], material.accent));
  return parts;
}

/** Four thin bars round a plinth's top edge, centred on x = 0. */
function ringGeometry([sx, sy, sz]) {
  const w = sx + 2 * GLOW_MARGIN;
  const d = sz + 2 * GLOW_MARGIN;
  const y = sy - GLOW_BAR / 2;
  const bar = (centre, size) => paintedBox(centre, size, GLOW);
  const parts = [
    bar([0, y, (d - GLOW_BAR) / 2], [w, GLOW_BAR, GLOW_BAR]),
    bar([0, y, -(d - GLOW_BAR) / 2], [w, GLOW_BAR, GLOW_BAR]),
    bar([(w - GLOW_BAR) / 2, y, 0], [GLOW_BAR, GLOW_BAR, d - 2 * GLOW_BAR]),
    bar([-(w - GLOW_BAR) / 2, y, 0], [GLOW_BAR, GLOW_BAR, d - 2 * GLOW_BAR]),
  ];
  const merged = mergeGeometries(parts);
  for (const part of parts) part.dispose();
  return merged;
}

/**
 * @param {{uniforms?: object, track: import("./tracker.js").Tracker["track"]}} options
 */
export function createStatueLayer({ uniforms, track }) {
  const layerOwner = createOwner(track);
  const object = new THREE.Group();
  object.name = "statues";
  const lit = (material) => (uniforms ? addHook(addHook(material, cloudShadows(uniforms)), heightFog(uniforms)) : material);
  const stone = layerOwner.own(lit(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 })));
  const glowMaterial = layerOwner.own(new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }));

  /** @type {{gym: object, owner: ReturnType<typeof createOwner>, group: THREE.Group, figures: object[], rings: THREE.Mesh[]}[]} */
  let rows = [];

  const clear = () => {
    for (const row of rows) {
      object.remove(row.group);
      row.owner.disposeAll();
    }
    rows = [];
  };

  /** Where one frozen figure stands on its plinth: its matrix, and its box in the row's frame. */
  const fit = (baked, plinth, x) => {
    const lying = plinth === "lying";
    const { box } = baked;
    const length = box.max.x - box.min.x;
    let scale = SCALE;
    // a lying body that outgrows its plinth is shrunk to fit it
    if (lying && length * scale > PLINTHS.lying[0]) scale = PLINTHS.lying[0] / length;
    const top = PLINTHS[plinth][1];
    const turn = new THREE.Matrix4().makeRotationY(lying ? 0 : FACE_ROW);
    const lift = new THREE.Matrix4().makeScale(scale, scale, scale);
    // a lying body is centred over its plinth; a standing one keeps the clip's own spot
    const centre = box.getCenter(new THREE.Vector3());
    const at = lying ? new THREE.Vector3(x - scale * centre.x, top - scale * box.min.y, -scale * centre.z) : new THREE.Vector3(x, top - scale * box.min.y, 0);
    const matrix = new THREE.Matrix4().makeTranslation(at.x, at.y, at.z).multiply(turn).multiply(lift);
    return { matrix, box: box.clone().applyMatrix4(matrix), top };
  };

  const build = ({ gym, figures, material: materialName, figure = "rider" }) => {
    if (!Object.hasOwn(STATUE_MATERIALS, materialName)) throw new Error(`Unknown statue material "${materialName}".`);
    const material = STATUE_MATERIALS[materialName];
    const owner = createOwner(track);
    const group = new THREE.Group();
    const parts = [];
    const placed = [];
    const rings = [];
    const ringGeometries = new Map();
    const slots = statueSlots(figures.length);
    figures.forEach((exercise, i) => {
      const { t, plinth } = STATUE_MOMENT[exercise];
      const { x } = slots[i];
      const size = PLINTHS[plinth];
      for (const part of plinthGeometry(size, material, materialName)) parts.push(part.translate(x, 0, 0));
      const baked = bakeStatue({ pose: poseAt(CLIPS[exercise], t), material, figure, uniforms });
      const spot = fit(baked, plinth, x);
      parts.push(baked.geometry.applyMatrix4(spot.matrix));
      placed.push({ exercise, x, box: spot.box, top: spot.top });
      if (!ringGeometries.has(plinth)) ringGeometries.set(plinth, owner.own(ringGeometry(size)));
      const ring = new THREE.Mesh(ringGeometries.get(plinth), glowMaterial);
      ring.position.x = x;
      ring.visible = false;
      ring.name = "statue-glow";
      rings.push(ring);
      group.add(ring);
    });
    const merged = owner.own(mergeGeometries(parts));
    for (const part of parts) part.dispose();
    const mesh = new THREE.Mesh(merged, stone);
    Object.assign(mesh, { castShadow: true, receiveShadow: true, name: "statue-row" });
    group.add(mesh);
    const row = gym.statueRow;
    group.position.fromArray(row.position);
    group.rotation.set(0, row.yaw, 0);
    object.add(group);
    return { gym, owner, group, figures: placed, rings };
  };

  return {
    object,
    /** Replaces the rows; `rows` are `{gym, figures, material, figure}` from `statueRows` (figure "rider" by default). */
    setRows(next) {
      clear();
      rows = next.map(build);
    },
    /** Lights the ring of plinth `index` at `gym`; `null` switches every ring off. */
    setGlow(gym, index) {
      for (const row of rows) row.rings.forEach((ring, i) => (ring.visible = row.gym === gym && i === index));
    },
    /** The figures of `gym`'s row `{exercise, x, box (row frame), top}`, for tests and the view's targets. */
    figuresOf: (gym) => rows.find((row) => row.gym === gym)?.figures ?? [],
    /** The glow rings of `gym`'s row. */
    ringsOf: (gym) => rows.find((row) => row.gym === gym)?.rings ?? [],
    /** The merged mesh of `gym`'s row. */
    meshOf: (gym) => rows.find((row) => row.gym === gym)?.group.getObjectByName("statue-row") ?? null,
    update(frame) {
      const glow = frame.statueGlow;
      this.setGlow(glow?.gym ?? null, glow?.index ?? null);
    },
    setEnvironment() {},
    dispose() {
      clear();
      object.clear();
      layerOwner.disposeAll();
    },
  };
}
