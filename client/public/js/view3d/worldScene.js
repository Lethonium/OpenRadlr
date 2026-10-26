/**
 * The drawable part of a built world, and building it off the main thread.
 *
 * Building a map with several routes takes seconds; in a worker the ride
 * (trainer control, server updates) keeps running smoothly meanwhile. The
 * result is plain data with typed arrays, handed over without copying.
 */
import { RouteGeometry } from "../route/geometry.js";
import { roadNetworkOf } from "../route/worldMap.js";
import { buildWorld } from "./world.js";

/** What the view draws: meshes, chunks, the animated objects and the gyms' spots (no functions). */
export function sceneOf(world) {
  const { meshes, chunks, clouds, water, rivers, rotors, spectators, overview, gyms } = world;
  return { meshes, chunks, clouds, water, rivers, rotors, spectators, overview, gyms };
}

/** Every typed array buffer in `value`, for a zero-copy postMessage. */
export function transferList(value, found = new Set()) {
  if (ArrayBuffer.isView(value)) found.add(value.buffer);
  else if (Array.isArray(value)) for (const item of value) transferList(item, found);
  else if (value && typeof value === "object") for (const item of Object.values(value)) transferList(item, found);
  return [...found];
}

/** Builds the scene for `routeFile` and the `others` on its map (or its map's `network` file), synchronously. */
export function buildSceneNow(routeFile, others = [], network = null) {
  return sceneOf(
    buildWorld(new RouteGeometry(routeFile), {
      others: others.map((file) => new RouteGeometry(file)),
      network: network ? roadNetworkOf(network) : null,
    }),
  );
}

/**
 * Builds the scene in a module worker; falls back to building in place when
 * workers are unavailable or fail (older browsers, file:// pages).
 */
export function buildScene(routeFile, others = [], { network = null, createWorker = defaultWorker } = {}) {
  return new Promise((resolve) => {
    let worker = null;
    const fallback = (reason) => {
      worker?.terminate();
      if (reason) console.warn("Building the 3D world in place:", reason);
      resolve(buildSceneNow(routeFile, others, network));
    };
    try {
      worker = createWorker();
    } catch (error) {
      fallback(error);
      return;
    }
    if (!worker) {
      fallback(null);
      return;
    }
    worker.onmessage = ({ data }) => {
      worker.terminate();
      if (data?.scene) resolve(data.scene);
      else fallback(data?.error ?? "no scene");
    };
    worker.onerror = (event) => {
      event.preventDefault?.();
      fallback(event.message ?? "worker failed");
    };
    worker.postMessage({ route: routeFile, others, network });
  });
}

function defaultWorker() {
  if (typeof Worker === "undefined") return null;
  return new Worker(new URL("./worldWorker.js", import.meta.url), { type: "module", name: "world" });
}
