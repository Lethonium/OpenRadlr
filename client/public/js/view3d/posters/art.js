/**
 * Flat poster illustrations drawn with plain Canvas 2D paths: no images, no fonts. Every drawer fills the square
 * { x, y, size } and leaves the context's styles as it found them.
 */
const INK = "#2b2118";
const LEMON = "#ffe14d";
const LEMON_DARK = "#f2b705";
const LEAF = "#4caf50";
const BEER = "#e8890c";
const FOAM = "#fff8e7";
const SKY = "#bfe9ff";

function outline(ctx, size) {
  ctx.strokeStyle = INK;
  ctx.lineWidth = Math.max(1, size * 0.03);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
}

/** Fill the current path with a colour, then stroke the ink outline. */
function paintPath(ctx, fill, size) {
  ctx.fillStyle = fill;
  ctx.fill();
  outline(ctx, size);
  ctx.stroke();
}

function polygon(ctx, points) {
  ctx.beginPath();
  points.forEach(([px, py], i) => (i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)));
  ctx.closePath();
}

/** A lemon seen from the side with pointed tips, a leaf, a shine and a cheeky face. */
function lemonShape(ctx, cx, cy, w, h, angle, face = true) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.moveTo(-w * 0.55, 0);
  ctx.bezierCurveTo(-w * 0.4, -h * 0.62, w * 0.4, -h * 0.62, w * 0.55, 0);
  ctx.bezierCurveTo(w * 0.4, h * 0.62, -w * 0.4, h * 0.62, -w * 0.55, 0);
  ctx.closePath();
  paintPath(ctx, LEMON, h);
  ctx.beginPath();
  ctx.moveTo(w * 0.1, -h * 0.5);
  ctx.bezierCurveTo(w * 0.3, -h * 0.5, w * 0.42, -h * 0.35, w * 0.46, -h * 0.2);
  ctx.strokeStyle = "rgba(255,255,255,0.8)";
  ctx.lineWidth = h * 0.07;
  ctx.stroke();
  if (face) {
    ctx.fillStyle = INK;
    ctx.beginPath();
    ctx.arc(-w * 0.12, -h * 0.08, h * 0.05, 0, Math.PI * 2);
    ctx.arc(w * 0.12, -h * 0.08, h * 0.05, 0, Math.PI * 2);
    ctx.fill();
    outline(ctx, h);
    ctx.beginPath();
    ctx.arc(0, h * 0.02, h * 0.16, 0.15 * Math.PI, 0.85 * Math.PI);
    ctx.stroke();
  }
  ctx.restore();
  // leaf at the upper tip
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.moveTo(w * 0.5, -h * 0.05);
  ctx.bezierCurveTo(w * 0.6, -h * 0.5, w * 0.8, -h * 0.5, w * 0.85, -h * 0.4);
  ctx.bezierCurveTo(w * 0.8, -h * 0.15, w * 0.6, -h * 0.05, w * 0.5, -h * 0.05);
  paintPath(ctx, LEAF, h);
  ctx.restore();
}

function lemon(ctx, { x, y, size }) {
  lemonShape(ctx, x + size * 0.46, y + size * 0.55, size * 0.7, size * 0.62, -0.35);
}

/** A tall Radler glass: golden drink, foam crown, a lemon slice on the rim and a few bubbles. */
function glassShape(ctx, gx, gy, gw, gh, { drink = LEMON_DARK, foam = true, straw = false } = {}) {
  const size = gh;
  const inset = gw * 0.12;
  polygon(ctx, [
    [gx, gy],
    [gx + gw, gy],
    [gx + gw - inset, gy + gh],
    [gx + inset, gy + gh],
  ]);
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.fill();
  // the drink
  const level = gy + gh * 0.18;
  const slope = (level - gy) / gh;
  polygon(ctx, [
    [gx + inset * slope + gw * 0.03, level],
    [gx + gw - inset * slope - gw * 0.03, level],
    [gx + gw - inset - gw * 0.03, gy + gh - gh * 0.03],
    [gx + inset + gw * 0.03, gy + gh - gh * 0.03],
  ]);
  ctx.fillStyle = drink;
  ctx.fill();
  if (straw) {
    outline(ctx, size);
    ctx.strokeStyle = "#e63946";
    ctx.lineWidth = gw * 0.07;
    ctx.beginPath();
    ctx.moveTo(gx + gw * 0.55, gy + gh * 0.8);
    ctx.lineTo(gx + gw * 0.75, gy - gh * 0.12);
    ctx.lineTo(gx + gw * 0.92, gy - gh * 0.1);
    ctx.stroke();
  }
  if (foam) {
    ctx.fillStyle = FOAM;
    ctx.beginPath();
    for (let i = 0; i < 4; i += 1) {
      ctx.arc(gx + gw * (0.14 + i * 0.24), gy + gh * 0.04, gw * 0.15, 0, Math.PI * 2);
    }
    ctx.fill();
    ctx.fillRect(gx + gw * 0.04, gy + gh * 0.04, gw * 0.92, gh * 0.12);
  }
  // bubbles
  ctx.fillStyle = "rgba(255,255,255,0.7)";
  ctx.beginPath();
  ctx.arc(gx + gw * 0.35, gy + gh * 0.55, gw * 0.045, 0, Math.PI * 2);
  ctx.arc(gx + gw * 0.55, gy + gh * 0.42, gw * 0.035, 0, Math.PI * 2);
  ctx.arc(gx + gw * 0.6, gy + gh * 0.7, gw * 0.05, 0, Math.PI * 2);
  ctx.fill();
  // outline over everything
  polygon(ctx, [
    [gx, gy],
    [gx + gw, gy],
    [gx + gw - inset, gy + gh],
    [gx + inset, gy + gh],
  ]);
  outline(ctx, size);
  ctx.stroke();
}

