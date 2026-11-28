/**
 * The 2D side view: the route unrolled by distance, the camera across the road. It draws the sky, the sea, the
 * land in perspective (sideBands.js) with the scenery behind the road standing between the slices by depth, the
 * road and the verge, the arches, lemons, riders and the near-side scenery, the time of day's tint, lamps, windows
 * and bike lights after dark, the weather, and the route strip along the bottom.
 */
import { soloRiders, vehicleMarkers } from "../ride/vehicle.js";
import { laneOffset } from "../view/rideMapView.js";
import { drawBeams, drawGlows, drawTint, drawWeather } from "./overlays.js";
import { css, mix, toSrgb } from "./look2d.js";
import { drawProfileStrip, profileStrip } from "./profileStrip.js";
import { MIDDLE_LATERALS, createSideBands } from "./sideBands.js";
import { CAM_M, SPAN_M, VEX, sideCamera } from "./sideCamera.js";
import { drawSprite } from "./drawSprite.js";
import { sideScenery } from "./routeProjector.js";
import { BUILDING_SPRITES, spriteJobs } from "./sprites/catalog.js";

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
/** Every building turns a little away from straight-on, so it shows a side wall and reads as a solid. */
export const HOUSE_TILT = -0.45;
/** Scenery is drawn as a miniature (of the camera's pixels per metre at its depth), riders and vehicles bigger than life. */
const SCENERY_PX_PER_M = 0.8;
const RIDER_PX_PER_M = 1.52;
const ARCH_PX_PER_M = 1.5;
const LEMON_PX_PER_M = 2;
/** Things behind the road fade into the haze: by this much of the way to the lateral reach, up to this fraction of an alpha. */
const FADE_REACH_M = 140;
const FADE_MAX = 0.5;
const FADE_STRENGTH = 0.7;
/** Near-side scenery stands this far below the road's height, and a rider's wheels this far below the road line (metres). */
const NEAR_DROP_M = 0.6;
const WHEEL_DROP_M = 0.05;
/** Buildings stand at least this far above the road. */
const BUILDING_ABOVE_ROAD_M = 0.2;
const SPECTATOR_HOP_M = 0.3;
/** Near-side scenery this close (metres along the road) to a rider is drawn at this opacity, so it never hides them. */
const HIDING_M = 3.5;
const HIDING_ALPHA = 0.3;
/** Name label: metres above the wheels (in rider metres), its font and padding. */
const LABEL_M = 2.4;
const LABEL_FONT_PX = 12;
const FLAMME = "#d8262b";
const GHOST_ALPHA = 0.35;
const LABEL_FONT = "600 12px system-ui, sans-serif"; // i18n-ok: a css font
const FLAMME_H_M = 3.6;
/** Screen margin (px) beyond which scenery is not drawn. */
const MARGIN_PX = 120;
/** The strip's place along the bottom. */
const STRIP_H_PX = 54;
const STRIP_SIDE_PX = 16;
const STRIP_BOTTOM_PX = 10;
const PRIORITY_PER_M = 1;
/** Lamps and windows further than this along the road (metres) are too far to light the view: its span, with room for the far land that shrinks. */
const GLOW_REACH_M = SPAN_M * 2;
/** After-dark glows: `r` in sprite metres at the thing's own scale; colours and strengths as the map's. */
const LAMP_GLOW = Object.freeze({ r: 5, rgb: [1, 0.77, 0.47], a: 0.45 });
const WINDOW_GLOW = Object.freeze({ r: 0.9, rgb: [1, 0.82, 0.51], a: 0.55 });
const CAFE_GLOW = Object.freeze({ r: 7, rgb: [1, 0.75, 0.43], a: 0.5 });
const HEADLIGHT = Object.freeze({ length: 9, spread: 0.1, tilt: 0.05, rgb: [1, 0.97, 0.86], a: 0.28 });
/** Where on a lit sprite the glows sit: the lamp's head as a share of its height; windows as [across (share of the width), up (share of the height)]. */
const LAMP_HEAD = 0.93;
const WINDOW_SPREAD = 0.2;
const WINDOW_SHIFT = -0.07;
const WINDOWS = Object.freeze([[-1, 0.13], [1, 0.13], [-1, 0.42], [1, 0.42]]);
const TAILLIGHT = Object.freeze({ r: 0.5, rgb: [1, 0.16, 0.16], a: 0.35 });

