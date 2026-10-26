/** Module worker: builds the 3D world for a route (and its map) off the main thread. */
import { buildSceneNow, transferList } from "./worldScene.js";

self.onmessage = ({ data }) => {
  try {
    const scene = buildSceneNow(data.route, data.others ?? [], data.network ?? null);
    self.postMessage({ scene }, transferList(scene));
  } catch (error) {
    self.postMessage({ error: String(error?.message ?? error) });
  }
};
