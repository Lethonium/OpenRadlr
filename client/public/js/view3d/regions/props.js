/**
 * The roadside props of the island's regions (#117): dry-stone walls, picket
 * fences, mailboxes and the rest, low-poly and in real metres. Each draws at
 * `[x, y, z]` with `MeshBuilder` boxes and cylinders, lying along `yaw` (the
 * direction of the road, as an angle in the XZ plane) and returns the `radius`
 * it takes up. Only the stuff a rider sees from the saddle: no interiors.
 */

const STONES = [[0.62, 0.58, 0.5], [0.55, 0.51, 0.44], [0.68, 0.63, 0.54]];
const WOOD = [0.5, 0.36, 0.22];
const DARK_WOOD = [0.34, 0.25, 0.17];
const WHITE = [0.94, 0.93, 0.88];
const RED = [0.78, 0.16, 0.14];
const HAY = [0.86, 0.72, 0.36];
const HAY_END = [0.78, 0.64, 0.3];
const BARK = [0.42, 0.3, 0.2];
const LOG_END = [0.74, 0.58, 0.38];
const METAL = [0.35, 0.37, 0.4];
const BEE = [0.9, 0.78, 0.3];

/** A box lying along the prop's yaw: `at` is [along, up, across] from the prop's base. */
function part(mesh, { x, y, z, yaw }, at, size, color) {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const center = [x + c * at[0] - s * at[2], y + at[1], z + s * at[0] + c * at[2]];
  mesh.orientedBox(center, [c * size[0], 0, s * size[0]], [0, size[1], 0], [-s * size[2], 0, c * size[2]], color);
}

/** A post: a thin upright box standing from the base. */
function post(mesh, at, [along, across], height, width, color, sink = 0) {
  part(mesh, at, [along, (height - sink) / 2, across], [width, height + sink, width], color);
}

function stoneWall({ mesh, x, y, z, yaw, random }) {
  const at = { x, y, z, yaw };
  // Three pieces of the 6 m panel, each a little different in height and colour,
  // sunk into the ground so a slope does not show a gap below.
  for (let i = 0; i < 3; i += 1) {
    const height = 0.82 + random() * 0.14;
    const tone = STONES[Math.floor(random() * STONES.length)];
    part(mesh, at, [(i - 1) * 2, (height - 0.5) / 2, 0], [2, height + 0.5, 0.6], tone);
    part(mesh, at, [(i - 1) * 2 + (random() - 0.5) * 0.2, height + 0.03, 0], [1.9, 0.14, 0.7], STONES[(i + 1) % STONES.length]);
  }
  return { radius: 3.2 };
}

function picketFence({ mesh, x, y, z, yaw }) {
  const at = { x, y, z, yaw };
  for (const along of [-3, 0, 3]) post(mesh, at, [along, 0], 1.1, 0.12, WHITE, 0.3);
  for (const up of [0.4, 0.8]) part(mesh, at, [0, up, 0.07], [6, 0.08, 0.05], WHITE);
  for (let i = 0; i < 12; i += 1) part(mesh, at, [-2.75 + i * 0.5, 0.5, 0.1], [0.08, 0.9, 0.03], WHITE);
  return { radius: 3.2 };
}

function mailbox({ mesh, x, y, z, yaw }) {
  const at = { x, y, z, yaw };
  post(mesh, at, [0, 0], 1.05, 0.09, DARK_WOOD, 0.3);
  part(mesh, at, [0, 1.15, 0], [0.5, 0.25, 0.22], RED);
  part(mesh, at, [0.2, 1.3, 0.14], [0.03, 0.14, 0.03], WHITE);
  return { radius: 1 };
}

function beehive({ mesh, x, y, z, yaw, random }) {
  const at = { x, y, z, yaw };
  for (const across of [-0.5, 0.5]) {
    part(mesh, at, [0, 0.15, across], [0.5, 0.3, 0.1], DARK_WOOD);
  }
  const tiers = 2 + Math.floor(random() * 2);
  for (let i = 0; i < tiers; i += 1) part(mesh, at, [0, 0.4 + i * 0.22, 0], [0.5, 0.22, 0.42], i % 2 ? BEE : WHITE);
  part(mesh, at, [0, 0.4 + tiers * 0.22 + 0.03, 0], [0.58, 0.06, 0.5], DARK_WOOD);
  return { radius: 1 };
}

function cart({ mesh, x, y, z, yaw, random }) {
  const at = { x, y, z, yaw };
  part(mesh, at, [0, 0.75, 0], [2, 0.12, 1.1], WOOD);
  for (const side of [-1, 1]) part(mesh, at, [0, 1, side * 0.55], [2, 0.4, 0.08], WOOD);
  part(mesh, at, [1, 1, 0], [0.08, 0.4, 1.1], WOOD);
  part(mesh, at, [-1, 1, 0], [0.08, 0.4, 1.1], WOOD);
  // The two wheels stand on their rims, the shafts rest on the ground.
  for (const side of [-1, 1]) {
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    const base = [x - s * side * 0.62, y + 0.05, z + c * side * 0.62];
    const wheel = (rim) => mesh.orientedBox([base[0], base[1] + 0.45, base[2]], [c * rim, 0, s * rim], [0, 0.9, 0], [-s * 0.08, 0, c * 0.08], DARK_WOOD);
    wheel(0.9);
    wheel(0.1);
  }
  part(mesh, at, [1.6, 0.35, 0], [1.2, 0.07, 0.07], DARK_WOOD);
  if (random() < 0.5) part(mesh, at, [-0.2, 1.15, 0], [0.9, 0.4, 0.8], HAY);
  return { radius: 2.3 };
}

