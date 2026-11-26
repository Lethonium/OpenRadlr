import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import * as THREE from "../public/js/three.js";
import { createSharedUniforms } from "../public/js/view3d/assets/materials.js";
import { triangleCount } from "../public/js/view3d/assets/geom.js";
import { POST_KINDS, roadPostGeometry } from "../public/js/view3d/assets/props/roadPost.js";
import { bridgeGeometry } from "../public/js/view3d/assets/props/bridge.js";
import { FLOATERS } from "../public/js/view3d/assets/props/index.js";
import { resolveBiome } from "../public/js/view3d/biomes/index.js";
import { buildRoadPosts } from "../public/js/view3d/roadPosts.js";
import { roadStyle } from "../public/js/view3d/roadStyle.js";
import { buildWorld } from "../public/js/view3d/world.js";
import { sceneOf, transferList } from "../public/js/view3d/worldScene.js";
import { createRiverLayer } from "../public/js/view3d/scene/riverLayer.js";
import { createRoadLayer } from "../public/js/view3d/scene/roadLayer.js";
import { createTracker } from "../public/js/view3d/scene/tracker.js";
import { qualitySettings } from "../public/js/view3d/quality.js";
import { RouteGeometry } from "../public/js/route/geometry.js";
import { ROAD_LIFT, VERGE, roadFrame, roadHalfWidth } from "../public/js/world/roads.js";
import { roadStrips } from "../public/js/world/plan/roadStrips.js";
import { riverStrips } from "../public/js/world/plan/riverStrips.js";
import { squareRoute } from "./helpers.js";
import { tinyWorld } from "./support/planFixture.js";

const temperate = resolveBiome("temperate");
const winter = resolveBiome("winter");
const options = (track) => ({ settings: qualitySettings("high"), uniforms: createSharedUniforms(), track });

/** A route as long as the km marks need: a straight kilometre and a bit. */
const longRoad = () => new RouteGeometry({ id: "straight", name: "Straight", lanes: 2, seed: 3, points: [[0, 0, 50], [1200, 0, 50], [1200, 30, 50]], markers: [{ type: "start_finish", distance: 0 }] });
const flats = () => new RouteGeometry(JSON.parse(readFileSync(new URL("../../routes/riverside-flats.json", import.meta.url))));

// --- where the posts stand -------------------------------------------------------------

test("a post stands every 50 m on alternating sides, a pair at each kilometre", () => {
  const road = longRoad();
  const posts = buildRoadPosts(road, { biome: temperate });
  const half = roadHalfWidth(road.lanes) + VERGE + 0.3;
  const first = roadFrame(road, 25);
  const round = (v) => +v.toFixed(6);
  assert.deepEqual(posts[0].position.map(round), [0, 1, 2].map((k) => round(first.center[k] - first.right[k] * half)), "d = 25 m is within 26 m of the start: a pair, left first");
  assert.deepEqual(posts[1].position.map(round), [0, 1, 2].map((k) => round(first.center[k] + first.right[k] * half)));
  const second = roadFrame(road, 75);
  assert.deepEqual(posts[2].position.map(round), [0, 1, 2].map((k) => round(second.center[k] + second.right[k] * half)), "d = 75 m: right of the road");
  assert.deepEqual(posts.slice(0, 3).map((post) => post.kind), ["kmPost", "kmPost", "post"]);
  assert.equal(posts.filter((post) => post.kind === "kmPost").length, 10, "pairs at 25 m, 975 m, 1025 m, 1975 m and 2025 m");
  assert.equal(posts.filter((post) => post.kind === "post").length, posts.length - 10);
  for (const post of posts) assert.equal(post.position.length, 3);
});

