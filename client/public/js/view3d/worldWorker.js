/** Module worker: builds the 3D world for a route (and its map) off the main thread. */
import { floraOf } from "./scenery/flora.js";
import { buildSceneNow, transferList } from "./worldScene.js";

self.onmessage = ({ data }) => {
  try {
    const biome = data.biome ?? "temperate";
    const scene = buildSceneNow(data.route, data.others ?? [], data.network ?? null, biome, floraOf(data.scenes, biome));
    self.postMessage({ scene }, transferList(scene));
  } catch (error) {
    self.postMessage({ error: String(error?.message ?? error) });
  }
};
