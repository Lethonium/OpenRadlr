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
 * @param {{id: string, kind?: string, map?: {id: string}}[]} deps.routes routes from /api/info
 */
export async function studioWorld({ routes, biome, fetchRouteFile, fetchNetwork, buildScene }) {
  const real = routes.filter((r) => r.kind === undefined && r.map);
  const onePerMap = [...new Map(real.map((r) => [r.map.id, r])).values()];
  const cafesByMap = new Map();
  await Promise.all(
    onePerMap.map(async (route) => {
      const file = await fetchMapNetwork(route, fetchNetwork);
      if (file) cafesByMap.set(route.map.id, (file.nodes ?? []).filter((node) => node.kind === "cafe"));
    }),
  );
  const id = studioRouteId(real, cafesByMap);
  if (!id) return null;

  const file = await fetchRouteFile(id);
  const route = new RouteGeometry(file);
  const [others, network] = await Promise.all([fetchMapNeighbours(route, routes, fetchRouteFile), fetchMapNetwork(route, fetchNetwork)]);
  const scene = await buildScene(file, others, { network, biome });
  if (!scene?.studio) return null;
  const known = new Map([[route.id, route]]);
  for (const other of others) known.set(other.id, new RouteGeometry(other));
  return { scene, route, routes: known, network: network ? roadNetworkOf(network) : null };
}
