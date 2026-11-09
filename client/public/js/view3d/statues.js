/**
 * Stone statues of a workout's figures (#77): a row of plinths, each carrying a
 * rider body frozen at the telling moment of its exercise, plus a glow ring
 * round every plinth top. Built in the row's local frame (origin at the row's
 * centre, figures facing −Z); the scene places the row with the gym's
 * `statueRow`. Pure geometry, no GL.
 */
import { MeshBuilder } from "./meshBuilder.js";
import { multiply, placement, scaling, transformPoint } from "./math.js";
import { STATUE_MOMENT, CLIPS, settle } from "./clips.js";
import { bodyTransforms, poseAt } from "./riderPose.js";
import { buildForearm, buildHead, buildPelvis, buildShin, buildShoe, buildThigh, buildTorso, buildUpperArm, variantLook } from "./riderModel.js";

/** Figure colour, plinth (a darker shade) and, for bronze, the patina band. */
export const STATUE_MATERIALS = Object.freeze({
  marble: Object.freeze({ figure: [0.93, 0.91, 0.86], plinth: [0.66, 0.64, 0.6] }),
  bronze: Object.freeze({ figure: [0.72, 0.54, 0.2], plinth: [0.36, 0.27, 0.12], accent: [0.25, 0.55, 0.45] }),
  sandstone: Object.freeze({ figure: [0.8, 0.62, 0.36], plinth: [0.56, 0.42, 0.24] }),
  granite: Object.freeze({ figure: [0.6, 0.61, 0.63], plinth: [0.34, 0.35, 0.37] }),
});

const GLOW = [1, 0.78, 0.4];
const SCALE = 1.15;
const ROW_HALF = 7.5;
const MAX_SPACING = 3;
/** Plinth sizes `[x, height, z]`; a lying figure's long axis runs along X, the row's. */
export const PLINTHS = Object.freeze({ upright: [0.9, 1.0, 0.9], lying: [2.0, 0.6, 0.8] });
const GLOW_BAR = 0.06;
const GLOW_MARGIN = 0.08;
/** Per-face brightness of granite. */
const SPECKLE = [0.9, 1.08, 0.96, 1.04, 0.92, 1.0];

const look = variantLook(0);
const PARTS = Object.freeze({
  pelvis: () => buildPelvis(look),
  torso: () => buildTorso(look),
  head: () => buildHead(look),
  upperArmL: () => buildUpperArm(look, -1),
  upperArmR: () => buildUpperArm(look, 1),
  forearmL: () => buildForearm(look, -1),
  forearmR: () => buildForearm(look, 1),
  thighL: () => buildThigh(look),
  thighR: () => buildThigh(look),
  shinL: () => buildShin(look),
  shinR: () => buildShin(look),
  footL: () => buildShoe(),
  footR: () => buildShoe(),
});

/** Local x of each plinth in a row of `count`. */
export function statueSlots(count) {
  if (count <= 1) return [{ x: 0 }];
  const spacing = Math.min(MAX_SPACING, (2 * ROW_HALF) / (count - 1));
  return Array.from({ length: count }, (_, i) => ({ x: (i - (count - 1) / 2) * spacing }));
}

function recolour(mesh, [r, g, b], opaque = false) {
  const colors = Float32Array.from(mesh.colors);
  for (let i = 0; i < colors.length; i += 4) {
    [colors[i], colors[i + 1], colors[i + 2]] = [r, g, b];
    // A biome rig may carry tint masks (winter's scarf); a statue is one stone.
    if (opaque) colors[i + 3] = 0;
  }
  return { ...mesh, colors };
}

function plinthMesh([sx, sy, sz], x, material) {
  const m = new MeshBuilder();
  m.box([x, sy / 2, 0], [sx, sy, sz], material.plinth);
  const mesh = m.build();
  if (material === STATUE_MATERIALS.granite) {
    for (let i = 0; i < mesh.vertexCount; i += 1) {
      const f = SPECKLE[Math.floor(i / 6) % SPECKLE.length];
      for (let k = 0; k < 3; k += 1) mesh.colors[i * 4 + k] *= f;
    }
  }
  return mesh;
}

/** A thin band round the plinth's top edge (bronze patina). */
function bandMesh([sx, sy, sz], x, colour) {
  const m = new MeshBuilder();
  m.box([x, sy - 0.05, 0], [sx + 0.02, 0.08, sz + 0.02], colour);
  return m.build();
}

