/**
 * The 2D side view: the route unrolled by distance, the camera across the road. This file draws the sky, the sea,
 * the land in perspective (sideBands.js), the road and the verge in front of it, then the time of day's tint and
 * the weather. The scenery and the riders go between the slices and on the road in the next step.
 */
import { drawTint, drawWeather } from "./overlays.js";
import { css, mix, toSrgb } from "./look2d.js";
import { MIDDLE_LATERALS, createSideBands } from "./sideBands.js";
import { sideCamera } from "./sideCamera.js";

/** Sea to the horizon, mixed with the sky's haze. */
const SEA = [0.12, 0.38, 0.52];
const SEA_HAZE = 0.35;
/** Road, kerb and line, in metres across the road's thickness; the road is drawn this wide. */
const KERB_W_M = 0.5;
const KERB_DROP_M = 0.35;
const ASPHALT_W_M = 0.55;
const ASPHALT_DROP_M = 0.1;
const LINE_W_M = 0.06;
const LINE_RISE_M = 0.12;
/** Pixels between road points. */
const ROAD_STEP_PX = 4;
const VERGE_DARK = 0.72;
const TUFTS = 90;
const SNOW_GRASS = [0.9, 0.92, 0.96];
const CLOUD_PARALLAX = 0.05;
const CLOUD_DRIFT_PX_S = 6;
const STARS = 120;
const TAU = Math.PI * 2;

const shade = (c, f) => c.map((v) => Math.min(1, v * f));

/**
 * @param {{scene: {roads: {style: {surface: number[]}}}, route: object, sampler: object, createCanvas: (w: number, h: number) => object}} deps
 * @returns {{draw: (ctx: object, frame: {width: number, height: number, me: {d: number}, riders?: object[], look: object, t?: number}) => void, resize: () => void, dispose: () => void}}
 */
