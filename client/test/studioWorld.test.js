import { test } from "node:test";
import assert from "node:assert/strict";
import { studioWorld } from "../public/js/view/studioWorld.js";
import { tinyLoopFile, tinyNetworkFile } from "./helpers.js";

const valley = () => {
  const net = tinyNetworkFile();
  net.nodes[0].id = "valley-cafe";
  for (const edge of net.edges) {
    if (edge.from === "cafe") edge.from = "valley-cafe";
    if (edge.to === "cafe") edge.to = "valley-cafe";
  }
  return net;
};
const deps = (over = {}) => ({
  // As /api/info lists them: no map; that is in each route's file.
  routes: [{ id: "elsewhere" }, { id: "tiny-loop" }, { id: "studio", kind: "studio" }],
  biome: "temperate",
  fetchRouteFile: async (id) => (id === "tiny-loop" ? tinyLoopFile() : { ...tinyLoopFile(), id, map: { id: "other" } }),
  fetchNetwork: async (id) => (id === "tiny" ? valley() : { ...tinyNetworkFile(), id }),
  buildScene: async () => ({ studio: { position: [1, 2, 3], yaw: 0 } }),
  ...over,
});

test("the studio ride takes the world of the route on the map with the Valley Café", async () => {
  const world = await studioWorld(deps());
  assert.equal(world.route.id, "tiny-loop");
  assert.deepEqual([...world.routes.keys()], ["tiny-loop"]);
  assert.equal(world.network.edges.size > 0, true);
  assert.deepEqual(world.scene.studio.position, [1, 2, 3]);
});

test("there is no studio world without a Valley Café", async () => {
  assert.equal(await studioWorld(deps({ fetchNetwork: async (id) => ({ ...tinyNetworkFile(), id }) })), null);
  assert.equal(await studioWorld(deps({ routes: [{ id: "studio", kind: "studio" }] })), null);
});

test("there is no studio world when the built scene has no site", async () => {
  assert.equal(await studioWorld(deps({ buildScene: async () => ({ studio: null }) })), null);
});

test("a network that fails to load counts as no café", async () => {
  assert.equal(
    await studioWorld(
      deps({
        fetchNetwork: async () => {
          throw new Error("404");
        },
      }),
    ),
    null,
  );
});
