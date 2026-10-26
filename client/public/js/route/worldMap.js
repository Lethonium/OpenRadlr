/**
 * Routes on one shared map (ADR 0010, stage 1): route files with the same
 * `map.id` are drawn as one world. The server lists routes in /api/info; the
 * files say which map they belong to. A map with a road network (#26) also
 * has its network file at /api/map.
 */
import { RoadNetwork } from "./network.js";

/** Ids of the routes that might share `route`'s map: every other listed route (not the studio). */
export function mapCandidates(route, listed) {
  if (!route?.map) return [];
  return (listed ?? []).filter((r) => r.kind === undefined && r.id !== route.id).map((r) => r.id);
}

/**
 * Fetches the other route files on `route`'s map. A file that fails to load
 * or belongs to another map is left out: the world is drawn without it.
 * @param {{id: string, map?: {id: string} | null}} route
 * @param {{id: string, kind?: string}[]} listed routes from /api/info
 * @param {(id: string) => Promise<object>} fetchFile
 */
export async function fetchMapNeighbours(route, listed, fetchFile) {
  const files = await Promise.all(mapCandidates(route, listed).map((id) => fetchFile(id).catch(() => null)));
  return files.filter((file) => file && file.map?.id === route.map.id);
}

/**
 * The road network file of `route`'s map (#26), or null: routes without a
 * map, maps without a network, or a network that fails to load all fall
 * back to drawing the map from its route files.
 * @param {(mapId: string) => Promise<object>} fetchNetwork
 */
export async function fetchMapNetwork(route, fetchNetwork) {
  if (!route?.map || !fetchNetwork) return null;
  try {
    const file = await fetchNetwork(route.map.id);
    return file && file.id === route.map.id && Array.isArray(file.edges) ? file : null;
  } catch {
    return null;
  }
}

const built = new WeakMap();

/** The RoadNetwork for a network file, decoded once per file. */
export function roadNetworkOf(file) {
  if (!built.has(file)) built.set(file, new RoadNetwork(file));
  return built.get(file);
}
