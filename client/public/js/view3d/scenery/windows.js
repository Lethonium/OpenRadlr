/**
 * The window openings of a house model (#117).
 *
 * A kit house is a shell: its windows are holes in the wall, framed but with
 * no glass. The town light fills them, but a quad placed at the model's
 * bounding box sits in front of the facade (the bounds include the roof
 * overhang) and a random spot on the wall is just a square. This finds the
 * real openings once per model: the outer wall plane on the street-facing
 * side, the wall's width, and each hole in it, in model-local metres.
 *
 * The detection is geometric and colour-blind enough to survive every kit
 * house: the wall is the most common colour on the outer facade, and the
 * openings are the empty regions enclosed by the frames and trim.
 */

/** The grid the facade is rasterised on, in metres. */
const STEP = 0.05;
/** A wall-plane triangle is within this of the chosen plane. */
const PLANE_GAP = 0.12;

const cache = new WeakMap();

/**
 * @param {object} mesh a built model mesh (`positions`, `normals`, `colors`)
 * @returns {null | {facade: number, wallWidth: number, height: number, windows: {x: number, y: number, width: number, height: number}[]}}
 *   `facade` is the distance from the model's centre to its street wall;
 *   window `x` and `y` are model-local metres (y from the model's base).
 */
export function facadeWindows(mesh) {
  if (!mesh?.positions || !mesh?.normals || !mesh?.colors) return null;
  if (cache.has(mesh)) return cache.get(mesh);
  const found = detect(mesh);
  cache.set(mesh, found);
  return found;
}

function detect(mesh) {
  const { positions, normals, colors } = mesh;
  const triangles = [];
  for (let i = 0; i < positions.length; i += 9) {
    // Colours have four floats per vertex, positions three.
    const c = (i / 9) * 12;
    // Only the street-facing side: the model's local -Z.
    if (normals[i + 2] > -0.85) continue;
    const ax = positions[i], ay = positions[i + 1], az = positions[i + 2];
    const bx = positions[i + 3], by = positions[i + 4], bz = positions[i + 5];
    const cx = positions[i + 6], cy = positions[i + 7], cz = positions[i + 8];
    const z = (az + bz + cz) / 3;
    if (z > -0.5) continue;
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const area = Math.hypot(nx, ny, nz) / 2;
    triangles.push({
      z,
      area,
      x0: Math.min(ax, bx, cx),
      x1: Math.max(ax, bx, cx),
      y0: Math.min(ay, by, cy),
      y1: Math.max(ay, by, cy),
      corners: [ax, ay, bx, by, cx, cy],
      colour: [colors[c], colors[c + 1], colors[c + 2]],
    });
  }
  if (triangles.length === 0) return null;

  // The wall is the largest surface on this side, so its colour is the one
  // covering the most area; the roof overhang and the frames are other
  // colours. Then the outer wall plane is the most negative plane of that
  // colour (the wall has thickness, and both faces share it).
  const areas = new Map();
  for (const triangle of triangles) {
    const key = triangle.colour.map((c) => c.toFixed(2)).join(",");
    areas.set(key, (areas.get(key) ?? 0) + triangle.area);
  }
  const wallColour = [...areas.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const planes = new Map();
  for (const triangle of triangles) {
    if (triangle.colour.map((c) => c.toFixed(2)).join(",") !== wallColour) continue;
    const plane = Math.round(triangle.z / STEP) * STEP;
    planes.set(plane, (planes.get(plane) ?? 0) + triangle.area);
  }
  const most = Math.max(...planes.values());
  let plane = 0;
  for (const [z, area] of planes) if (area >= most * 0.5 && z < plane) plane = z;
  const wall = triangles.filter((triangle) => Math.abs(triangle.z - plane) < PLANE_GAP);
  if (wall.length === 0) return null;
  const x0 = Math.min(...wall.map((triangle) => triangle.x0));
  const x1 = Math.max(...wall.map((triangle) => triangle.x1));
  const y1 = Math.max(...wall.map((triangle) => triangle.y1));

  const frames = wall.filter((triangle) => triangle.colour.map((c) => c.toFixed(2)).join(",") !== wallColour);
  const windows = openings(frames, { x0, x1, y1 });

  return { facade: -plane, wallWidth: x1 - x0, height: y1, windows };
}

/** The empty, enclosed regions of the facade: the window and door openings. */
function openings(frames, { x0, x1, y1 }) {
  if (frames.length === 0) return [];
  const cols = Math.ceil((x1 - x0) / STEP) + 1;
  const rows = Math.ceil(y1 / STEP) + 1;
  const grid = new Uint8Array(cols * rows);
  const sign = (px, py, ax, ay, bx, by) => (px - bx) * (ay - by) - (ax - bx) * (py - by);
  for (const triangle of frames) {
    const minC = Math.max(0, Math.floor((triangle.x0 - x0) / STEP));
    const maxC = Math.min(cols - 1, Math.ceil((triangle.x1 - x0) / STEP));
    const minR = Math.max(0, Math.floor(triangle.y0 / STEP));
    const maxR = Math.min(rows - 1, Math.ceil(triangle.y1 / STEP));
    // The triangle's real corners, not its bbox: a frame is thin.
    const [px0, py0, px1, py1, px2, py2] = triangle.corners;
    for (let r = minR; r <= maxR; r += 1) {
      for (let c = minC; c <= maxC; c += 1) {
        const px = x0 + c * STEP;
        const py = r * STEP;
        const d1 = sign(px, py, px0, py0, px1, py1);
        const d2 = sign(px, py, px1, py1, px2, py2);
        const d3 = sign(px, py, px2, py2, px0, py0);
        const neg = d1 < 0 || d2 < 0 || d3 < 0;
        const pos = d1 > 0 || d2 > 0 || d3 > 0;
        if (!(neg && pos)) grid[r * cols + c] = 1;
      }
    }
  }

  const seen = new Uint8Array(cols * rows);
  const found = [];
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      if (grid[r * cols + c] || seen[r * cols + c]) continue;
      const stack = [[r, c]];
      seen[r * cols + c] = 1;
      let border = false;
      let minC = c, maxC = c, minR = r, maxR = r, cells = 0;
      while (stack.length > 0) {
        const [rr, cc] = stack.pop();
        cells += 1;
        if (rr === 0 || rr === rows - 1 || cc === 0 || cc === cols - 1) border = true;
        if (cc < minC) minC = cc;
        if (cc > maxC) maxC = cc;
        if (rr < minR) minR = rr;
        if (rr > maxR) maxR = rr;
        for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nr = rr + dr;
          const nc = cc + dc;
          if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
          if (grid[nr * cols + nc] || seen[nr * cols + nc]) continue;
          seen[nr * cols + nc] = 1;
          stack.push([nr, nc]);
        }
      }
      if (border) continue;
      const width = (maxC - minC) * STEP;
      const height = (maxR - minR) * STEP;
      if (cells < 40 || width < 0.3 || height < 0.3 || width > 2.5 || height > 2.0) continue;
      if ((minR + maxR) / 2 * STEP < 0.4) continue;
      found.push({
        x: x0 + ((minC + maxC) / 2) * STEP,
        y: ((minR + maxR) / 2) * STEP,
        width,
        height,
        cells,
      });
    }
  }
  // A facade has a few windows, not a hundred holes: keep the largest four,
  // in a stable order.
  return found
    .sort((a, b) => b.cells - a.cells || a.y - b.y || a.x - b.x)
    .slice(0, 4)
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .map(({ x, y, width, height }) => ({ x, y, width, height }));
}
