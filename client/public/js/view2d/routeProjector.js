/** Where a world point lies against the route (distance along, offset beside), and the scenery that stands near it. */
const CELL = 60;
const BUILDINGS = new Set(["house", "farm", "cafe", "landmark"]);
/** Nothing stands this close to the centre line (but people at the roadside and the arches over it), and buildings keep at least this far behind the road. */
const ROAD_CLEAR_M = 3.5;
const BUILDING_LATERAL_M = -7;
const NEAR_SIDE_MAX_M = 22;

/**
 * `project(x, z, reach)` gives `{d, lateral, tx, tz}` for the nearest sampled point of the route within
 * `reach` metres (`lateral > 0`: right of travel), or null.
 */
export function routeProjector(route, step = 3) {
  const grid = new Map();
  for (let d = 0; d < route.length; d += step) {
    const p = route.positionAt(d);
    const q = route.positionAt(d + 1);
    const dx = q.x - p.x;
    const dz = -(q.y - p.y);
    const l = Math.hypot(dx, dz) || 1;
    const s = { d, x: p.x, z: -p.y, tx: dx / l, tz: dz / l };
    const key = `${Math.floor(s.x / CELL)},${Math.floor(s.z / CELL)}`;
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(s);
  }
  return {
    project(x, z, reach = 120) {
      let best = null;
      let bestSq = reach * reach;
      const ci = Math.floor(x / CELL);
      const cj = Math.floor(z / CELL);
      const r = Math.ceil(reach / CELL);
      for (let i = ci - r; i <= ci + r; i += 1) {
        for (let j = cj - r; j <= cj + r; j += 1) {
          for (const s of grid.get(`${i},${j}`) ?? []) {
            const sq = (s.x - x) ** 2 + (s.z - z) ** 2;
            if (sq < bestSq) {
              bestSq = sq;
              best = s;
            }
          }
        }
      }
      if (!best) return null;
      const rx = x - best.x;
      const rz = z - best.z;
      // Right of travel is (-tz, tx) in x/z (z points south).
      return { d: best.d + rx * best.tx + rz * best.tz, lateral: rx * -best.tz + rz * best.tx, tx: best.tx, tz: best.tz };
    },
  };
}

/**
 * Everything the side view draws beside the route, far side first: `{d, lateral, item, turn}`. `turn` is
 * how far a building's front is turned from the camera (0: faces it), folded into ±π/2.
 */
export function sideScenery(index, route, { behind = 70, front = NEAR_SIDE_MAX_M } = {}) {
  const projector = routeProjector(route);
  const reach = Math.max(behind, front);
  const found = new Set();
  for (let d = 0; d < route.length; d += 40) {
    const p = route.positionAt(d);
    for (const item of index.query(p.x - reach - 40, -p.y - reach - 40, p.x + reach + 40, -p.y + reach + 40)) found.add(item);
  }
  const entries = [];
  for (const item of found) {
    if (item.layer === "row" && item.id === "vine") continue;
    if (item.layer === "scrub" && item.id !== "bush" && item.id !== "lavender") continue;
    const pr = projector.project(item.x, item.z, reach);
    if (!pr || pr.lateral < -behind || pr.lateral > front) continue;
    if (Math.abs(pr.lateral) < ROAD_CLEAR_M && item.layer !== "person" && item.layer !== "arch") continue;
    const building = BUILDINGS.has(item.layer);
    if (building && pr.lateral > 0) continue; // on the near side it would hide the road
    if (!building && pr.lateral > 0 && item.layer === "tree" && (Math.floor(item.x * 7 + item.z * 3) & 3) !== 0) continue;
    let turn = 0;
    if (item.facing) {
      const cx = -pr.tz; // the camera looks from the right of travel
      const cz = pr.tx;
      turn = Math.atan2(item.facing[0] * cz - item.facing[1] * cx, item.facing[0] * cx + item.facing[1] * cz);
      if (turn > Math.PI / 2) turn -= Math.PI;
      else if (turn < -Math.PI / 2) turn += Math.PI;
    }
    entries.push({ d: pr.d, lateral: building ? Math.min(BUILDING_LATERAL_M, pr.lateral) : pr.lateral, item, turn });
  }
  return entries.sort((a, b) => a.lateral - b.lateral);
}
