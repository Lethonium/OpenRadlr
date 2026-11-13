/**
 * The world a studio class is ridden in: the valley's, where the studio
 * building stands across from the Valley Café. Found the way the start menu
 * finds it (the first route on a map with that café), built like any ride's.
 */
import { RouteGeometry } from "../route/geometry.js";
import { fetchMapNeighbours, fetchMapNetwork, roadNetworkOf } from "../route/worldMap.js";
import { studioRouteId } from "./menuStage.js";

/**
 * `{scene, route, routes, network}` of the studio's world, or null when the
 * server has no valley (or its scene has no studio site): the caller then
 * rides in the room alone.
 * @param {object} deps
 * @param {{id: string, kind?: string}[]} deps.routes routes from /api/info (their maps are in their files)
 */
export async function studioWorld({ routes, biome, fetchRouteFile, fetchNetwork, buildScene }) {
  const found = await valleyRoute(routes, fetchRouteFile, fetchNetwork);
  if (!found) return null;
  const { file, network } = found;
  const route = new RouteGeometry(file);
  const others = await fetchMapNeighbours(route, routes, fetchRouteFile);
  const scene = await buildScene(file, others, { network, biome });
  if (!scene?.studio) return null;
  const known = new Map([[route.id, route]]);
  for (const other of others) known.set(other.id, new RouteGeometry(other));
  return { scene, route, routes: known, network: network ? roadNetworkOf(network) : null };
}

/**
 * The first offered route on a map with the Valley Café, with its file and its
 * map's network; each map's network is checked once. Null if there is none.
 */
async function valleyRoute(routes, fetchRouteFile, fetchNetwork) {
  const checked = new Set();
  for (const listed of routes.filter((r) => r.kind === undefined)) {
    const file = await fetchRouteFile(listed.id).catch(() => null);
    const mapId = file?.map?.id;
    if (!mapId || checked.has(mapId)) continue;
    checked.add(mapId);
    const network = await fetchMapNetwork(file, fetchNetwork);
    const cafes = new Map([[mapId, (network?.nodes ?? []).filter((node) => node.kind === "cafe")]]);
    if (studioRouteId([file], cafes)) return { file, network };
  }
  return null;
}

/** The riders of the studio scene: my room's in their seats, then the other floors and the road. */
export function studioSceneRiders(state) {
  return [...state.riders.map((rider) => ({ ...rider, route: null, studio: { room: state.room, seat: rider.seat } })), ...(state.road_riders ?? [])];
}
