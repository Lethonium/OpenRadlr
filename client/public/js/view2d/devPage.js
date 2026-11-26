/**
 * The 2D views' developer page: builds the valley world in the page, bakes the sprites for real, puts a few
 * riders on the route and draws the view. A dev aid like the sprite probe, not part of the app.
 * `?view=map&season=summer&time=day|golden|dusk|night&weather=clear|rain|snow&d=300&still`
 * `still` draws one finished frame (every sprite baked) and sets `window.__ready`; otherwise it animates.
 */
import { RouteGeometry } from "../route/geometry.js";
import { lookOf } from "../view3d/assets/riders/look.js";
import { buildSceneNow } from "../view3d/worldScene.js";
import { SEASONS } from "../world/seasons.js";
import { groundSampler } from "./groundSampler.js";
import { look2d } from "./look2d.js";
import { createMapView } from "./mapView.js";
import { createSpriteBaker } from "./sprites/baker.js";
import { createSpriteStore } from "./sprites/spriteStore.js";
import { indexWorld } from "./worldIndex.js";

/** Riders put on the route: a kit colour, a lane, and metres ahead (or behind) of me. */
const KITS = Object.freeze([
  { name: "You", color: "#ff7a1a", lane: 1, gap: 0, mine: true }, // i18n-ok: developer page
  { name: "Mara", color: "#2f7de1", lane: 0, gap: 9 }, // i18n-ok: developer page
  { name: "Jonas", color: "#e23b5b", lane: 2, gap: 4 }, // i18n-ok: developer page
  { name: "Lea", color: "#28b37a", lane: 1, gap: -7 }, // i18n-ok: developer page
  { name: "Tom", color: "#9b5de5", lane: 0, gap: 22 }, // i18n-ok: developer page
  { name: "Ines", color: "#f2c230", lane: 2, gap: -15 }, // i18n-ok: developer page
]);
/** The id of my rider. */
const ME_ID = "You"; // i18n-ok: developer page
const LANE_SPREAD_M = 1.4;
const SPEED_MS = 9;
const STILL_TIME_S = 1.3;
const TIMES = Object.freeze(["day", "golden", "dusk", "night"]);

const fetchJson = (url) => fetch(url).then((response) => response.json());
const pick = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback);

/** A rider's place on the route at `d`, `lane` across (x, z in world metres, heading clockwise from north). */
function frameAt(route, d, lane) {
  const p = route.positionAt(d);
  const n = route.positionAt(d + 2);
  const [tx, tz] = [n.x - p.x, -(n.y - p.y)];
  const l = Math.hypot(tx, tz) || 1;
  const off = (lane - (route.lanes - 1) / 2) * LANE_SPREAD_M;
  return { x: p.x + (-tz / l) * off, z: -p.y + (tx / l) * off, heading: Math.atan2(tx / l, -tz / l) };
}

async function main() {
  const query = new URLSearchParams(location.search);
  const season = pick(query.get("season"), SEASONS, "summer");
  const timeMode = pick(query.get("time"), TIMES, "day");
  const kind = pick(query.get("weather"), ["clear", "rain", "snow"], "clear");
  const viewName = query.get("view") ?? "map";
  const startD = Number(query.get("d") ?? 300);
  const still = query.has("still");
  const canvas = document.getElementById("c");
  const info = document.getElementById("info");
  const ctx = canvas.getContext("2d");

  const [routeFile, networkFile] = await Promise.all([fetchJson("/routes/rolling-hills.json"), fetchJson("/routes/maps/valley.json")]);
  const route = new RouteGeometry(routeFile);
  const t0 = performance.now();
  const scene = buildSceneNow(routeFile, [], networkFile, "temperate", season, "low");
  const builtMs = performance.now() - t0;

  const baker = createSpriteBaker({ season });
  const store = createSpriteStore({ bake: baker.bake, now: () => performance.now(), budgetMs: still ? 1e9 : 6 });
  const look = look2d({ season, timeMode, weather: { kind, strength: 1 }, precipitation: kind === "clear" ? 0 : 1 });
  store.setNight(look.night);
  const view = createMapView({ scene, route, index: indexWorld(scene), sampler: groundSampler(scene.ground), store, createCanvas: (w, h) => new OffscreenCanvas(w, h) });
  const looks = KITS.map((kit, i) => ({ ...lookOf(i), primary: kit.color }));

  function resize() {
    canvas.width = Math.round(innerWidth * devicePixelRatio);
    canvas.height = Math.round(innerHeight * devicePixelRatio);
    view.resize();
  }
  resize();
  addEventListener("resize", resize);

  function frame(t) {
    const meD = route.wrap(startD + t * SPEED_MS);
    const meAt = frameAt(route, meD, 1);
    const riders = KITS.map((kit, i) => ({
      ...frameAt(route, route.wrap(meD + kit.gap + Math.sin(t * 0.3 + i) * 1.5), kit.lane),
      id: kit.name, // i18n-ok: developer page
      look: looks[i],
      name: kit.name,
      mine: Boolean(kit.mine),
    }));
    view.draw(ctx, { width: canvas.width, height: canvas.height, me: { ...meAt, distance: meD, lane: 1, id: ME_ID }, riders, look, t });
  }

  const summary = (extra) => `${viewName} · ${season} · ${timeMode} · ${kind} · world built in ${Math.round(builtMs)} ms${extra}`; // i18n-ok: developer page
  if (viewName !== "map") info.textContent = summary(" · only the map is drawn so far"); // i18n-ok: developer page
  if (still) {
    // Draw to ask for the sprites, bake them all, draw again until nothing new is asked for.
    const start = performance.now();
    let rounds = 0;
    do {
      frame(STILL_TIME_S);
      rounds += 1;
    } while (store.pump() > 0 && rounds < 10);
    frame(STILL_TIME_S);
    info.textContent = summary(` · ${store.bytes() / 1e6 | 0} MB of sprites in ${Math.round(performance.now() - start)} ms, ${store.failed().length} failed`); // i18n-ok: developer page
    window.__ready = true;
    return;
  }
  const begin = performance.now();
  info.textContent = summary("");
  const loop = () => {
    store.pump();
    frame((performance.now() - begin) / 1000);
    requestAnimationFrame(loop);
  };
  loop();
}

main().catch((error) => {
  document.getElementById("info").textContent = `failed: ${error.message}`; // i18n-ok: developer page
  console.error(error);
});
