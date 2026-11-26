/**
 * The 2D views of a ride, the controller `main.js` talks to next to `View3D`: the top-down map and the side view,
 * drawn from the 3D world's scene with sprites baked on the device. It turns the ride's riders (distance, lane) into
 * what the views draw (a place and heading on the map, a distance on the side view), keeps the day's look (time,
 * season, weather) and the sprite store fed, and draws the picked view on its canvas once a frame.
 * `available` is false when the sprite baker cannot start (no WebGL2, context lost): the caller then keeps the old map.
 */
import { lookOf } from "../view3d/assets/riders/look.js";
import { riderPosition } from "../world/roads.js";
import { precipitationAt, weatherFor } from "../world/weather.js";
import { riderColor } from "../view/canvas.js";
import { riderLabel } from "../view/remoteRiders.js";
import { t } from "../i18n/i18n.js";
import { groundSampler } from "./groundSampler.js";
import { look2d } from "./look2d.js";
import { createMapView } from "./mapView.js";
import { createSideView } from "./sideView.js";
import { createSpriteBaker } from "./sprites/baker.js";
import { createSpriteStore } from "./sprites/spriteStore.js";
import { indexWorld } from "./worldIndex.js";

/** The largest pixel ratio the views draw at: sharper than this costs more than it shows. */
const MAX_PIXEL_RATIO = 2;
/** The ghost's kit colour (the 3D view's ghost tint). */
const GHOST_COLOR = "#bfe6ff";
/** A moving rider's cadence when only their power is known, as the 3D view assumes. */
const PEDALLING_RPM = 85;
/** The look is rebuilt when its inputs change, and at least this often (s) for a time of day that follows the clock. */
const LOOK_REFRESH_S = 60;
/** The precipitation is rounded to this step so a slow shower does not rebuild the look every frame. */
const PRECIPITATION_STEP = 0.02;
const GOLDEN_PHASE = 0.618;

const defaultCanvas = (w, h) => {
  if (typeof OffscreenCanvas === "function") return new OffscreenCanvas(w, h);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  return canvas;
};

export class View2D {
  /** False when the baker could not start: render then draws nothing. */
  available = false;
  #canvas;
  #route;
  #scene;
  #season;
  #timeMode;
  #weatherInput;
  #createCanvas;
  #mode = "map";
  #baker = null;
  #store = null;
  #views = null;
  #sampler = null;
  #index = null;
  #size = "";
  #looks = new Map();
  #lookCache = null;

  /**
   * @param {object} canvas the 2D canvas element
   * @param {object} route RouteGeometry of my route
   * @param {object} scene the world scene (`buildScene`'s result)
   * @param {{season?: string, timeMode?: string, weather?: {date?: Date, override?: object}, createBaker?: (options: {season: string}) => object, createCanvas?: (w: number, h: number) => object, now?: () => number, budgetMs?: number}} [options]
   */
  constructor(canvas, route, scene, { season = "summer", timeMode = "day", weather = null, createBaker = createSpriteBaker, createCanvas = defaultCanvas, now = () => performance.now(), budgetMs } = {}) {
    this.#canvas = canvas;
    this.#route = route;
    this.#scene = scene;
    this.#season = season;
    this.#timeMode = timeMode;
    this.#weatherInput = { date: weather?.date ?? null, override: weather?.override ?? null };
    this.#createCanvas = createCanvas;
    try {
      this.#baker = createBaker({ season });
    } catch (error) {
      console.warn("The 2D views are unavailable:", error); // i18n-ok: developer log
      return;
    }
    this.#store = createSpriteStore({ bake: this.#baker.bake, now, ...(budgetMs ? { budgetMs } : {}) });
    this.available = true;
  }

  /** "map" or "side"; anything else keeps the current one. */
  setMode(mode) {
    if (mode === "map" || mode === "side") this.#mode = mode;
  }

  /** "auto", "day", "golden", "dusk" or "night". */
  setTimeMode(mode) {
    this.#timeMode = mode;
  }

  /** The day's weather as the constructor's `weather` option. */
  setWeather(weather) {
    this.#weatherInput = { date: weather?.date ?? null, override: weather?.override ?? null };
    this.#lookCache = null;
  }

  /** The canvas changed size or pixel ratio: what the views cached at the old scale goes. */
  resize() {
    this.#views?.map?.resize();
    this.#views?.side?.resize();
  }

  #view(mode) {
    this.#views ??= {};
    if (!this.#views[mode]) {
      this.#sampler ??= groundSampler(this.#scene.ground);
      this.#index ??= indexWorld(this.#scene);
      const deps = { scene: this.#scene, route: this.#route, sampler: this.#sampler, createCanvas: this.#createCanvas, index: this.#index, store: this.#store };
      this.#views[mode] = mode === "map" ? createMapView(deps) : createSideView(deps);
    }
    return this.#views[mode];
  }