function bench({ mesh, x, y, z, yaw }) {
  const at = { x, y, z, yaw };
  for (const along of [-0.7, 0.7]) post(mesh, at, [along, 0], 0.45, 0.1, DARK_WOOD, 0.2);
  part(mesh, at, [0, 0.45, 0], [1.7, 0.07, 0.45], WOOD);
  part(mesh, at, [0, 0.8, 0.22], [1.7, 0.4, 0.06], WOOD);
  for (const along of [-0.7, 0.7]) part(mesh, at, [along, 0.65, 0.22], [0.08, 0.5, 0.08], DARK_WOOD);
  return { radius: 1.2 };
}

function hayBale({ mesh, x, y, z, yaw, random }) {
  // A round bale lying on its side: an 8-sided prism whose axis runs across the road.
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const count = random() < 0.4 ? 2 : 1;
  const radius = 0.7;
  const sides = 8;
  const edge = (cx, cz, angle, across) => {
    const out = Math.cos(angle) * radius;
    return [cx + c * out - s * across, y + radius + Math.sin(angle) * radius, cz + s * out + c * across];
  };
  for (let i = 0; i < count; i += 1) {
    const along = (i - (count - 1) / 2) * 1.6;
    const cx = x + c * along;
    const cz = z + s * along;
    for (let k = 0; k < sides; k += 1) {
      const a0 = (k / sides) * Math.PI * 2;
      const a1 = ((k + 1) / sides) * Math.PI * 2;
      mesh.quad(edge(cx, cz, a0, -0.6), edge(cx, cz, a1, -0.6), edge(cx, cz, a1, 0.6), edge(cx, cz, a0, 0.6), HAY);
      for (const end of [-0.6, 0.6]) {
        const centre = edge(cx, cz, 0, end);
        centre[0] -= c * radius;
        centre[2] -= s * radius;
        centre[1] = y + radius;
        if (end < 0) mesh.triangle(centre, edge(cx, cz, a1, end), edge(cx, cz, a0, end), HAY_END);
        else mesh.triangle(centre, edge(cx, cz, a0, end), edge(cx, cz, a1, end), HAY_END);
      }
    }
  }
  return { radius: 1.2 + (count - 1) * 0.8 };
}

function logPile({ mesh, x, y, z, yaw }) {
  const at = { x, y, z, yaw };
  // Stacked trunks lying along the road, two rows of three on one of two, with the cut ends toward the road.
  const rows = [3, 2, 1];
  rows.forEach((n, row) => {
    for (let i = 0; i < n; i += 1) {
      const across = (i - (n - 1) / 2) * 0.42;
      part(mesh, at, [0, 0.2 + row * 0.36, across], [2.4, 0.34, 0.4], BARK);
      part(mesh, at, [1.21, 0.2 + row * 0.36, across], [0.02, 0.28, 0.32], LOG_END);
    }
  });
  return { radius: 1.8 };
}

function cairn({ mesh, x, y, z, yaw, random }) {
  const at = { x, y, z, yaw };
  let size = 0.7;
  let lift = -0.1;
  for (let i = 0; i < 4; i += 1) {
    const drift = (random() - 0.5) * 0.1;
    part(mesh, at, [drift, lift + size * 0.25, drift], [size, size * 0.5, size * 0.9], STONES[i % STONES.length]);
    lift += size * 0.45;
    size *= 0.72;
  }
  return { radius: 0.8 };
}

function snowPole({ mesh, x, y, z, yaw }) {
  const at = { x, y, z, yaw };
  // A 2 m marker pole with a red and white band, so the road shows under snow.
  post(mesh, at, [0, 0], 2, 0.1, WHITE, 0.3);
  part(mesh, at, [0, 1.65, 0], [0.11, 0.35, 0.11], RED);
  part(mesh, at, [0, 1.15, 0], [0.11, 0.35, 0.11], RED);
  part(mesh, at, [0, 1.98, 0], [0.12, 0.05, 0.12], METAL);
  return { radius: 0.5 };
}

function boardwalk({ mesh, x, y, z, yaw }) {
  const at = { x, y, z, yaw };
  // 2 m wide planks laid across, on posts a little above the ground: 6 m of walk along the road.
  for (const along of [-2.6, 0, 2.6]) for (const across of [-0.9, 0.9]) post(mesh, at, [along, across], 0.5, 0.14, DARK_WOOD, 0.3);
  part(mesh, at, [0, 0.46, -0.8], [6, 0.08, 0.14], DARK_WOOD);
  part(mesh, at, [0, 0.46, 0.8], [6, 0.08, 0.14], DARK_WOOD);
  for (let i = 0; i < 8; i += 1) part(mesh, at, [-2.6 + i * 0.75, 0.54, 0], [0.6, 0.06, 2], i % 2 ? WOOD : [0.56, 0.42, 0.28]);
  return { radius: 3.2 };
}

export const PROPS = Object.freeze({ stoneWall, picketFence, mailbox, beehive, cart, bench, hayBale, logPile, cairn, snowPole, boardwalk });
