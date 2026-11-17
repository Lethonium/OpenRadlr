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
import { kindOf, paletteColour, planFlora, recolour } from "../public/js/view3d/scenery/plan.js";

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
  provenance: { pack: "https://kenney.nl/assets/nature-kit", licence: "https://creativecommons.org/publicdomain/zero/1.0/", taken: "2026-11-16" },
  models: {
    pine: { role: "firs", height: 1, near: "pine" },
  },
};

/** A random source that always gives the same number. */
const fixed = (value) => () => value;

/** A kit read from memory: the world reads these from the imported files. */
const floraOf = (kit = KIT, options = {}) => planFlora(indexKit(kit), { readModelFile: () => MODEL, ...options });

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
  assert.deepEqual(kit.roles, ["firs"]);
  assert.equal(kit.byRole.firs.length, 1);
});

test("a kit that is not CC0 is refused, with its name", () => {
  const bad = { ...KIT, licence: "Quaternius-Asset-License" };
  assert.throws(() => indexKit(bad), /nature.*licence/is);
});

test("a model naming a variant the kit does not hold is refused", () => {
  const bad = { ...KIT, models: { pine: { role: "firs", near: "gone" } } };
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

test("an instanced target receives the shared model and its untouched placement transform", () => {
  const placed = [];
  const mesh = { instance(model, matrix) { placed.push({ model, matrix }); } };
  floraOf().tree({ mesh, x: 12, y: 3, z: -4, kind: 0.5, random: fixed(0.5) });
  assert.equal(placed.length, 1);
  assert.equal(placed[0].model.vertexCount, 6);
  assert.deepEqual(Array.from(placed[0].matrix.slice(12, 15)), [12, 3, -4]);
});

test("the flora asks the random for its size, so instances differ", () => {
  const flora = floraOf({ ...KIT, models: { pine: { role: "firs", near: "pine", sizes: [1, 3] } } });
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

test("a garden tree can be scaled down while a wood keeps its mature size", () => {
  const flora = floraOf();
  const heightOf = (scale) => {
    const mesh = new MeshBuilder();
    flora.tree({ mesh, x: 0, y: 0, z: 0, kind: 0.5, random: fixed(0.5), scale });
    const ys = Array.from(mesh.positions.data.slice(0, mesh.positions.length)).filter((_, i) => i % 3 === 1);
    return Math.round(Math.max(...ys));
  };
  // The test pine stands 4 m tall at scale 1; a garden tree at 0.45 is 1.8 m.
  assert.equal(heightOf(1), 4);
  assert.equal(heightOf(0.45), 2);
});

test("a kit with no model for the asked role draws nothing rather than crashing", () => {
  const flora = floraOf();
  const mesh = new MeshBuilder();
  flora.tree({ mesh, x: 0, y: 0, z: 0, kind: 0.5, random: fixed(0.5), role: "house" });
  assert.equal(mesh.vertexCount, 0);
});

test("a role the kit does not hold is left to the biome, so a kit need not cover everything", () => {
  // A pack with trees but no flowers should not turn every verge bare.
  const drawn = [];
  const fallback = { flower: (spot) => drawn.push(spot.x), tree: () => {}, tuft: () => {} };
  const flora = planFlora(indexKit(KIT), { readModelFile: () => MODEL, fallback });
  flora.flower({ mesh: new MeshBuilder(), x: 7, y: 0, z: 0, random: fixed(0.5) });
  assert.deepEqual(drawn, [7]);
});

test("a leaf colour takes the season's green, whether the pack made it green or teal", () => {
  // Kenney gives leaves as a teal and bark as a bright orange; both would look
  // like another island beside our own trees, so both are painted.
  const painted = { foliage: [0.16, 0.37, 0.22], bark: [0.38, 0.27, 0.18] };
  for (const leaf of [[0.169, 0.651, 0.671], [0.161, 0.788, 0.671]]) {
    const out = recolour(leaf, painted);
    assert.ok(out[1] > out[0] && out[1] > out[2], `the leaf is green, got ${out.map((v) => v.toFixed(2))}`);
  }
  const bark = recolour([0.886, 0.514, 0.341], painted);
  assert.ok(bark[0] > bark[1] && bark[1] > bark[2], "bark stays a warm brown");
  assert.ok(bark[0] < 0.5, `bark is the season's darker brown, got ${bark[0].toFixed(2)}`);
});

test("a colour that is neither leaf nor bark is left as the model made it", () => {
  const painted = { foliage: [0.16, 0.37, 0.22], bark: [0.38, 0.27, 0.18] };
  const stone = [0.5, 0.5, 0.5];
  assert.deepEqual(recolour(stone, painted), stone, "grey stone keeps its colour");
});

test("without a season colour, a model keeps every colour it was made with", () => {
  const leaf = [0.169, 0.651, 0.671];
  assert.deepEqual(recolour(leaf, null), leaf);
  assert.deepEqual(recolour(leaf, {}), leaf);
});

test("a kit with a cheap twin draws it beyond the near range, in the same place", () => {
  // The far copy is the same wood: same seeds, same spots, same sizes. Only the
  // model drawn differs, so swapping one for the other as a chunk passes the
  // near range never makes a tree move (#117).
  const withFar = {
    ...KIT,
    models: { pine: { role: "firs", file: "pine", far: "pine-far", height: 3, sizes: [1, 1] } },
  };
  const nearModel = { ...MODEL, name: "pine" };
  const farModel = { ...MODEL, name: "pine-far", triangles: MODEL.triangles.slice(0, 3), bounds: MODEL.bounds };
  const readModelFile = (id) => (id === "pine-far" ? farModel : nearModel);
  const flora = planFlora(indexKit(withFar), { readModelFile });

  const near = new MeshBuilder();
  const far = new MeshBuilder();
  const seed = () => {
    let s = 0.25;
    return () => (s = (s * 9301 + 49297) % 233280) / 233280;
  };
  const spots = [[12, 3, -4], [-40, 8, 21], [0, 0, 0]];
  for (const [x, y, z] of spots) {
    flora.tree({ mesh: near, x, y, z, kind: 0.5, random: seed() });
    flora.far().tree({ mesh: far, x, y, z, kind: 0.5, random: seed() });
  }
  // The far twin is one triangle per tree, the near model two.
  assert.equal(near.vertexCount, spots.length * 6);
  assert.equal(far.vertexCount, spots.length * 3, "the far copy drew the cheap twin");
  // Both copies of a tree start at the same point.
  const firstVertex = (mesh, corner) => Array.from(mesh.positions.data.slice(corner * 3, corner * 3 + 3));
  assert.deepEqual(firstVertex(far, 0), firstVertex(near, 0), "the far tree stands where the near one does");
});

test("a kit only thins the ground detail it actually draws", () => {
  // A kit with no tufts falls back to the biome's three-blade tufts. Thinning
  // those as if they were modelled tufts would leave the verge nearly bare.
  const noDetail = floraOf();
  assert.deepEqual(noDetail.detailDensity, {});
  const withTufts = floraOf({
    ...KIT,
    models: {
      ...KIT.models,
      tuft: { role: "tufts", near: "pine" },
      flower: { role: "flowers", near: "pine" },
    },
  });
  assert.deepEqual(withTufts.detailDensity, { tufts: 0.12, flowers: 0.5 });
  const flowersOnly = floraOf({ ...KIT, models: { ...KIT.models, flower: { role: "flowers", near: "pine" } } });
  assert.deepEqual(flowersOnly.detailDensity, { flowers: 0.5 });
});

test("a kit without a cheap twin draws no far wood at all", () => {
  // One level of detail means the near wood is the only wood: drawing a second
  // copy in the same place would double the cost and z-fight.
  assert.equal(floraOf().far(), null);
});

test("a building's cheap twin does not duplicate an otherwise single-LOD wood", () => {
  const townAndTrees = {
    ...KIT,
    models: {
      ...KIT.models,
      cottage: { role: "houses", near: "cottage", far: "cottage-far" },
    },
  };
  assert.equal(floraOf(townAndTrees).far(), null);
});

test("a scaled model stands where it was placed, not at its distance times its size", () => {
  // The placement matrix already holds the spot in 12..14. Scaling those too
  // moved every tree to `size` times its distance from the origin — a wood at
  // 800 m with a 9× model landed 7 km out to sea, and 96% of the scenery
  // vertices were drawn far outside the island.
  const flora = floraOf({ ...KIT, models: { pine: { role: "firs", near: "pine", height: 9 } } });
  const mesh = new MeshBuilder();
  flora.tree({ mesh, x: 800, y: 120, z: -300, kind: 0.5, random: fixed(0.5) });
  const p = Array.from(mesh.positions.data.slice(0, mesh.positions.length));
  const xs = p.filter((_, i) => i % 3 === 0);
  const ys = p.filter((_, i) => i % 3 === 1);
  // The pine is ±1 wide and 4 tall at 9×: within 9 of the spot it was given.
  assert.ok(Math.max(...xs) < 800 + 9.1 && Math.min(...xs) > 800 - 9.1, `x stayed near 800, got ${Math.min(...xs)}..${Math.max(...xs)}`);
  assert.ok(Math.min(...ys) >= 120 && Math.max(...ys) <= 120 + 36.1, `the tree stands on the ground at 120, got ${Math.min(...ys)}..${Math.max(...ys)}`);
  assert.ok(p.filter((_, i) => i % 3 === 2).every((z) => z > -300 - 9.1 && z < -300 + 9.1), "z stayed near -300");
});

test("the kinds the world asks for are drawn as the roles the kit names", () => {
  // `plantTree` draws rocks below 0.1, bushes below 0.28, firs below 0.62 and
  // leafies above; a kit keeps that mix rather than a wood of one model.
  assert.equal(kindOf(0.05), "rock");
  assert.equal(kindOf(0.2), "bush");
  assert.equal(kindOf(0.5), "fir");
  assert.equal(kindOf(0.9), "leafy");
});

test("trees are drawn by the role their kind names, not whichever role the kit lists first", () => {
  // A kit holds fences and bushes beside its firs; a fir must be a fir even
  // though "bushes" sorts before "firs".
  const kit = indexKit({
    ...KIT,
    models: {
      fence: { role: "bushes", near: "pine" },
      pine: { role: "firs", near: "pine" },
    },
  });
  const flora = planFlora(kit, { readModelFile: () => MODEL });
  const mesh = new MeshBuilder();
  flora.tree({ mesh, x: 0, y: 0, z: 0, kind: 0.5, random: fixed(0.5) });
  // The pine stands 4 tall; a fence-shaped answer would not.
  const ys = Array.from(mesh.positions.data.slice(0, mesh.positions.length)).filter((_, i) => i % 3 === 1);
  assert.equal(Math.max(...ys), 4);
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
