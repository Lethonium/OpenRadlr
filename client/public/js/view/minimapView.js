import { soloRiders, vehicleMarkers } from "../ride/vehicle.js";
import { prepareCanvas, riderColor } from "./canvas.js";

/** Top-down map of the route with all riders. */

export function minimapTransform(bounds, width, height, padding = 12) {
  const spanX = Math.max(1, bounds.maxX - bounds.minX);
  const spanY = Math.max(1, bounds.maxY - bounds.minY);
  const scale = Math.min((width - 2 * padding) / spanX, (height - 2 * padding) / spanY);
  const offsetX = (width - spanX * scale) / 2;
  const offsetY = (height - spanY * scale) / 2;
  return ({ x, y }) => ({
    x: offsetX + (x - bounds.minX) * scale,
    // Screen y grows downwards; map north up.
    y: height - (offsetY + (y - bounds.minY) * scale),
  });
}

/**
 * Dots for the minimap, mine last: each solo rider, and one larger dot per
 * vehicle at its captain with the vehicle's label.
 * @returns {{rider: object, radius: number, label: string|null, mine: boolean}[]}
 */
export function minimapDots(riders, myId) {
  const solo = soloRiders(riders).map((rider) => ({ rider, radius: rider.id === myId ? 6 : 3.5, label: null, mine: rider.id === myId }));
  const vehicles = vehicleMarkers(riders, myId).map((m) => ({ rider: m.rider, radius: m.mine ? 8 : 6, label: m.label, mine: m.mine }));
  return [...solo, ...vehicles].sort((a, b) => a.mine - b.mine);
}

export function drawMinimap(canvas, { route, riders, myId, colors }) {
  const { ctx, width, height } = prepareCanvas(canvas);
  const project = minimapTransform(route.bounds, width, height);

  ctx.beginPath();
  route.nodes.forEach((node, index) => {
    const p = project(node);
    if (index === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  });
  ctx.strokeStyle = colors.road;
  ctx.lineWidth = 6;
  ctx.lineJoin = "round";
  ctx.stroke();

  const start = project(route.positionAt(0));
  ctx.fillStyle = colors.text;
  ctx.fillRect(start.x - 1, start.y - 6, 2, 12);

  for (const { rider, radius, label, mine } of minimapDots(riders, myId)) {
    const p = project(route.positionAt(rider.distance));
    ctx.beginPath();
    ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = riderColor(rider, myId, colors);
    ctx.fill();
    if (mine) {
      ctx.strokeStyle = colors.text;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    if (label) {
      ctx.font = "10px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillStyle = colors.text;
      ctx.fillText(label, p.x, p.y - radius - 3);
    }
  }
}
