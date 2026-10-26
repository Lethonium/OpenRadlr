import { distanceUnit, getUnits } from "../util/format.js";
import { prepareCanvas, riderColor } from "./canvas.js";

/**
 * Elevation profile of the whole lap with every rider as a dot.
 * Pure mapping functions are exported for tests.
 */

export function profileScale(route, width, height, padding = { top: 16, bottom: 22, left: 8, right: 8 }) {
  const range = Math.max(10, route.maxElevation - route.minElevation);
  const plotW = width - padding.left - padding.right;
  const plotH = height - padding.top - padding.bottom;
  return {
    x: (distance) => padding.left + (route.wrap(distance) / route.length) * plotW,
    y: (elevation) => padding.top + (1 - (elevation - route.minElevation) / range) * plotH,
    baseline: height - padding.bottom,
    padding,
  };
}

/** Distance units between labels, so that they stay about 60 px apart: 1 on a short route, 20 on a 180 km one. */
export function tickEvery(lengthUnits, pxPerUnit) {
  const wanted = 60 / Math.max(pxPerUnit, 1e-6);
  return [1, 2, 5, 10, 20, 25, 50, 100].find((n) => n >= wanted) ?? Math.ceil(lengthUnits);
}

export function drawProfile(canvas, { route, riders, myId, colors }) {
  const { ctx, width, height } = prepareCanvas(canvas);
  const scale = profileScale(route, width, height);
  const samples = Math.max(2, Math.floor(width / 2));

  // Climb and sprint segments.
  for (const marker of route.markers) {
    if (marker.type === "start_finish") continue;
    const length = marker.length ?? 200;
    ctx.fillStyle = marker.type === "climb" ? colors.climb : colors.sprint;
    const x0 = scale.x(marker.distance);
    const x1 = scale.x(Math.min(route.length - 0.01, marker.distance + length));
    ctx.fillRect(x0, scale.padding.top, Math.max(2, x1 - x0), scale.baseline - scale.padding.top);
  }

  // Terrain.
  ctx.beginPath();
  ctx.moveTo(scale.x(0), scale.baseline);
  for (let i = 0; i <= samples; i += 1) {
    const d = (i / samples) * route.length * 0.99999;
    ctx.lineTo(scale.x(d), scale.y(route.elevationAt(d)));
  }
  ctx.lineTo(scale.x(route.length * 0.99999), scale.baseline);
  ctx.closePath();
  ctx.fillStyle = colors.terrain;
  ctx.fill();
  ctx.strokeStyle = colors.terrainEdge;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Start/finish line.
  ctx.strokeStyle = colors.text;
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.moveTo(scale.x(0) + 1, scale.padding.top);
  ctx.lineTo(scale.x(0) + 1, scale.baseline);
  ctx.stroke();
  ctx.setLineDash([]);

  // Distance ticks every km (or mile).
  ctx.fillStyle = colors.muted;
  ctx.font = "11px system-ui, sans-serif";
  ctx.textAlign = "center";
  const unitM = getUnits() === "imperial" ? 1609.344 : 1000;
  const every = tickEvery(route.length / unitM, scale.x(unitM) - scale.x(0));
  for (let n = every; n * unitM < route.length; n += every) {
    ctx.fillText(`${n} ${distanceUnit()}`, scale.x(n * unitM), height - 6);
  }

  // Riders, me last so I'm on top.
  const sorted = [...riders].sort((a, b) => (a.id === myId) - (b.id === myId));
  for (const rider of sorted) {
    const mine = rider.id === myId;
    ctx.beginPath();
    ctx.arc(scale.x(rider.distance), scale.y(route.elevationAt(rider.distance)) - 1, mine ? 6 : 3.5, 0, Math.PI * 2);
    ctx.fillStyle = riderColor(rider, myId, colors);
    ctx.fill();
    if (mine) {
      ctx.strokeStyle = colors.text;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }
}

/**
 * Elevation samples for the road ahead: `count` points from `distance` to
 * `distance + ahead`, each `{ along, elevation }` (along = metres from me).
 */
export function upcomingSamples(route, distance, ahead, count = 60) {
  return Array.from({ length: count }, (_, i) => {
    const along = (i / (count - 1)) * ahead;
    return { along, elevation: route.elevationAt(distance + along) };
  });
}

/**
 * The next `ahead` metres as a small elevation chart, me at the left edge.
 * The vertical scale never shows less than 20 m so flat roads stay flat.
 */
export function drawUpcoming(canvas, { route, distance, ahead = 2000, colors }) {
  const { ctx, width, height } = prepareCanvas(canvas);
  const samples = upcomingSamples(route, distance, ahead, Math.max(2, Math.floor(width / 4)));
  const elevations = samples.map((s) => s.elevation);
  const low = Math.min(...elevations);
  const range = Math.max(20, Math.max(...elevations) - low);
  const pad = 6;
  const x = (along) => pad + (along / ahead) * (width - 2 * pad);
  const y = (elevation) => height - pad - ((elevation - low) / range) * (height - 2 * pad);

  ctx.beginPath();
  ctx.moveTo(x(0), height);
  for (const s of samples) ctx.lineTo(x(s.along), y(s.elevation));
  ctx.lineTo(x(ahead), height);
  ctx.closePath();
  ctx.fillStyle = "rgba(255, 255, 255, 0.16)";
  ctx.fill();
  ctx.beginPath();
  samples.forEach((s, i) => (i === 0 ? ctx.moveTo(x(s.along), y(s.elevation)) : ctx.lineTo(x(s.along), y(s.elevation))));
  ctx.strokeStyle = "rgba(255, 255, 255, 0.7)";
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(x(0), y(samples[0].elevation), 5, 0, Math.PI * 2);
  ctx.fillStyle = colors.me;
  ctx.fill();
}