function sliceShape(ctx, cx, cy, r) {
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  paintPath(ctx, LEMON, r * 4);
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.78, 0, Math.PI * 2);
  ctx.fillStyle = "#fff3a0";
  ctx.fill();
  outline(ctx, r * 4);
  ctx.lineWidth = r * 0.1;
  ctx.beginPath();
  for (let i = 0; i < 4; i += 1) {
    const a = (i * Math.PI) / 4;
    ctx.moveTo(cx - Math.cos(a) * r * 0.78, cy - Math.sin(a) * r * 0.78);
    ctx.lineTo(cx + Math.cos(a) * r * 0.78, cy + Math.sin(a) * r * 0.78);
  }
  ctx.stroke();
}

function glass(ctx, { x, y, size }) {
  glassShape(ctx, x + size * 0.22, y + size * 0.2, size * 0.5, size * 0.72);
  sliceShape(ctx, x + size * 0.72, y + size * 0.24, size * 0.16);
}

/** A beer mug and a lemonade glass clinking, with sparks between them. */
function cheers(ctx, { x, y, size }) {
  // mug, tilted right
  ctx.save();
  ctx.translate(x + size * 0.34, y + size * 0.6);
  ctx.rotate(0.22);
  glassShape(ctx, -size * 0.2, -size * 0.34, size * 0.4, size * 0.62, { drink: BEER });
  ctx.beginPath();
  ctx.arc(-size * 0.2, -size * 0.04, size * 0.1, Math.PI * 0.5, Math.PI * 1.5);
  outline(ctx, size);
  ctx.lineWidth = size * 0.05;
  ctx.stroke();
  ctx.restore();
  // lemonade, tilted left
  ctx.save();
  ctx.translate(x + size * 0.68, y + size * 0.6);
  ctx.rotate(-0.22);
  glassShape(ctx, -size * 0.17, -size * 0.34, size * 0.34, size * 0.62, { drink: "#fff08a", foam: false, straw: true });
  ctx.restore();
  sliceShape(ctx, x + size * 0.83, y + size * 0.3, size * 0.09);
  // sparks
  ctx.strokeStyle = LEMON_DARK;
  ctx.lineWidth = size * 0.035;
  ctx.lineCap = "round";
  const cx = x + size * 0.51;
  const cy = y + size * 0.24;
  ctx.beginPath();
  for (let i = 0; i < 5; i += 1) {
    const a = -Math.PI + (i * Math.PI) / 4;
    ctx.moveTo(cx + Math.cos(a) * size * 0.07, cy + Math.sin(a) * size * 0.07);
    ctx.lineTo(cx + Math.cos(a) * size * 0.16, cy + Math.sin(a) * size * 0.16);
  }
  ctx.stroke();
}