test("the reflector faces the road: yaw turns the post's +x towards it", () => {
  const road = squareRoute();
  const frames = Array.from({ length: Math.floor(road.length / 50) }, (_, k) => roadFrame(road, 25 + k * 50));
  const gap = (f, post) => Math.hypot(f.center[0] - post.position[0], f.center[2] - post.position[2]);
  for (const post of buildRoadPosts(road, { biome: temperate })) {
    const frame = frames.reduce((best, f) => (gap(f, post) < gap(best, post) ? f : best));
    const toward = [Math.cos(post.yaw), -Math.sin(post.yaw)];
    assert.ok(Math.abs(Math.abs(toward[0] * frame.right[0] + toward[1] * frame.right[2]) - 1) < 1e-6, "across the road");
    assert.ok((frame.center[0] - post.position[0]) * toward[0] + (frame.center[2] - post.position[2]) * toward[1] > 0, "towards the centre line");
  }
});

test("posts the other road drew are skipped and posts on another road are cleared", () => {
  const road = longRoad();
  const all = buildRoadPosts(road, { biome: temperate });
  const skipped = buildRoadPosts(road, { biome: temperate, skip: (d) => d < 500 });
  assert.equal(skipped.length, all.length - 11, "ten stretches of 50 m left out, the first with its pair");
  const cleared = buildRoadPosts(road, { biome: temperate, clear: () => true });
  assert.equal(cleared.length, 0);
});

test("a biome's own marker replaces the plain post, unless the route is too long for detail", () => {
  const road = longRoad();
  const detailed = buildRoadPosts(road, { biome: winter });
  assert.ok(detailed.every((post) => post.kind === "marker" || post.kind === "kmMarker"), "winter's posts are snowmen");
  assert.ok(detailed.every((post) => post.yaw === 0), "a snowman stands as it is");
  assert.equal(detailed.filter((post) => post.kind === "kmMarker").length, 10);
  const coarse = buildRoadPosts(road, { biome: winter, detail: false });
  assert.ok(coarse.every((post) => post.kind === "post" || post.kind === "kmPost"), "plain posts on a long route");
  assert.ok(coarse.every((post) => !post.capped), "and no cap");
  assert.ok(buildRoadPosts(road, { biome: temperate }).every((post) => !post.capped), "temperate has no cap of snow");
});

test("winter's plain posts wear a snow cap when the route has detail", () => {
  assert.ok(winter.road.postCap, "the biome names a cap");
  const bare = roadPostGeometry("post", winter.road, { capped: false });
  const snowy = roadPostGeometry("post", winter.road, { capped: true });
  assert.equal(triangleCount(snowy), triangleCount(bare) + 12, "the cap is a box on top");
});

// --- the posts as shapes ---------------------------------------------------------------

test("every post kind is a vertex-coloured shape standing on the ground", () => {
  for (const kind of POST_KINDS) {
    const geometry = roadPostGeometry(kind, winter.road, { capped: false });
    assert.ok(geometry.attributes.color && geometry.attributes.position.count > 0, kind);
    geometry.computeBoundingBox();
    assert.ok(Math.abs(geometry.boundingBox.min.y) < 1e-6, `${kind} stands on y = 0`);
  }
});

test("a kilometre post differs from an ordinary one in colour only", () => {
  for (const [ordinary, kilometre] of [["post", "kmPost"], ["marker", "kmMarker"]]) {
    const a = roadPostGeometry(ordinary, winter.road, { capped: false });
    const b = roadPostGeometry(kilometre, winter.road, { capped: false });
    assert.equal(a.attributes.position.count, b.attributes.position.count, ordinary);
    assert.deepEqual(Array.from(a.attributes.position.array), Array.from(b.attributes.position.array), ordinary);
    assert.notDeepEqual(Array.from(a.attributes.color.array), Array.from(b.attributes.color.array), ordinary);
  }
});

test("a plain post is three boxes and the reflector, a snowman its balls, face, arms, scarf and hat", () => {
  assert.equal(triangleCount(roadPostGeometry("post", temperate.road, { capped: false })), 3 * 12);
  assert.equal(triangleCount(roadPostGeometry("post", winter.road, { capped: true })), 4 * 12);
  // three snowballs (24 triangles each), two eyes, a nose, two arms, a scarf, a scarf end (12 each) and the hat (12 for a six-sided cone).
  assert.equal(triangleCount(roadPostGeometry("marker", winter.road, { capped: false })), 3 * 24 + 7 * 12 + 12);
});