/** The side-view sprite jobs by workbench id, and the houses by style and turn; built once from the catalog. */
const JOBS = (() => {
  const byId = new Map();
  const houses = new Map();
  for (const job of spriteJobs({ view: "side" })) {
    if (job.id === "house") {
      if (!houses.has(job.options.style)) houses.set(job.options.style, []);
      houses.get(job.options.style).push(job);
    } else if (!byId.has(job.id)) byId.set(job.id, job);
  }
  return { byId, houses };
})();

/** The sprite job a scenery item draws as, or null. `turn` is a house's turn against the camera. */
function jobOf(item, turn) {
  switch (item.layer) {
    case "tree":
    case "roadside":
    case "row":
    case "scrub":
    case "animal":
      return JOBS.byId.get(item.id) ?? null;
    case "house": {
      const set = JOBS.houses.get(item.id) ?? JOBS.houses.get("cottage");
      const want = turn + HOUSE_TILT;
      return set.reduce((best, job) => (Math.abs(job.yaw - want) < Math.abs(best.yaw - want) ? job : best));
    }
    case "farm":
    case "cafe":
    case "lamp":
      return JOBS.byId.get(BUILDING_SPRITES[item.layer]) ?? null;
    case "landmark":
      return JOBS.byId.get(BUILDING_SPRITES[item.id] ?? item.id) ?? null;
    case "person":
      return JOBS.byId.get("spectator") ?? null;
    case "arch":
      return item.id === "arch" ? JOBS.byId.get("route-arch") ?? null : null;
    default:
      return null;
  }
}
const FLIPPED = new Set(["tree", "roadside", "row", "scrub", "person", "animal"]);
const BUILDINGS = new Set(["house", "farm", "cafe"]);
const VEHICLE_JOBS = Object.freeze({ tandem: "tandem", beer_bike: "beer-bike" });

const shade = (c, f) => c.map((v) => Math.min(1, v * f));

/**
 * @param {{scene: {roads: {style: {surface: number[]}}}, route: object, sampler: object, createCanvas: (w: number, h: number) => object, index?: {query: Function}, store?: object}} deps
 *   `index` (worldIndex) and `store` (spriteStore) are optional: without them only land, road, riders-less strip are drawn
 * @returns {{draw: (ctx: object, frame: {width: number, height: number, me: {d: number, id?: string}, riders?: {id: string, d: number, lane: number, look: object, name?: string, mine?: boolean, ghost?: boolean, cadence?: number, phase?: number, vehicle?: object}[], lemons?: {distance: number, lane: number, collected?: boolean}[], look: object, t?: number}) => void, resize: () => void, dispose: () => void}}
 *   `phase` is in turns; `cadence` in rpm; `lane` as the map's (0 is leftmost)
 */