  /** The day's weather: the fixed one if given, else the season's roll for this map and UTC day, or clear without a date. */
  #weather() {
    const { date: day, override } = this.#weatherInput;
    if (override) return override;
    if (!day) return { kind: "clear", strength: 0 };
    return weatherFor({ season: this.#season, seed: this.#scene.seed ?? 0, date: day });
  }

  #look(utcSeconds) {
    const date = new Date(utcSeconds * 1000);
    const weather = this.#weather();
    const precipitation = Math.round(precipitationAt(weather, utcSeconds) / PRECIPITATION_STEP) * PRECIPITATION_STEP;
    const key = `${this.#timeMode}|${weather.kind}|${weather.strength}|${precipitation}`;
    const cache = this.#lookCache;
    if (cache && cache.key === key && Math.abs(utcSeconds - cache.at) < LOOK_REFRESH_S) return cache.look;
    const look = look2d({ season: this.#season, timeMode: this.#timeMode, date, weather, precipitation });
    this.#lookCache = { key, at: utcSeconds, look };
    return look;
  }

  /** The rider's look: the 3D view's look of their id, in their kit colour; one object per look so the store's key is stable. */
  #lookOf(id, color) {
    const key = `${id}|${color}`;
    let look = this.#looks.get(key);
    if (!look) {
      look = { ...lookOf(Number.isInteger(id) ? id : 0), primary: color };
      this.#looks.set(key, look);
    }
    return look;
  }

  #colorOf(rider, myId, colors) {
    return rider.ghost ? GHOST_COLOR : riderColor(rider, myId, colors);
  }

  /** A rider as the map draws them: a place and heading in the world. */
  #onMap(rider, myId, colors) {
    const { position, forward } = riderPosition(this.#route, rider.distance, rider.lane);
    return {
      id: rider.id,
      x: position[0],
      z: position[2],
      heading: Math.atan2(forward[0], -forward[2]),
      look: this.#lookOf(rider.id, this.#colorOf(rider, myId, colors)),
      name: riderLabel(rider, t),
      mine: rider.id === myId,
      ghost: Boolean(rider.ghost),
      vehicle: rider.vehicle,
    };
  }

  /** A rider as the side view draws them: a distance and lane along my road. */
  #onSide(rider, myId, colors, myCadence) {
    const cadence = rider.id === myId ? myCadence : rider.power > 0 ? PEDALLING_RPM : 0;
    return {
      id: rider.id,
      d: rider.distance,
      lane: rider.lane,
      look: this.#lookOf(rider.id, this.#colorOf(rider, myId, colors)),
      name: riderLabel(rider, t),
      mine: rider.id === myId,
      ghost: Boolean(rider.ghost),
      cadence,
      phase: ((Number(rider.id) || 0) * GOLDEN_PHASE) % 1,
      vehicle: rider.vehicle,
    };
  }

  /**
   * Draws the picked view and bakes the sprites it asked for, within the store's budget.
   * @param {{riders: object[], myId: number, me?: object, myCadence?: number, draft?: object|null, lemons?: object[], ghost?: object|null, utcSeconds?: number, timeS?: number, colors: object}} frame
   *   `riders` are the ride's riders on my route, as the 3D view gets them.
   */
  render({ riders, myId, me, myCadence = 0, draft = null, lemons = [], ghost = null, timeS = 0, utcSeconds = 0, colors }) {
    if (!this.available) return;
    const ratio = Math.min(globalThis.devicePixelRatio || 1, MAX_PIXEL_RATIO);
    // The views draw in CSS pixels; the backing store has `ratio` device pixels to each, set as the context's transform.
    const width = Math.max(1, Math.round(this.#canvas.clientWidth));
    const height = Math.max(1, Math.round(this.#canvas.clientHeight));
    const size = `${width}x${height}x${ratio}`;
    if (size !== this.#size) {
      this.#size = size;
      this.#canvas.width = Math.round(width * ratio);
      this.#canvas.height = Math.round(height * ratio);
      this.resize();
    }
    const ctx = this.#canvas.getContext("2d");
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.#canvas.width, this.#canvas.height);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    const mine = me ?? riders.find((rider) => rider.id === myId);
    if (!mine) return;
    const look = this.#look(utcSeconds);
    this.#store.setNight(look.night);
    const everyone = ghost ? [...riders, ghost] : riders;
    if (this.#mode === "side") {
      this.#view("side").draw(ctx, {
        width,
        height,
        ratio,
        look,
        t: timeS,
        me: { d: mine.distance, id: mine.id },
        riders: everyone.map((rider) => this.#onSide(rider, myId, colors, myCadence)),
        lemons,
      });
    } else {
      const here = this.#onMap(mine, myId, colors);
      this.#view("map").draw(ctx, {
        width,
        height,
        look,
        t: timeS,
        colors,
        me: { x: here.x, z: here.z, heading: here.heading, distance: mine.distance, lane: mine.lane, id: mine.id },
        riders: everyone.map((rider) => this.#onMap(rider, myId, colors)),
        draft,
        lemons,
      });
    }
    this.#store.pump();
  }

  dispose() {
    this.#views?.map?.dispose();
    this.#views?.side?.dispose();
    this.#views = null;
    this.#baker?.dispose();
    this.#baker = null;
    this.available = false;
  }
}