// --- the world's placement data ----------------------------------------------------------

test("the world gives the road's posts as placements, the same in every biome", () => {
  const route = flats();
  const warm = buildWorld(route);
  const cold = buildWorld(route, { biome: "winter" });
  assert.ok(Array.isArray(warm.roads.posts));
  assert.equal(warm.roads.posts.length, 186, "none on the bridges");
  assert.equal(cold.roads.posts.length, 186);
  assert.deepEqual(cold.roads.posts.map((post) => post.position), warm.roads.posts.map((post) => post.position), "the same spots");
  assert.ok(warm.roads.posts.every((post) => post.kind === "post" || post.kind === "kmPost"));
  assert.ok(cold.roads.posts.every((post) => post.kind === "marker" || post.kind === "kmMarker"));
});

test("the world gives each bridge as boxes with colours, ready to hand over", () => {
  const { bridges } = buildWorld(flats()).rivers;
  assert.equal(bridges.boxes.length / 12, 434, "a deck with parapets, two piers and arches, per bridge");
  assert.equal(bridges.colors.length / 3, 434);
  const scene = sceneOf(buildWorld(flats()));
  const buffers = transferList(scene);
  assert.ok(buffers.includes(scene.rivers.bridges.boxes.buffer), "the boxes travel without copying");
  assert.ok(buffers.includes(scene.rivers.bridges.colors.buffer));
});

test("the bridge colours are the biome's stone and dark stone", () => {
  const { bridges } = buildWorld(flats()).rivers;
  const colours = new Set();
  for (let i = 0; i < bridges.colors.length; i += 3) colours.add(Array.from(bridges.colors.subarray(i, i + 3)).map((v) => +v.toFixed(4)).join());
  const { stone, stoneDark } = temperate.palette;
  assert.deepEqual([...colours].sort(), [stone, stoneDark].map((c) => c.map((v) => +Math.fround(v).toFixed(4)).join()).sort());
});

test("the bridge geometry is one box per entry, in place and in colour", () => {
  const boxes = new Float32Array([10, 5, 20, 2, 0, 0, 0, 1, 0, 0, 0, 3]);
  const geometry = bridgeGeometry({ boxes, colors: new Float32Array([0.5, 0.25, 0.125]) });
  assert.equal(triangleCount(geometry), 12);
  geometry.computeBoundingBox();
  assert.deepEqual(geometry.boundingBox.min.toArray(), [9, 4.5, 18.5]);
  assert.deepEqual(geometry.boundingBox.max.toArray(), [11, 5.5, 21.5]);
  assert.deepEqual(Array.from(geometry.attributes.color.array.subarray(0, 3)), [0.5, 0.25, 0.125]);
});

test("a box whose edges are left-handed still faces outwards", () => {
  const boxes = new Float32Array([0, 0, 0, 2, 0, 0, 0, 2, 0, 0, 0, -2]);
  const geometry = bridgeGeometry({ boxes, colors: new Float32Array([1, 1, 1]) });
  const normal = new THREE.Vector3();
  const [a, b, c] = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const position = geometry.attributes.position;
  for (let t = 0; t < triangleCount(geometry); t += 1) {
    a.fromBufferAttribute(position, t * 3);
    b.fromBufferAttribute(position, t * 3 + 1);
    c.fromBufferAttribute(position, t * 3 + 2);
    normal.crossVectors(b.clone().sub(a), c.clone().sub(a));
    const centre = a.clone().add(b).add(c).divideScalar(3);
    assert.ok(normal.dot(centre) > 0, "outwards");
  }
});

// --- the layers --------------------------------------------------------------------------