export function createSideView({ scene, route, sampler, createCanvas, index = null, store = null }) {
  const asphalt = css(scene.roads.style.surface.map(toSrgb));
  // What depends on the route, remade by `setRoute`.
  let bands;
  let scenery; // by lateral, far to near: the order it is drawn in
  let byDistance; // indices into `scenery`, by distance along the route
  let nearestShrink; // the smallest `f` of any entry: the widest stretch of road it can show
  let strip;
  function useRoute(next) {
    route = next;
    bands?.resize();
    bands = createSideBands({ route, sampler, createCanvas });
    scenery = index ? sideScenery(index, route) : [];
    byDistance = scenery.map((_, k) => k).sort((a, b) => scenery[a].d - scenery[b].d);
    nearestShrink = Math.min(1, ...scenery.map((entry) => CAM_M / (CAM_M - entry.lateral)));
    strip = profileStrip(route);
  }
  useRoute(route);
  // A route set while the side view is hidden is only kept; the next draw rebuilds for it.
  let pendingRoute = null;

  /** `d` as the camera sees it: the copy of this distance on the loop nearest the rider. */
  const nearTo = (me, d) => me.d + route.signedGap(me.d, d);
  /** A sprite for a job, asked for at `metres` from the rider; null until baked. */
  function sprite(job, metres) {
    if (!store || !job) return null;
    store.want(job, metres * PRIORITY_PER_M);
    return store.get(job.key);
  }
  /** Where a scenery entry stands on the screen: its sprite position and metres-to-pixels. */
  function placeOf(camera, entry) {
    const d = nearTo({ d: camera.meD }, entry.d);
    const { item, lateral } = entry;
    const road = route.elevationAt(d);
    const own = item.layer === "lamp" || item.layer === "animal" ? Math.max(sampler.height(item.x, item.z), sampler.water) : item.y;
    const f = camera.f(lateral);
    const pxm = camera.scale * SCENERY_PX_PER_M * f * (item.layer === "tree" || item.layer === "roadside" || item.layer === "row" || item.layer === "scrub" ? item.s || 1 : 1);
    const x = camera.x(d, lateral);
    if (lateral >= 0) return { x, y: camera.y(Math.min(road, own), lateral) + camera.scale * NEAR_DROP_M, pxm, d };
    const stand = BUILDINGS.has(item.layer) ? Math.max(own, road + BUILDING_ABOVE_ROAD_M) : own;
    return { x, y: camera.y(stand, lateral), pxm, d };
  }
  function drawThing(ctx, camera, entry, t, riderDs = []) {
    const { item } = entry;
    const place = placeOf(camera, entry);
    const image = sprite(jobOf(item, entry.turn), Math.abs(place.d - camera.meD));
    if (!image) return;
    const fade = entry.lateral < 0 ? Math.min(FADE_MAX, -entry.lateral / FADE_REACH_M) : 0;
    const hop = item.layer === "person" && item.arms ? Math.abs(Math.sin(t * 7 + item.phase)) * SPECTATOR_HOP_M * place.pxm : 0;
    const flip = FLIPPED.has(item.layer) && (Math.floor(item.x * 3.1 + item.z * 1.7) & 1) === 1;
    const hides = entry.lateral >= 0 && riderDs.some((d) => Math.abs(d - place.d) < HIDING_M);
    drawSprite(ctx, image, place.x, place.y - hop, place.pxm, { alpha: (1 - fade * FADE_STRENGTH) * (hides ? HIDING_ALPHA : 1), flip });
  }

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

  /** The arches over the road; the flamme rouge as a red pole with a pennant (it has no asset). */
  function drawArches(ctx, camera, arches) {
    for (const entry of arches) {
      const d = nearTo({ d: camera.meD }, entry.d);
      const x = camera.x(d, 0);
      const y = camera.y(route.elevationAt(d), 0);
      const pxm = camera.scale * ARCH_PX_PER_M;
      if (entry.item.id === "flammeRouge") {
        const [pole, top] = [0.12 * pxm, FLAMME_H_M * pxm];
        ctx.fillStyle = FLAMME;
        ctx.fillRect(x - pole, y - top, pole * 2, top);
        ctx.beginPath();
        ctx.moveTo(x + pole, y - top);
        ctx.lineTo(x + pole + 1.8 * pxm, y - top + 0.55 * pxm);
        ctx.lineTo(x + pole, y - top + 1.1 * pxm);
        ctx.closePath();
        ctx.fill();
        continue;
      }
      const image = sprite(jobOf(entry.item, 0), Math.abs(d - camera.meD));
      if (image) drawSprite(ctx, image, x, y, pxm);
    }
  }

  function drawLemons(ctx, camera, lemons) {
    const job = JOBS.byId.get("lemon");
    for (const lemon of lemons) {
      if (lemon.collected) continue;
      const d = nearTo({ d: camera.meD }, lemon.distance);
      const lateral = laneOffset(lemon.lane, route.lanes);
      const x = camera.x(d, lateral);
      if (x < -MARGIN_PX || x > camera.width + MARGIN_PX) continue;
      const image = sprite(job, Math.abs(d - camera.meD));
      if (image) drawSprite(ctx, image, x, camera.y(route.elevationAt(d), lateral), camera.scale * LEMON_PX_PER_M * camera.f(lateral));
    }
  }

  /** Riders and vehicles, the far lane first; returns where each stands, for the labels and the lights. */
  function drawRiders(ctx, camera, me, riders, t) {
    const marks = [
      ...soloRiders(riders).map((rider) => ({ rider, kind: null, label: rider.name, mine: rider.mine })),
      ...vehicleMarkers(riders, me.id).map((m) => ({ rider: m.rider, kind: m.kind, label: m.label, mine: m.mine })),
    ].map((mark) => ({ ...mark, lateral: laneOffset(mark.rider.lane ?? (route.lanes - 1) / 2, route.lanes) }));
    marks.sort((a, b) => a.lateral - b.lateral);
    const placed = [];
    for (const mark of marks) {
      const { rider, lateral } = mark;
      const d = nearTo(me, rider.d);
      const x = camera.x(d, lateral);
      if (x < -MARGIN_PX * 2 || x > camera.width + MARGIN_PX * 2) continue;
      const y = camera.y(route.elevationAt(d), lateral) + camera.scale * WHEEL_DROP_M;
      const pxm = camera.scale * RIDER_PX_PER_M * camera.f(lateral);
      const metres = Math.abs(d - me.d);
      const image = mark.kind ? sprite(JOBS.byId.get(VEHICLE_JOBS[mark.kind]), metres) : store?.rider(rider.look, "side", metres * PRIORITY_PER_M);
      const lean = -Math.atan((route.gradeAt(d) / 100) * VEX);
      placed.push({ ...mark, x, y, pxm, lean });
      if (!image) continue;
      const frames = image.frames.length;
      const frame = Math.floor(((t * (rider.cadence ?? 0)) / 60 + (rider.phase ?? 0)) * frames);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(lean);
      drawSprite(ctx, image, 0, 0, pxm, { frame, alpha: rider.ghost ? GHOST_ALPHA : 1 });
      ctx.restore();
    }
    return placed;
  }

  function drawLabels(ctx, placed) {
    ctx.save();
    ctx.textAlign = "center";
    ctx.font = LABEL_FONT;
    for (const { x, y, pxm, label, mine } of placed) {
      if (!label || mine) continue;
      const top = y - LABEL_M * pxm;
      const w = ctx.measureText(label).width + 10;
      ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
      ctx.fillRect(x - w / 2, top, w, LABEL_FONT_PX + 4);
      ctx.fillStyle = "#ffffff";
      ctx.fillText(label, x, top + LABEL_FONT_PX);
    }
    ctx.restore();
  }

  /** What glows after dark, in screen pixels, and the beams the riders' headlights throw (forward is to the right, a little down). */
  function lightsOf(camera, entries, placed) {
    const glows = [];
    const beams = [];
    const add = (glow, x, y, pxm) => glows.push({ rgb: glow.rgb, a: glow.a, r: glow.r * pxm, x, y });
    for (const entry of entries) {
      const { layer, seed } = entry.item;
      const lit = layer === "lamp" || layer === "cafe" || layer === "farm" || (layer === "house" && seed % 3 !== 0);
      if (!lit) continue;
      const { x, y, pxm, d } = placeOf(camera, entry);
      const image = store?.get(jobOf(entry.item, entry.turn)?.key);
      if (!image || Math.abs(d - camera.meD) > GLOW_REACH_M) continue;
      // The sprite's size in its own metres: height above the anchor and the middle of its width.
      const [high, centre] = [image.oy / image.ppm, x + ((image.frames[0].width / 2 - image.ox) * pxm) / image.ppm];
      const wide = image.frames[0].width / image.ppm;
      if (layer === "lamp") add(LAMP_GLOW, x + (image.frames[0].width / 2 - image.ox) * pxm / image.ppm, y - high * LAMP_HEAD * pxm, pxm);
      else if (layer === "cafe") add(CAFE_GLOW, centre, y - high * 0.3 * pxm, pxm);
      else for (const [k, row] of WINDOWS) add(WINDOW_GLOW, centre + (WINDOW_SHIFT + k * WINDOW_SPREAD) * wide * pxm, y - high * row * pxm, pxm);
    }
    for (const { x, y, pxm, lean = 0 } of placed) {
      // The lamps sit on the leaning bike, and the beam follows the road's slope down to it.
      const [cos, sin] = [Math.cos(lean), Math.sin(lean)];
      const at = (ax, ay) => [x + (ax * cos - ay * sin) * pxm, y + (ax * sin + ay * cos) * pxm];
      const [hx, hy] = at(1.1, -1.0);
      beams.push({ x: hx, y: hy, angle: lean + HEADLIGHT.tilt, length: HEADLIGHT.length * pxm, spread: HEADLIGHT.spread, rgb: HEADLIGHT.rgb, a: HEADLIGHT.a });
      const [tx, ty] = at(-0.95, -0.9);
      add(TAILLIGHT, tx, ty, pxm);
    }
    return { glows, beams };
  }

  /** The first of `byDistance` at or after the distance `d`. */
  function firstFrom(d) {
    let [lo, hi] = [0, byDistance.length];
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (scenery[byDistance[mid]].d < d) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  /** The scenery that could be on screen, in drawing order: a window of the route's distances round the camera (two pieces where a loop wraps) instead of every entry. */
  function nearScenery(camera) {
    if (scenery.length === 0) return scenery;
    const ahead = (camera.width + MARGIN_PX - camera.riderX) / (camera.scale * nearestShrink);
    const behind = (camera.riderX + MARGIN_PX) / (camera.scale * nearestShrink);
    if (ahead + behind >= route.length) return scenery;
    const from = camera.meD - behind;
    const pieces = [];
    if (route.loop === false) pieces.push([from, camera.meD + ahead]);
    else {
      const start = route.wrap(from);
      pieces.push([start, start + behind + ahead]);
      if (start + behind + ahead > route.length) pieces.push([start - route.length, start + behind + ahead - route.length]);
    }
    const found = [];
    for (const [a, b] of pieces) for (let i = firstFrom(a); i < byDistance.length && scenery[byDistance[i]].d <= b; i += 1) found.push(byDistance[i]);
    return found.sort((p, q) => p - q).map((k) => scenery[k]);
  }

  function draw(ctx, { width, height, ratio = 1, me, riders = [], lemons = [], look, t = 0 }) {
    if (pendingRoute) {
      const next = pendingRoute;
      pendingRoute = null;
      useRoute(next);
    }
    const camera = sideCamera({ width, height, me, route, ratio });
    const onScreen = nearScenery(camera).filter((entry) => {
      const x = camera.x(nearTo(me, entry.d), entry.lateral);
      return x > -MARGIN_PX && x < width + MARGIN_PX;
    });
    const arches = onScreen.filter((entry) => entry.item.layer === "arch");
    const things = onScreen.filter((entry) => entry.item.layer !== "arch");
    const behind = things.filter((entry) => entry.lateral < 0);
    drawSky(ctx, camera, look, t);
    ctx.fillStyle = css(mix(SEA, look.sky.horizon, SEA_HAZE));
    ctx.fillRect(0, camera.horizonY - 2, width, height - camera.horizonY + 2);
    bands.drawFar(ctx, camera, look);
    // Things between two slices stand on the farther one, so they are drawn after it and before the nearer.
    let next = 0;
    for (const lateral of MIDDLE_LATERALS) {
      while (next < behind.length && behind[next].lateral < lateral) drawThing(ctx, camera, behind[next++], t);
      bands.drawSlice(ctx, lateral, camera, look);
    }
    while (next < behind.length) drawThing(ctx, camera, behind[next++], t);
    drawRoad(ctx, camera, look, roadPoints(camera));
    drawArches(ctx, camera, arches);
    drawLemons(ctx, camera, lemons);
    const placed = drawRiders(ctx, camera, me, riders, t);
    const riderDs = placed.map((mark) => nearTo(me, mark.rider.d));
    for (const entry of things) if (entry.lateral >= 0) drawThing(ctx, camera, entry, t, riderDs);
    drawTint(ctx, look, { x: 0, y: 0, width, height });
    if (look.lights > 0) {
      const { glows, beams } = lightsOf(camera, things, placed);
      drawGlows(ctx, look, glows);
      drawBeams(ctx, look, beams);
    }
    drawLabels(ctx, placed);
    drawWeather(ctx, look, { width, height, t });
    const rect = { x: STRIP_SIDE_PX, y: height - STRIP_H_PX - STRIP_BOTTOM_PX, width: width - 2 * STRIP_SIDE_PX, height: STRIP_H_PX };
    drawProfileStrip(ctx, strip, { rect, me, riders: riders.map((r) => ({ d: r.d, mine: r.mine, look: r.look })), viewM: SPAN_M });
  }

  return {
    draw,
    /** My road changed (a junction turn): the land, the scenery and the profile strip are remade for it, on the next draw. */
    setRoute: (next) => {
      pendingRoute = next;
    },
    resize: () => bands.resize(),
    dispose: () => bands.resize(),
  };
}