/** Four thin bars round the plinth's top edge. */
function glowRing([sx, sy, sz], x) {
  const m = new MeshBuilder();
  const w = sx + 2 * GLOW_MARGIN;
  const d = sz + 2 * GLOW_MARGIN;
  const y = sy - GLOW_BAR / 2;
  m.box([x, y, (d - GLOW_BAR) / 2], [w, GLOW_BAR, GLOW_BAR], GLOW);
  m.box([x, y, -(d - GLOW_BAR) / 2], [w, GLOW_BAR, GLOW_BAR], GLOW);
  m.box([x + (w - GLOW_BAR) / 2, y, 0], [GLOW_BAR, GLOW_BAR, d - 2 * GLOW_BAR], GLOW);
  m.box([x - (w - GLOW_BAR) / 2, y, 0], [GLOW_BAR, GLOW_BAR, d - 2 * GLOW_BAR], GLOW);
  return m.build();
}

/** Where each part of `exercise`'s frozen figure goes at `scale`, and the box round them. */
function pose(exercise, lying, scale, parts) {
  const clip = CLIPS[exercise];
  const frozen = settle(poseAt(clip, STATUE_MOMENT[exercise].t), clip.plant, parts);
  const base = multiply(placement([0, 0, 0], lying ? Math.PI / 2 : 0), scaling(scale));
  const placed = bodyTransforms(frozen, look).map(({ mesh, model }) => ({ mesh, model: multiply(base, model) }));
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (const { mesh, model } of placed) {
    const { positions } = parts.get(mesh);
    for (let i = 0; i < positions.length; i += 3) {
      const p = transformPoint(model, [positions[i], positions[i + 1], positions[i + 2]]);
      for (let k = 0; k < 3; k += 1) {
        lo[k] = Math.min(lo[k], p[k]);
        hi[k] = Math.max(hi[k], p[k]);
      }
    }
  }
  return { placed, lo, hi };
}

/** The figure of `exercise` frozen at its moment, resting on a plinth top at `top`, centred over `x`. */
function appendFigure(out, parts, exercise, x, plinth, scale) {
  const lying = plinth === "lying";
  let figure = pose(exercise, lying, scale, parts);
  // A lying body that outgrows its plinth is shrunk to fit it.
  const length = figure.hi[0] - figure.lo[0];
  if (lying && length > PLINTHS.lying[0]) figure = pose(exercise, lying, (scale * PLINTHS.lying[0]) / length, parts);
  const { placed, lo, hi } = figure;
  // A lying body is centred over its plinth; a standing one keeps the clip's own spot.
  const at = [lying ? x - (lo[0] + hi[0]) / 2 : x, PLINTHS[plinth][1] - lo[1], lying ? -(lo[2] + hi[2]) / 2 : 0];
  const lift = placement(at);
  for (const { mesh, model } of placed) out.append(parts.get(mesh), multiply(lift, model));
}

/**
 * One row of statues: `{ mesh, glows, tops }`; `glows[i]` rings plinth `i`,
 * `tops[i]` is its height. `rig` is a biome's workout rig (`{ parts, scale }`,
 * see `biome.workout`); without one the human rider is cast.
 */
export function buildStatues(figures, materialName, rig = null) {
  if (!Object.hasOwn(STATUE_MATERIALS, materialName)) throw new Error(`Unknown statue material "${materialName}".`);
  const material = STATUE_MATERIALS[materialName];
  const builders = rig?.parts ?? PARTS;
  const scale = SCALE * (rig?.scale ?? 1);
  const parts = new Map(Object.entries(builders).map(([name, build]) => [name, recolour(build(), material.figure, Boolean(rig))]));
  const out = new MeshBuilder();
  const slots = statueSlots(figures.length);
  const glows = [];
  const tops = [];
  figures.forEach((exercise, i) => {
    const { plinth } = STATUE_MOMENT[exercise];
    const size = PLINTHS[plinth];
    const { x } = slots[i];
    out.append(plinthMesh(size, x, material), placement([0, 0, 0]));
    if (material.accent) out.append(bandMesh(size, x, material.accent), placement([0, 0, 0]));
    appendFigure(out, parts, exercise, x, plinth, scale);
    glows.push(glowRing(size, x));
    tops.push(size[1]);
  });
  return { mesh: out.build(), glows, tops };
}
