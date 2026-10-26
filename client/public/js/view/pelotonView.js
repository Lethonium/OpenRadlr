import { soloRiders, vehicleMarkers } from "../ride/vehicle.js";
import { prepareCanvas, riderColor } from "./canvas.js";

/**
 * Close-up of the road around me: distance runs left to right, lanes are
 * rows. Shows who is drafting whom and lane changes.
 */

export const PELOTON_WINDOW = Object.freeze({ behind: 25, ahead: 45 });

/** Riders within the window, with their signed gap to me. */
export function ridersInWindow(me, riders, route, window = PELOTON_WINDOW) {
  return riders
    .map((rider) => ({ rider, gap: route.signedGap(me.distance, rider.distance) }))
    .filter(({ gap }) => gap >= -window.behind && gap <= window.ahead);
}

/** Body length (m) of a vehicle's marker, against 1.8 m for a bike. */
export const VEHICLE_LENGTH_M = Object.freeze({ tandem: 2.6, beer_bike: 4.5 });

/**
 * What the peloton shows in the window: each solo rider, and one larger marker
 * per vehicle (at its captain) instead of its seated riders.
 * @returns {{rider: object, gap: number, label: string, lengthM: number, big: boolean, mine: boolean}[]}
 */
export function pelotonItems(me, riders, route, window = PELOTON_WINDOW) {
  const solo = ridersInWindow(me, soloRiders(riders), route, window).map(({ rider, gap }) => ({
    rider,
    gap,
    label: rider.is_bot ? `${rider.name} · bot` : rider.name,
    lengthM: 1.8,
    big: false,
    mine: rider.id === me.id,
  }));
  const markers = new Map(vehicleMarkers(riders, me.id).map((m) => [m.rider.id, m]));
  const vehicles = ridersInWindow(me, [...markers.values()].map((m) => m.rider), route, window).map(({ rider, gap }) => {
    const marker = markers.get(rider.id);
    return { rider, gap, label: marker.label, lengthM: VEHICLE_LENGTH_M[marker.kind] ?? 3, big: true, mine: marker.mine };
  });
  return [...solo, ...vehicles];
}

/** True if two label boxes in the same lane row overlap horizontally (with a small margin). */
export function overlaps(a, b, margin = 6) {
  return a.row === b.row && a.left < b.right + margin && b.left < a.right + margin;
}

export function drawPeloton(canvas, { route, riders, me, draft, colors }) {
  const { ctx, width, height } = prepareCanvas(canvas);
  if (!me) return;

  const top = 14;
  const bottom = height - 14;
  const laneHeight = (bottom - top) / route.lanes;
  const span = PELOTON_WINDOW.behind + PELOTON_WINDOW.ahead;
  const x = (gap) => ((gap + PELOTON_WINDOW.behind) / span) * width;
  const y = (lane) => top + (lane + 0.5) * laneHeight;

  // Road and lane markings.
  ctx.fillStyle = colors.road;
  ctx.fillRect(0, top, width, bottom - top);
  ctx.strokeStyle = colors.grid;
  ctx.setLineDash([10, 10]);
  for (let lane = 1; lane < route.lanes; lane += 1) {
    const ly = top + lane * laneHeight;
    ctx.beginPath();
    ctx.moveTo(0, ly);
    ctx.lineTo(width, ly);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  // Draft zone ahead of me.
  if (draft) {
    ctx.fillStyle = colors.me;
    ctx.globalAlpha = 0.15;
    ctx.fillRect(x(0), y(me.lane) - laneHeight / 2 + 3, x(draft.gap) - x(0), laneHeight - 6);
    ctx.globalAlpha = 1;
  }

  // Metre ticks.
  ctx.fillStyle = colors.muted;
  ctx.font = "10px system-ui, sans-serif";
  ctx.textAlign = "center";
  for (let m = -20; m <= 40; m += 10) ctx.fillText(m === 0 ? "you" : `${m > 0 ? "+" : ""}${m} m`, x(m), height - 2);

  // Riders as capsules (≈ 1.8 m long bikes); a vehicle is one longer, thicker capsule.
  // Draw mine first so my label always wins, then the others closest to me.
  const visible = pelotonItems(me, riders, route).sort((a, b) => b.mine - a.mine || Math.abs(a.gap) - Math.abs(b.gap));
  const labelBoxes = [];
  for (const { rider, gap, label, lengthM, big, mine } of visible) {
    const bikeLength = (lengthM / span) * width;
    const cx = x(gap);
    const cy = y(rider.lane);
    const h = Math.min(big ? 22 : 14, laneHeight * (big ? 0.8 : 0.5));
    ctx.fillStyle = riderColor(rider, me.id, colors);
    ctx.beginPath();
    ctx.roundRect(cx - bikeLength, cy - h / 2, bikeLength, h, h / 2);
    ctx.fill();
    if (mine) {
      ctx.strokeStyle = colors.text;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    ctx.font = `${mine ? "600 " : ""}11px system-ui, sans-serif`;
    const labelWidth = ctx.measureText(label).width;
    const labelBox = { left: cx - bikeLength / 2 - labelWidth / 2, right: cx - bikeLength / 2 + labelWidth / 2, row: Math.round(rider.lane) };
    if (mine || !labelBoxes.some((box) => overlaps(box, labelBox))) {
      labelBoxes.push(labelBox);
      ctx.fillStyle = colors.text;
      ctx.textAlign = "center";
      ctx.fillText(label, cx - bikeLength / 2, cy - h / 2 - 4);
    }
  }
}
