import { prepareCanvas, riderColor } from "./canvas.js";

/**
 * Race timeline: one bar from start to finish with lap ticks, every racer
 * as a dot and my progress filled in. `standing` comes from raceStanding().
 */
export function drawRaceTimeline(canvas, { standing, myId, colors }) {
  const { ctx, width, height } = prepareCanvas(canvas);
  const pad = 10;
  const mid = height / 2;
  const x = (fraction) => pad + fraction * (width - 2 * pad);

  ctx.fillStyle = "rgba(255, 255, 255, 0.15)";
  ctx.fillRect(x(0), mid - 3, x(1) - x(0), 6);
  ctx.fillStyle = colors.me;
  ctx.fillRect(x(0), mid - 3, x(standing.fraction) - x(0), 6);

  ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
  for (let lap = 1; lap < standing.laps; lap += 1) ctx.fillRect(x(lap / standing.laps) - 1, mid - 9, 2, 18);

  for (const { rider, fraction } of standing.others) {
    ctx.beginPath();
    ctx.arc(x(fraction), mid, 5, 0, Math.PI * 2);
    ctx.fillStyle = riderColor(rider, myId, colors);
    ctx.fill();
  }
  ctx.beginPath();
  ctx.arc(x(standing.fraction), mid, 7.5, 0, Math.PI * 2);
  ctx.fillStyle = colors.me;
  ctx.fill();
  ctx.strokeStyle = colors.text;
  ctx.lineWidth = 2;
  ctx.stroke();
}
