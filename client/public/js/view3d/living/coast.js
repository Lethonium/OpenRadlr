/**
 * The Living island's shore: beach huts, parasols and towels, a wooden jetty,
 * boats on their moorings and rocks at the waterline.
 */
const STEP_DEGREES = 2;
const JETTY_LENGTH = 90;
const JETTY_STEP = 6;

const onBeach = (land) => land === "sand" || land === "dunes";

/** A number in [0, 1) from two integers. */
function scramble(a, b) {
  let h = Math.imul(a, 2654435761) ^ Math.imul(b, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * Sandy places all around the island: one every few degrees where there is a
 * beach, with the unit vector out to sea.
 */
export function coastSpots(fields, terrain, seed) {
  const { island } = terrain;
  const spots = [];
  const start = scramble(seed, 31) * STEP_DEGREES;
  for (let degrees = start; degrees < 360; degrees += STEP_DEGREES) {
    const angle = (degrees * Math.PI) / 180;
    const seaward = [Math.cos(angle), Math.sin(angle)];
    const coast = island.radiusAt(angle);
    for (let inland = 2; inland <= 90; inland += 4) {
      const x = island.center[0] + seaward[0] * (coast - inland);
      const z = island.center[1] + seaward[1] * (coast - inland);
      if (fields.landAt(x, z) === "sand") {
        spots.push({ x, z, seaward });
        break;
      }
    }
  }
  return spots;
}

/** Where everything on the shore stands, as plain data. */
export function planCoast(ctx) {
  const { fields, terrain, keepClear, random, water, seed } = ctx;
  const spots = coastSpots(fields, terrain, seed);
  const plan = { huts: [], parasols: [], boats: [], rocks: [], jetty: { points: [] } };
  if (spots.length === 0) return plan;

  const free = (x, z, radius) => onBeach(fields.landAt(x, z)) && !keepClear(x, z, radius);

  for (const [n, spot] of spots.entries()) {
    const tangent = [-spot.seaward[1], spot.seaward[0]];
    if (n % 4 === 0) {
      const count = 3 + Math.floor(random() * 3);
      for (let k = 0; k < count; k += 1) {
        const x = spot.x + tangent[0] * k * 8;
        const z = spot.z + tangent[1] * k * 8;
        if (free(x, z, 3)) plan.huts.push({ x, z, seaward: spot.seaward, color: Math.floor(random() * 4) });
      }
    } else if (n % 2 === 1) {
      for (let k = 0; k < 8; k += 1) {
        const x = spot.x + tangent[0] * (random() - 0.5) * 60;
        const z = spot.z + tangent[1] * (random() - 0.5) * 60;
        if (free(x, z, 1.5)) plan.parasols.push({ x, z, color: Math.floor(random() * 4) });
      }
    }
    if (n % 9 === 4) {
      for (let out = 10; out < 260; out += 8) {
        const x = spot.x + spot.seaward[0] * out;
        const z = spot.z + spot.seaward[1] * out;
        const depth = water - terrain.height(x, z);
        if (depth > 1.2 && depth < 5 && !keepClear(x, z, 3)) {
          plan.boats.push({ x, z, yaw: random() * Math.PI * 2, color: Math.floor(random() * 4) });
          break;
        }
      }
    }
    if (n % 5 === 1 && !keepClear(spot.x, spot.z, 2)) {
      const x = spot.x + spot.seaward[0] * 14;
      const z = spot.z + spot.seaward[1] * 14;
      plan.rocks.push({ x, z, size: 0.8 + random() * 1.4 });
    }
  }

  // The jetty at the spot nearest a place people gather, reaching out into the water.
  const places = ctx.cafes ?? [];
  const nearest = (spot) => (places.length ? Math.min(...places.map(([x, , z]) => Math.hypot(x - spot.x, z - spot.z))) : 0);
  const clear = spots.filter((spot) => !keepClear(spot.x, spot.z, 2));
  if (clear.length > 0) {
    const spot = clear.reduce((best, s) => (nearest(s) < nearest(best) ? s : best));
    for (let along = 0; along <= JETTY_LENGTH; along += JETTY_STEP) plan.jetty.points.push([spot.x + spot.seaward[0] * along, spot.z + spot.seaward[1] * along]);
    plan.jetty.spot = spot;
  }
  return plan;
}

function buildHut(mesh, { x, z, seaward, color }, y, paint, woodLight) {
  const u = [-seaward[1] * 2.6, 0, seaward[0] * 2.6];
  const w = [seaward[0] * 2.8, 0, seaward[1] * 2.8];
  mesh.orientedBox([x, y + 1.3, z], u, [0, 2.6, 0], w, woodLight);
  mesh.orientedBox([x, y + 2.75, z], [u[0] * 1.2, 0, u[2] * 1.2], [0, 0.3, 0], [w[0] * 1.2, 0, w[2] * 1.2], paint[color % paint.length]);
  mesh.orientedBox([x + seaward[0] * 1.42, y + 1, z + seaward[1] * 1.42], [u[0] * 0.3, 0, u[2] * 0.3], [0, 2, 0], [seaward[0] * 0.05, 0, seaward[1] * 0.05], paint[(color + 1) % paint.length]);
}

function buildParasol(mesh, { x, z, color }, y, paint, woodLight) {
  mesh.box([x, y + 1.2, z], [0.08, 2.4, 0.08], woodLight);
  mesh.cone([x, y + 2.1, z], 1.5, 0.5, paint[color % paint.length], 7);
  mesh.box([x + 1.2, y + 0.04, z], [1.8, 0.05, 0.8], paint[(color + 2) % paint.length]);
}

function buildBoat(mesh, { x, z, yaw, color }, water, paint, woodLight) {
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  const u = [3.4 * cos, 0, 3.4 * sin];
  const w = [-1.3 * sin, 0, 1.3 * cos];
  mesh.orientedBox([x, water + 0.3, z], u, [0, 0.7, 0], w, paint[color % paint.length]);
  mesh.orientedBox([x, water + 0.72, z], [u[0] * 0.8, 0, u[2] * 0.8], [0, 0.1, 0], [w[0] * 0.8, 0, w[2] * 0.8], woodLight);
  mesh.box([x, water + 2.2, z], [0.08, 3, 0.08], woodLight);
}

function buildJetty(mesh, { points }, terrain, water, wood, woodLight) {
  for (let i = 0; i + 1 < points.length; i += 1) {
    const [ax, az] = points[i];
    const [bx, bz] = points[i + 1];
    const deck = water + 1.3;
    mesh.segment([ax, deck, az], [bx, deck, bz], 2.2, 0.14, woodLight);
    for (const side of [-1, 1]) {
      const nx = (-(bz - az) / JETTY_STEP) * side;
      const nz = ((bx - ax) / JETTY_STEP) * side;
      const px = ax + nx * 1.05;
      const pz = az + nz * 1.05;
      const bed = Math.min(terrain.height(px, pz), deck);
      mesh.box([px, (bed + deck) / 2, pz], [0.18, deck - bed + 0.4, 0.18], wood);
    }
  }
}

/** Builds the shore into `ctx.mesh`, stopping before `limit` vertices. */
export function buildCoast(ctx, limit) {
  const { mesh, terrain, water, biome } = ctx;
  const start = mesh.vertexCount;
  const size = () => mesh.vertexCount - start;
  const plan = planCoast(ctx);
  const { paint, wood, woodLight, wall } = biome.living;
  const fits = (vertices) => size() + vertices <= limit;
  if (plan.jetty.points.length > 0 && fits(1500)) buildJetty(mesh, plan.jetty, terrain, water, wood, woodLight);
  for (const hut of plan.huts) {
    if (!fits(120)) return size();
    buildHut(mesh, hut, terrain.height(hut.x, hut.z), paint, woodLight);
  }
  for (const parasol of plan.parasols) {
    if (!fits(110)) return size();
    buildParasol(mesh, parasol, terrain.height(parasol.x, parasol.z), paint, woodLight);
  }
  for (const boat of plan.boats) {
    if (!fits(120)) return size();
    buildBoat(mesh, boat, water, paint, woodLight);
  }
  for (const rock of plan.rocks) {
    if (!fits(40)) return size();
    mesh.cone([rock.x, terrain.height(rock.x, rock.z) - 0.2, rock.z], rock.size, rock.size * 1.1, wall[0], 6, rock.size);
  }
  return size();
}
