/**
 * Turning an imported kit into something the world can draw (#117).
 *
 * The importer leaves flat triangles with a colour per face; this side reads
 * them back into a `MeshBuilder`, indexes the kit's models by the role they
 * play, and hands the scenery builder a `flora` that picks one per instance.
 *
 * Pure: no I/O, no clock, no `Math.random`.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { MeshBuilder } from "../public/js/view3d/meshBuilder.js";
import { indexKit, pickLod } from "../public/js/view3d/scenery/kits.js";
import { buildMesh } from "../public/js/view3d/scenery/models.js";
import { paletteColour, planFlora } from "../public/js/view3d/scenery/plan.js";

/** A two-triangle model, the smallest thing a kit can hold. */
const MODEL = {
  name: "pine",
  triangles: [
    [-1, 0, 0, 0.2, 0.4, 0.2],
    [1, 0, 0, 0.2, 0.4, 0.2],
    [0, 4, 0, 0.2, 0.4, 0.2],
    [0, 0, 0, 0.4, 0.3, 0.2],
    [1, 0, 0, 0.4, 0.3, 0.2],
    [1, 1, 0, 0.4, 0.3, 0.2],
  ],
  bounds: { min: [-1, 0, 0], max: [1, 4, 0] },
  textured: false,
  vertices: 6,
};

const KIT = {
  name: "nature",
  licence: "CC0-1.0",
  provenance: { pack: "https://quaternius.com/packs/ultimatenature.html", licence: "https://creativecommons.org/publicdomain/zero/1.0/", taken: "2026-11-16" },
  models: {
    pine: { role: "ridges", height: 1, near: "pine" },
  },
};

/** A random source that always gives the same number. */
const fixed = (value) => () => value;

/** A kit read from memory: the world reads these from the imported files. */
const floraOf = (kit = KIT, options = {}) => planFlora(indexKit(kit), { nearRange: 150, readModelFile: () => MODEL, ...options });

test("a model reads back into a MeshBuilder", () => {
  const mesh = buildMesh(MODEL);
  assert.ok(mesh instanceof MeshBuilder);
  assert.equal(mesh.vertexCount, 6);
  // The colour survives the trip into the flat vertex format (30-bit floats).
  const colour = Array.from(mesh.colors.data.slice(0, 3)).map((v) => Math.round(v * 10) / 10);
  assert.deepEqual(colour, [0.2, 0.4, 0.2]);
});

test("a kit indexes its models by role", () => {
  const kit = indexKit(KIT);
  assert.deepEqual(kit.roles, ["ridges"]);
  assert.equal(kit.byRole.ridges.length, 1);
});

test("a kit that is not CC0 is refused, with its name", () => {
  const bad = { ...KIT, licence: "Quaternius-Asset-License" };
  assert.throws(() => indexKit(bad), /nature.*licence/is);
});

test("a model naming a variant the kit does not hold is refused", () => {
  const bad = { ...KIT, models: { pine: { role: "ridges", near: "gone" } } };
  assert.throws(() => indexKit(bad), /gone/);
});

test("near and far are chosen by distance, and a model without a far one always uses near", () => {
  const model = { near: { name: "n" }, far: { name: "f" } };
  assert.equal(pickLod(model, 10, 150), model.near);
  assert.equal(pickLod(model, 400, 150), model.far);
  const nearOnly = { near: { name: "n" } };
  assert.equal(pickLod(nearOnly, 10_000, 150), nearOnly.near);
});

test("a role the season knows takes the season's colour, and one it does not keeps its own", () => {
  const biome = { scenery: { bark: [0.1, 0.1, 0.1] } };
  assert.deepEqual(paletteColour("bark", [0.3, 0.2, 0.1], biome), [0.1, 0.1, 0.1]);
  assert.deepEqual(paletteColour("stone", [0.3, 0.2, 0.1], biome), [0.3, 0.2, 0.1]);
});

test("the flora draws the model where it is asked to, from the random it is given", () => {
  const flora = floraOf();
  const mesh = new MeshBuilder();
  flora.tree({ mesh, x: 12, y: 3, z: -4, kind: 0.5, random: fixed(0.5) });
  assert.equal(mesh.vertexCount, 6);
  // The pine stands 4 tall, so its apex lands at the height it was placed at.
  const ys = Array.from(mesh.positions.data.slice(0, 18)).filter((_, i) => i % 3 === 1);
  assert.equal(Math.max(...ys), 7);
});

test("the flora asks the random for its size, so instances differ", () => {
  const flora = floraOf({ ...KIT, models: { pine: { role: "ridges", near: "pine", sizes: [1, 3] } } });
  const heightWith = (r) => {
    const mesh = new MeshBuilder();
    flora.tree({ mesh, x: 0, y: 0, z: 0, kind: 0.5, random: fixed(r) });
    const ys = Array.from(mesh.positions.data.slice(0, mesh.positions.length)).filter((_, i) => i % 3 === 1);
    return Math.round(Math.max(...ys));
  };
  // The pine is 4 tall; `sizes` multiplies that, from 1× to 3×.
  assert.equal(heightWith(0), 4);
  assert.equal(heightWith(0.999), 12);
});

test("a kit with no model for the asked role draws nothing rather than crashing", () => {
  const flora = floraOf();
  const mesh = new MeshBuilder();
  flora.tree({ mesh, x: 0, y: 0, z: 0, kind: 0.5, random: fixed(0.5), role: "house" });
  assert.equal(mesh.vertexCount, 0);
});

test("the flora turns each instance, so a wood is not a grid of copies", () => {
  const flora = floraOf();
  const mesh = new MeshBuilder();
  flora.tree({ mesh, x: 0, y: 0, z: 0, kind: 0.5, random: fixed(0.25) });
  // A quarter turn about y moves the −1 x corner to −1 z.
  const xs = Array.from(mesh.positions.data.slice(0, 9)).filter((_, i) => i % 3 === 0);
  const zs = Array.from(mesh.positions.data.slice(0, 9)).filter((_, i) => i % 3 === 2);
  assert.ok(Math.abs(Math.min(...xs)) < 0.001, "the corner left the x axis");
  assert.ok(Math.abs(Math.min(...zs)) > 0.9, "the corner turned onto the z axis");
});
