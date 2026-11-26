/**
 * The 2D map: the world seen from above, heading up, drawn from the 3D world's scene with sprites baked
 * from the 3D assets. The ground, roads and scenery sit in tiles (mapTiles.js); each frame draws the tiles
 * the rotated view covers, the crowd and animals, the riders (sprites at 2.4×, labels upright), lemons and
 * the draft band as the old map drew them, then the time of day's tint, lamps and bike lights after dark,
 * and the weather.
 */
import { soloRiders, vehicleMarkers } from "../ride/vehicle.js";
import { drawDraft, drawLemons } from "../view/rideMapView.js";
import { MAP_TILE_M, createMapTiles } from "./mapTiles.js";
import { drawGlows, drawTint, drawWeather } from "./overlays.js";
import { drawSprite } from "./drawSprite.js";
import { spriteJobs } from "./sprites/catalog.js";

/** Metres of road the canvas height shows, where the rider sits down it, and how much bigger than life riders are drawn. */
export const MAP_SPAN_M = 95;
export const MAP_RIDER_Y = 0.58;
export const MAP_RIDER_SCALE = 2.4;
/** A vehicle (tandem, beer bike) is drawn this much bigger than life. */
const VEHICLE_SCALE = 1.6;
/** The cyclist sprite's forward is -x: turn it a quarter to point at the heading. */
const RIDER_TURN = Math.PI / 2;
const SEA = "#1d4a5e";
const LABEL_FONT = "600 12px system-ui, sans-serif"; // i18n-ok: a css font
const DEFAULT_COLORS = Object.freeze({ me: "#ff7a1a", text: "#ffffff" });
const VEHICLE_JOBS = Object.freeze({ tandem: "tandem", beer_bike: "beer-bike" });
const LAMP_GLOW = Object.freeze({ r: 9, rgb: [1, 0.77, 0.47], a: 0.45 });
const WINDOW_GLOW = Object.freeze({ r: 3.2, rgb: [1, 0.82, 0.51], a: 0.55 });
const CAFE_GLOW = Object.freeze({ r: 14, rgb: [1, 0.75, 0.43], a: 0.5 });
const HEADLIGHT = Object.freeze({ r: 6, rgb: [1, 0.98, 0.88], a: 0.5 });
const TAILLIGHT = Object.freeze({ r: 1.6, rgb: [1, 0.16, 0.16], a: 0.35 });
const PRIORITY_PER_M = 1;

/** The first top-view sprite job of a workbench id. */
const topJobs = new Map(spriteJobs({ view: "top" }).map((job) => [job.id, job]));

/**
 * @param {{scene: object, route: object, index: {query: Function}, sampler: object, store: object, createCanvas: (w: number, h: number) => object}} deps
 * @returns {{draw: Function, resize: () => void, dispose: () => void}}
 */