export function createSideView({ scene, route, sampler, createCanvas }) {
  const bands = createSideBands({ route, sampler, createCanvas });
  const asphalt = css(scene.roads.style.surface.map(toSrgb));

  function drawSky(ctx, camera, look, t) {
    const { width, height, roadY, scale } = camera;
    const sky = ctx.createLinearGradient(0, 0, 0, roadY);
    sky.addColorStop(0, css(look.sky.top));
    sky.addColorStop(1, css(look.sky.horizon));
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, width, height);
    if (look.night) {
      ctx.fillStyle = "rgba(255,255,255,0.8)";
      for (let k = 0; k < STARS; k += 1) {
        const x = (((k * 137.5 - camera.meD * 0.02 * scale) % width) + width) % width;
        const y = ((k * 71.7) % (roadY * 0.8)) * 0.9;
        const size = k % 7 === 0 ? 2 : 1;
        ctx.fillRect(x, y, size, size);
      }
      ctx.fillStyle = "#f3f0e2";
      ctx.beginPath();
      ctx.arc(width * 0.78, height * 0.14, 26, 0, TAU);
      ctx.fill();
      ctx.fillStyle = css(look.sky.top);
      ctx.beginPath();
      ctx.arc(width * 0.78 + 10, height * 0.14 - 6, 22, 0, TAU);
      ctx.fill();
    } else if (!look.raining && !look.snowing) {
      const sunY = look.time === "day" ? height * 0.12 : look.time === "golden" ? roadY * 0.55 : roadY * 0.75;
      const glow = ctx.createRadialGradient(width * 0.82, sunY, 0, width * 0.82, sunY, 160);
      glow.addColorStop(0, "rgba(255, 245, 210, 0.95)");
      glow.addColorStop(0.15, "rgba(255, 235, 180, 0.6)");
      glow.addColorStop(1, "rgba(255, 220, 160, 0)");
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, width, height);
    }
    drawClouds(ctx, camera, look, t);
  }

  function drawClouds(ctx, camera, look, t) {
    const { width, roadY, scale } = camera;
    const base = look.night ? [0.25, 0.3, 0.42] : look.raining || look.snowing ? [0.62, 0.65, 0.7] : [1, 1, 1];
    const count = look.raining || look.snowing ? 9 : 5;
    ctx.fillStyle = css(base, look.night ? 0.5 : 0.85);
    const span = width + 400;
    for (let k = 0; k < count; k += 1) {
      const x = ((((k * 397 - camera.meD * scale * CLOUD_PARALLAX - t * CLOUD_DRIFT_PX_S) % span) + span) % span) - 200;
      const y = roadY * (0.12 + ((k * 0.37) % 0.4));
      const w = 90 + ((k * 53) % 90);
      for (let p = 0; p < 5; p += 1) {
        ctx.beginPath();
        ctx.ellipse(x + (p - 2) * w * 0.28, y - Math.sin(p * 1.3) * w * 0.12, w * 0.26, w * 0.18, 0, 0, TAU);
        ctx.fill();
      }
    }
  }

  /** The road as screen points, in order, only where the route exists. */
  function roadPoints(camera) {
    const points = [];
    const from = -Math.ceil((camera.riderX + ROAD_STEP_PX) / ROAD_STEP_PX);
    const to = Math.ceil((camera.width - camera.riderX + ROAD_STEP_PX) / ROAD_STEP_PX);
    for (let i = from; i <= to; i += 1) {
      const sx = camera.riderX + i * ROAD_STEP_PX;
      const d = camera.meD + (sx - camera.riderX) / camera.scale;
      if (route.loop === false && (d < 0 || d > route.length)) continue;
      points.push([sx, camera.y(route.elevationAt(d), 0), d]);
    }
    return points;
  }

  function drawRoad(ctx, camera, look, points) {
    const { scale, roadY, height } = camera;
    if (points.length === 0) return;
    const grass = look.season === "winter" ? SNOW_GRASS : look.ground.grass;
    const verge = ctx.createLinearGradient(0, roadY, 0, height);
    verge.addColorStop(0, css(shade(grass, 1)));
    verge.addColorStop(1, css(shade(grass, VERGE_DARK)));
    ctx.fillStyle = verge;
    ctx.beginPath();
    ctx.moveTo(points[0][0], height);
    for (const [x, y] of points) ctx.lineTo(x, y + scale * KERB_DROP_M);
    ctx.lineTo(points.at(-1)[0], height);
    ctx.closePath();
    ctx.fill();
    // Tufts of grass so the verge is not a flat sheet.
    ctx.fillStyle = css(shade(grass, 0.82), 0.7);
    const first = Math.floor(camera.meD / 3) * 3;
    for (let k = 0; k < TUFTS; k += 1) {
      const d = first + (k - 30) * 3 + ((k * 37) % 3);
      if (route.loop === false && (d < 0 || d > route.length)) continue;
      const y = camera.y(route.elevationAt(d), 0) + scale * (1.2 + ((k * 13) % 11) * 0.6);
      ctx.beginPath();
      ctx.ellipse(camera.x(d, 0), y, scale * 0.35, scale * 0.12, 0, 0, TAU);
      ctx.fill();
    }
    const line = (style, width, drop) => {
      ctx.strokeStyle = style;
      ctx.lineWidth = scale * width;
      ctx.beginPath();
      for (const [x, y] of points) ctx.lineTo(x, y + scale * drop);
      ctx.stroke();
    };
    ctx.lineJoin = "round";
    line(css(shade(look.ground.soil, 0.7)), KERB_W_M, KERB_DROP_M);
    line(asphalt, ASPHALT_W_M, ASPHALT_DROP_M);
    line("rgba(255,255,255,0.7)", LINE_W_M, -LINE_RISE_M);
  }

  function draw(ctx, { width, height, me, look, t = 0 }) {
    const camera = sideCamera({ width, height, me, route });
    drawSky(ctx, camera, look, t);
    ctx.fillStyle = css(mix(SEA, look.sky.horizon, SEA_HAZE));
    ctx.fillRect(0, camera.horizonY - 2, width, height - camera.horizonY + 2);
    bands.drawFar(ctx, camera, look);
    for (const lateral of MIDDLE_LATERALS) bands.drawSlice(ctx, lateral, camera, look);
    drawRoad(ctx, camera, look, roadPoints(camera));
    drawTint(ctx, look, { x: 0, y: 0, width, height });
    drawWeather(ctx, look, { width, height, t });
  }

  return { draw, resize: () => bands.resize(), dispose: () => bands.resize() };
}