const roadsWith = (posts, biome = temperate) => ({ strips: roadStrips(squareRoute(), { lift: ROAD_LIFT.ridden }), style: roadStyle(biome), posts });

test("the road layer draws each kind of post as one instanced mesh per area, with the placements' count", () => {
  const road = longRoad();
  const posts = buildRoadPosts(road, { biome: temperate });
  const tracker = createTracker();
  const layer = createRoadLayer(roadsWith(posts), options(tracker.track));
  const meshes = layer.object.children.filter((mesh) => mesh.name.startsWith("road-posts"));
  assert.ok(meshes.every((mesh) => mesh.isInstancedMesh));
  assert.equal(meshes.reduce((sum, mesh) => sum + mesh.count, 0), posts.length, "every post is drawn once");
  const kinds = new Set(posts.map((post) => post.kind));
  const areas = new Set(posts.map((post) => `${Math.floor(post.position[0] / 500)},${Math.floor(post.position[2] / 500)}`));
  assert.ok(meshes.length <= kinds.size * areas.size, `${meshes.length} draw calls`);
  assert.ok(meshes.length >= kinds.size);
  layer.dispose();
  assert.equal(tracker.live(), 0);
});

test("a post is drawn at its place, turned by its yaw", () => {
  const posts = [{ position: [10, 2, -30], yaw: Math.PI / 2, kind: "post", capped: false }];
  const layer = createRoadLayer(roadsWith(posts), options(createTracker().track));
  const mesh = layer.object.children.find((m) => m.name.startsWith("road-posts"));
  const matrix = new THREE.Matrix4();
  mesh.getMatrixAt(0, matrix);
  const position = new THREE.Vector3().setFromMatrixPosition(matrix);
  assert.deepEqual(position.toArray(), [10, 2, -30]);
  const x = new THREE.Vector3(1, 0, 0).transformDirection(matrix);
  assert.ok(Math.abs(x.x) < 1e-6 && Math.abs(x.z + 1) < 1e-6, "+x turned to -z by a quarter turn");
  layer.dispose();
});

test("a road with no posts draws none", () => {
  for (const posts of [null, []]) {
    const layer = createRoadLayer(roadsWith(posts), options(createTracker().track));
    assert.equal(layer.object.children.filter((mesh) => mesh.name.startsWith("road-posts")).length, 0);
    layer.dispose();
  }
});

test("the river layer draws all bridges in one vertex-coloured mesh", () => {
  const world = buildWorld(flats());
  const tracker = createTracker();
  const layer = createRiverLayer(world.rivers, options(tracker.track));
  const bridges = layer.object.children.filter((mesh) => mesh.name === "river-bridges");
  assert.equal(bridges.length, 1);
  assert.equal(triangleCount(bridges[0].geometry), 434 * 12);
  assert.ok(bridges[0].castShadow && bridges[0].receiveShadow);
  layer.dispose();
  assert.equal(tracker.live(), 0);
  const none = createRiverLayer({ strips: riverStrips(tinyWorld().rivers), bridges: null, style: { color: [0.2, 0.4, 0.6] } }, options(createTracker().track));
  assert.equal(none.object.getObjectByName("river-bridges"), undefined);
});

test("the workbench has the road post and the bridge", () => {
  for (const id of ["road-post", "bridge"]) {
    assert.ok(FLOATERS[id], id);
    assert.equal(FLOATERS[id].meta.id, id);
    const tracker = createTracker();
    const made = FLOATERS[id].create({ season: "summer", track: tracker.track });
    assert.ok(made.object.children.length > 0, id);
    made.dispose();
    assert.equal(tracker.live(), 0, id);
  }
});

test("no post stands on a bridge, where the parapets run", async () => {
  const { RIVER } = await import("../public/js/world/rivers.js");
  const world = buildWorld(flats());
  const onRiver = world.roads.posts.filter(({ position: [x, , z] }) => world.terrain.riverDistance(x, z) < RIVER.halfWidth + RIVER.bank);
  assert.deepEqual(onRiver, []);
});