export function createMapView({ scene, route, index, sampler, store, createCanvas }) {
  const tiles = createMapTiles({ scene, index, sampler, store, createCanvas });

  /** A top sprite for a catalog job, asked for at `priority` (metres from the rider). */
  function sprite(job, priority) {
    if (!job) return null;
    store.want(job, priority);
    return store.get(job.key);
  }

  /** Draws the tiles the rotated view touches; returns the metres from the rider that cover the view. */
  function drawTiles(ctx, { me, width, height, scale, look }) {
    const [cos, sin] = [Math.cos(me.heading), Math.sin(me.heading)];
    const [w, h] = [width / scale, height / scale];
    // The screen's corners in world metres, relative to the rider.
    const corners = [-w / 2, w / 2].flatMap((sx) => [-MAP_RIDER_Y * h, (1 - MAP_RIDER_Y) * h].map((sy) => [sx * cos - sy * sin, sx * sin + sy * cos]));
    const [x0, x1] = [Math.min(...corners.map((c) => c[0])), Math.max(...corners.map((c) => c[0]))];
    const [z0, z1] = [Math.min(...corners.map((c) => c[1])), Math.max(...corners.map((c) => c[1]))];
    const axes = [[1, 0], [0, 1], [cos, sin], [-sin, cos]];
    const view = axes.map(([ax, az]) => {
      const spans = corners.map(([cx, cz]) => cx * ax + cz * az);
      return [Math.min(...spans), Math.max(...spans)];
    });
    for (let tx = Math.floor((me.x + x0) / MAP_TILE_M); tx <= Math.floor((me.x + x1) / MAP_TILE_M); tx += 1) {
      for (let tz = Math.floor((me.z + z0) / MAP_TILE_M); tz <= Math.floor((me.z + z1) / MAP_TILE_M); tz += 1) {
        const square = [0, 1].flatMap((i) => [0, 1].map((j) => [(tx + i) * MAP_TILE_M - me.x, (tz + j) * MAP_TILE_M - me.z]));
        const apart = axes.some(([ax, az], k) => {
          const spans = square.map(([cx, cz]) => cx * ax + cz * az);
          return Math.max(...spans) <= view[k][0] || Math.min(...spans) >= view[k][1];
        });
        if (apart) continue;
        const canvas = tiles.tile(tx, tz, look, Math.hypot((tx + 0.5) * MAP_TILE_M - me.x, (tz + 0.5) * MAP_TILE_M - me.z));
        ctx.drawImage(canvas, tx * MAP_TILE_M - 0.04, tz * MAP_TILE_M - 0.04, MAP_TILE_M + 0.08, MAP_TILE_M + 0.08);
      }
    }
    return Math.max(...corners.map(([cx, cz]) => Math.hypot(cx, cz)));
  }

  function drawMovers(ctx, items, me) {
    const spectator = topJobs.get("spectator");
    for (const item of items) {
      const priority = Math.hypot(item.x - me.x, item.z - me.z) * PRIORITY_PER_M;
      if (item.layer === "person") {
        const s = sprite(spectator, priority);
        if (s) drawSprite(ctx, s, item.x, item.z, 1);
      } else if (item.layer === "animal") {
        const s = sprite(topJobs.get(item.id), priority);
        if (!s) continue;
        ctx.save();
        ctx.translate(item.x, item.z);
        ctx.rotate(item.yaw);
        drawSprite(ctx, s, 0, 0, 1);
        ctx.restore();
      }
    }
  }

  function drawBike(ctx, s, rider, scale, alpha = 1) {
    ctx.save();
    ctx.translate(rider.x, rider.z);
    ctx.rotate(rider.heading + RIDER_TURN);
    drawSprite(ctx, s, 0, 0, scale, { alpha });
    ctx.restore();
  }

  function drawRiderMark(ctx, rider, me, priority) {
    const s = store.rider(rider.look, "top", priority);
    if (s) drawBike(ctx, s, rider, MAP_RIDER_SCALE, rider.ghost ? 0.35 : 1);
    else {
      ctx.fillStyle = rider.color ?? "#e8473f";
      ctx.beginPath();
      ctx.arc(rider.x, rider.z, 1.2, 0, Math.PI * 2);
      ctx.fill();
    }
    if (rider.ghost) {
      ctx.save();
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 0.2;
      ctx.setLineDash([0.8, 0.8]);
      ctx.beginPath();
      ctx.arc(rider.x, rider.z, 1.6, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  /** Labels are in screen pixels, upright: (x, z) through the camera. */
  function drawLabels(ctx, marks, camera) {
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.font = LABEL_FONT;
    for (const mark of marks) {
      if (!mark.label || mark.mine) continue;
      const at = camera.toScreen({ x: mark.x, y: -mark.z });
      const y = at.y - MAP_RIDER_SCALE * camera.scale * 1.1;
      const w = ctx.measureText(mark.label).width + 8;
      ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
      ctx.fillRect(at.x - w / 2, y - 12, w, 16);
      ctx.fillStyle = "#ffffff";
      ctx.fillText(mark.label, at.x, y);
    }
    ctx.restore();
  }

  /** What glows after dark, in world coordinates. */
  function glowsOf(items, riders) {
    const glows = [];
    for (const item of items) {
      if (item.layer === "lamp") glows.push({ ...LAMP_GLOW, x: item.x, y: item.z });
      else if (item.layer === "cafe") glows.push({ ...CAFE_GLOW, x: item.x, y: item.z });
      else if (item.layer === "house" && item.seed % 3 !== 0) glows.push({ ...WINDOW_GLOW, x: item.x + (item.facing?.[0] ?? 0) * item.d * 0.42, y: item.z + (item.facing?.[1] ?? 0) * item.d * 0.42 });
    }
    for (const r of riders) {
      const [fx, fz] = [Math.sin(r.heading), -Math.cos(r.heading)];
      glows.push({ ...HEADLIGHT, x: r.x + fx * 4, y: r.z + fz * 4 }, { ...TAILLIGHT, x: r.x - fx * 1.1, y: r.z - fz * 1.1 });
    }
    return glows;
  }

  function draw(ctx, { width, height, me, riders = [], draft = null, lemons = [], look, t = 0, colors = DEFAULT_COLORS }) {
    const scale = height / MAP_SPAN_M;
    const [anchorX, anchorY] = [width / 2, height * MAP_RIDER_Y];
    // The route's own coordinates (x, y = -z) through the same camera, for the lemons and the draft band.
    const [cos, sin] = [Math.cos(me.heading), Math.sin(me.heading)];
    const camera = {
      scale,
      rider: { x: anchorX, y: anchorY },
      toScreen: ({ x, y }) => {
        const [dx, dz] = [x - me.x, -y - me.z];
        return { x: anchorX + (dx * cos + dz * sin) * scale, y: anchorY + (-dx * sin + dz * cos) * scale };
      },
    };
    ctx.save();
    ctx.fillStyle = SEA;
    ctx.fillRect(0, 0, width, height);
    ctx.translate(anchorX, anchorY);
    ctx.scale(scale, scale);
    ctx.rotate(-me.heading);
    ctx.translate(-me.x, -me.z);
    const reach = drawTiles(ctx, { me, width, height, scale, look });
    const view = index.query(me.x - reach, me.z - reach, me.x + reach, me.z + reach);
    drawMovers(ctx, view, me);
    const solo = soloRiders(riders);
    const vehicles = vehicleMarkers(riders, me.id);
    for (const rider of solo) drawRiderMark(ctx, rider, me, Math.hypot(rider.x - me.x, rider.z - me.z));
    for (const marker of vehicles) {
      const s = sprite(topJobs.get(VEHICLE_JOBS[marker.kind]), 0);
      if (s) drawBike(ctx, s, marker.rider, VEHICLE_SCALE);
      else drawRiderMark(ctx, marker.rider, me, 0);
    }
    ctx.restore();

    // The old map's helpers work in screen pixels.
    drawDraft(ctx, { route, me, draft, camera, colors });
    drawLemons(ctx, { route, lemons, camera, width, height });
    drawTint(ctx, look, { x: 0, y: 0, width, height });
    if (look.lights > 0) {
      ctx.save();
      ctx.translate(anchorX, anchorY);
      ctx.scale(scale, scale);
      ctx.rotate(-me.heading);
      ctx.translate(-me.x, -me.z);
      drawGlows(ctx, look, glowsOf(view, [...solo, ...vehicles.map((m) => m.rider)]));
      ctx.restore();
    }
    drawLabels(ctx, [...solo.map((r) => ({ x: r.x, z: r.z, label: r.name, mine: r.mine })), ...vehicles.map((m) => ({ x: m.rider.x, z: m.rider.z, label: m.label, mine: m.mine }))], camera);
    drawWeather(ctx, look, { width, height, t });
  }

  return {
    draw,
    /** The canvas changed size or pixel ratio: the tiles go and are remade as the view needs them. */
    resize: () => tiles.clear(),
    dispose: () => tiles.clear(),
  };
}