/** A rider in a sprint: two wheels, frame, bent body, helmet, with speed lines behind. */
function rider(ctx, { x, y, size }) {
  const wheelR = size * 0.17;
  const ground = y + size * 0.82;
  const rear = [x + size * 0.28, ground - wheelR];
  const front = [x + size * 0.74, ground - wheelR];
  outline(ctx, size);
  ctx.lineWidth = size * 0.045;
  // speed lines
  ctx.strokeStyle = "rgba(43,33,24,0.45)";
  ctx.beginPath();
  for (let i = 0; i < 3; i += 1) {
    ctx.moveTo(x + size * 0.02, y + size * (0.4 + i * 0.12));
    ctx.lineTo(x + size * (0.14 + (i % 2) * 0.06), y + size * (0.4 + i * 0.12));
  }
  ctx.stroke();
  outline(ctx, size);
  ctx.lineWidth = size * 0.045;
  ctx.beginPath();
  ctx.arc(rear[0], rear[1], wheelR, 0, Math.PI * 2);
  ctx.arc(front[0], front[1], wheelR, 0, Math.PI * 2);
  ctx.stroke();
  // frame
  const seat = [x + size * 0.4, y + size * 0.46];
  const bars = [x + size * 0.66, y + size * 0.44];
  const crank = [x + size * 0.46, ground - wheelR * 0.6];
  ctx.strokeStyle = "#d62828";
  ctx.beginPath();
  ctx.moveTo(rear[0], rear[1]);
  ctx.lineTo(seat[0], seat[1]);
  ctx.lineTo(bars[0], bars[1]);
  ctx.lineTo(crank[0], crank[1]);
  ctx.lineTo(rear[0], rear[1]);
  ctx.moveTo(seat[0], seat[1]);
  ctx.lineTo(crank[0], crank[1]);
  ctx.moveTo(bars[0], bars[1]);
  ctx.lineTo(front[0], front[1]);
  ctx.stroke();
  // rider
  ctx.strokeStyle = INK;
  ctx.lineWidth = size * 0.07;
  ctx.beginPath();
  ctx.moveTo(seat[0], seat[1] - size * 0.02);
  ctx.lineTo(x + size * 0.62, y + size * 0.27); // back
  ctx.lineTo(bars[0] + size * 0.02, bars[1] - size * 0.02); // arm
  ctx.moveTo(seat[0], seat[1] - size * 0.02);
  ctx.lineTo(x + size * 0.55, y + size * 0.62); // thigh
  ctx.lineTo(crank[0], crank[1]); // shin
  ctx.stroke();
  ctx.fillStyle = INK;
  ctx.beginPath();
  ctx.arc(x + size * 0.7, y + size * 0.22, size * 0.07, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#d62828";
  ctx.beginPath();
  ctx.arc(x + size * 0.7, y + size * 0.2, size * 0.075, Math.PI, Math.PI * 2);
  ctx.fill();
}

/** Rolling hills with a winding road to a flag on the top and a bright sun. */
function hill(ctx, { x, y, size }) {
  ctx.fillStyle = SKY;
  ctx.fillRect(x, y, size, size);
  ctx.beginPath();
  ctx.arc(x + size * 0.78, y + size * 0.22, size * 0.12, 0, Math.PI * 2);
  ctx.fillStyle = LEMON;
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(x, y + size);
  ctx.lineTo(x, y + size * 0.72);
  ctx.bezierCurveTo(x + size * 0.15, y + size * 0.55, x + size * 0.3, y + size * 0.6, x + size * 0.45, y + size * 0.7);
  ctx.lineTo(x + size, y + size * 0.78);
  ctx.lineTo(x + size, y + size);
  ctx.closePath();
  ctx.fillStyle = "#7bc96f";
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(x + size * 0.1, y + size);
  ctx.bezierCurveTo(x + size * 0.3, y + size * 0.5, x + size * 0.6, y + size * 0.35, x + size * 0.62, y + size * 0.3);
  ctx.bezierCurveTo(x + size * 0.7, y + size * 0.55, x + size * 0.95, y + size * 0.7, x + size, y + size);
  ctx.closePath();
  paintPath(ctx, "#4f9d4a", size);
  // road
  ctx.strokeStyle = "#5c5c5c";
  ctx.lineWidth = size * 0.07;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(x + size * 0.48, y + size);
  ctx.bezierCurveTo(x + size * 0.25, y + size * 0.8, x + size * 0.72, y + size * 0.62, x + size * 0.52, y + size * 0.45);
  ctx.bezierCurveTo(x + size * 0.45, y + size * 0.4, x + size * 0.6, y + size * 0.35, x + size * 0.62, y + size * 0.3);
  ctx.stroke();
  // flag
  outline(ctx, size);
  ctx.beginPath();
  ctx.moveTo(x + size * 0.62, y + size * 0.3);
  ctx.lineTo(x + size * 0.62, y + size * 0.1);
  ctx.stroke();
  polygon(ctx, [
    [x + size * 0.62, y + size * 0.1],
    [x + size * 0.82, y + size * 0.16],
    [x + size * 0.62, y + size * 0.23],
  ]);
  paintPath(ctx, "#d62828", size);
}

/** A chequered finish flag on a pole. */
function flag(ctx, { x, y, size }) {
  const left = x + size * 0.2;
  const top = y + size * 0.12;
  const w = size * 0.62;
  const h = size * 0.42;
  const cols = 5;
  const rows = 3;
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const wave = Math.sin((c / cols) * Math.PI * 1.6) * size * 0.04;
      ctx.fillStyle = (r + c) % 2 === 0 ? INK : "#ffffff";
      ctx.fillRect(left + (c * w) / cols, top + (r * h) / rows + wave, w / cols + 0.5, h / rows + 0.5);
    }
  }
  outline(ctx, size);
  ctx.strokeRect(left, top, w, h);
  ctx.lineWidth = size * 0.055;
  ctx.beginPath();
  ctx.moveTo(left, top - size * 0.04);
  ctx.lineTo(left, y + size * 0.92);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(left, top - size * 0.06, size * 0.04, 0, Math.PI * 2);
  paintPath(ctx, LEMON_DARK, size);
  lemonShape(ctx, x + size * 0.72, y + size * 0.8, size * 0.3, size * 0.26, -0.3, false);
}

const DRAWERS = { lemon, glass, cheers, rider, hill, flag };

export function drawArt(ctx, art, box) {
  const draw = DRAWERS[art] ?? DRAWERS.lemon;
  ctx.save();
  draw(ctx, box);
  ctx.restore();
}
