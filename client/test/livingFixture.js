// A small fake island for the Living modules' unit tests: quick to build, with one straight road through its centre.

/** Default ground: a low plateau falling to the sea at `radius`. */
const plateau = (radius) => (x, z) => {
  const inland = radius - Math.hypot(x, z);
  return inland > 0 ? Math.min(40, inland * 0.12) : inland * 0.05;
};

/** One straight road along x through the origin, at height 20. */
function fakeRoute(radius) {
  return {
    id: "fake",
    lanes: 2,
    length: 2 * radius,
    seed: 11,
    wrap: (d) => d,
    positionAt: (d) => ({ x: d - radius, y: 0 }),
    elevationAt: () => 20,
    gradeAt: () => 0,
  };
}

function fakeIndex(route) {
  const samples = [];
  for (let d = 0; d < route.length; d += 10) {
    const { x, y } = route.positionAt(d);
    samples.push({ x, z: -y, elevation: 20, distance: d, route });
  }
  return {
    samples,
    center: [0, 0],
    nearest(x, z, rings = 2) {
      const reach = (rings + 0.5) * 100;
      if (Math.abs(z) > reach || Math.abs(x) > route.length / 2 + reach) return null;
      const clamped = Math.max(-route.length / 2, Math.min(route.length / 2 - 10, Math.round(x / 10) * 10));
      const sample = samples[Math.round((clamped + route.length / 2) / 10)];
      return { sample, distance: Math.hypot(sample.x - x, sample.z - z) };
    },
  };
}

/**
 * @param {{radius?: number, seed?: number, height?: (x: number, z: number) => number, riverDistance?: (x: number, z: number) => number}} [options]
 */
export function fakeIsland({ radius = 1500, seed = 7, height = plateau(radius), riverDistance = () => Infinity } = {}) {
  const route = fakeRoute(radius);
  const index = fakeIndex(route);
  return {
    seed,
    seaLevel: 0,
    index,
    route,
    bounds: { minX: -radius, maxX: radius, minY: -radius, maxY: radius },
    island: { center: [0, 0], radiusAt: () => radius, cliffAt: () => 0, inland: (x, z) => radius - Math.hypot(x, z) },
    height,
    riverDistance,
    distanceToRoad: (x, z) => index.nearest(x, z)?.distance ?? 10_000,
  };
}

/** The square box around a fake island, with some sea around it. */
export const boxOf = (terrain, margin = 100) => {
  const r = terrain.bounds.maxX + margin;
  return { x0: -r, z0: -r, x1: r, z1: r };
};
