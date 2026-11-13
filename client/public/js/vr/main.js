/**
 * Composition root of the VR page (a paired headset or any browser): watches
 * the tablet's ride through the relay as a "world" watcher and draws it in a
 * View3D, in a 2D window. No logic of its own worth testing: the decisions
 * live in vrWorld.js and hud2d.js.
 */
import { applyTranslations } from "../i18n/apply.js";
import { initLocale, t } from "../i18n/i18n.js";
import { defaultServerUrl } from "../net/protocol.js";
import { ProfileStore } from "../profile/profileStore.js";
import { CockpitConnection } from "../cockpit/cockpitConnection.js";
import { CockpitModel } from "../cockpit/cockpitModel.js";
import { RiderSmoother } from "../ride/smoothing.js";
import { RiderStamps } from "../ride/riderStamps.js";
import { RouteGeometry } from "../route/geometry.js";
import { fetchMapNeighbours, fetchMapNetwork, roadNetworkOf } from "../route/worldMap.js";
import { formatGrade, formatNumber, formatSpeed, setUnits, speedUnit } from "../util/format.js";
import { ScreenWakeLock } from "../util/wakeLock.js";
import { themeColors } from "../view/canvas.js";
import { routesOf } from "../view/startMenu.js";
import { studioSceneRiders, studioWorld } from "../view/studioWorld.js";
import { viewControls } from "../view/viewControls.js";
import { DEFAULT_BIOME, resolveBiome } from "../view3d/biomes/index.js";
import { StudioCamera, cameraModeOf } from "../view3d/studioCamera.js";
import { CAMERA_MODES, TIME_MODES, View3D } from "../view3d/view3d.js";
import { buildScene } from "../view3d/worldScene.js";
import { hudValues } from "./hud2d.js";
import { VrWorld, pickHost, worldWanted } from "./vrWorld.js";

const COCKPIT_KEY = "openradlr.cockpit";
const CAMERA_KEY = "openride.camera";
const STUDIO_CAMERA_KEY = "openradlr.studio-camera";
const TIME_KEY = "openride.time";
const QUALITY_KEY = "openride.quality";
const BIOME_KEY = "openride.biome";
const HUD_MS = 250;

const $ = (id) => document.getElementById(id);
const nowS = () => Date.now() / 1000;
const setting = (key) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

function pairing(storage) {
  try {
    const stored = JSON.parse(storage.getItem(COCKPIT_KEY));
    return typeof stored?.key === "string" && /^[0-9a-f]{32}$/.test(stored.key) ? stored : null;
  } catch {
    return null;
  }
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}
const fetchRouteFile = (id) => fetchJson(`/api/route?id=${encodeURIComponent(id)}`);
const fetchNetworkFile = (mapId) => fetchJson(`/api/map?id=${encodeURIComponent(mapId)}`);

/** The routes the server offers (for the map's neighbours); empty if /api/info fails. */
let infoRoutes = null;
async function listedRoutes() {
  infoRoutes ??= fetchJson("/api/info").then(routesOf, () => []);
  return infoRoutes;
}

function biomeId() {
  const saved = setting(BIOME_KEY);
  return saved && resolveBiome(saved).id === saved ? saved : DEFAULT_BIOME;
}

async function buildRouteWorld(routeId) {
  const [file, routes] = await Promise.all([fetchRouteFile(routeId), listedRoutes()]);
  const [others, network] = await Promise.all([fetchMapNeighbours(file, routes, fetchRouteFile), fetchMapNetwork(file, fetchNetworkFile)]);
  const scene = await buildScene(file, others, { network, biome: biomeId() });
  const route = new RouteGeometry(file);
  const known = new Map([[route.id, route]]);
  for (const other of others) known.set(other.id, new RouteGeometry(other));
  return { kind: "route", route, scene, routes: known, network: network ? roadNetworkOf(network) : null };
}

async function buildStudioWorld() {
  const world = await studioWorld({ routes: await listedRoutes(), biome: biomeId(), fetchRouteFile, fetchNetwork: fetchNetworkFile, buildScene });
  if (!world) throw new Error("no studio world");
  return { kind: "studio", ...world };
}

function start() {
  initLocale({ storage: localStorage, languages: navigator.languages });
  applyTranslations();
  setUnits(new ProfileStore().load().units);
  const paired = pairing(localStorage);
  if (!paired) {
    $("vr-unpaired").hidden = false;
    return;
  }
  $("vr-forget").hidden = false;
  $("vr-forget").addEventListener("click", () => {
    localStorage.removeItem(COCKPIT_KEY);
    location.href = "index.html";
  });

  const model = new CockpitModel({ now: () => Date.now() });
  const connection = new CockpitConnection({ url: defaultServerUrl(), key: paired.key, view: "world" });
  const stamps = new RiderStamps({ now: nowS });
  const wakeLock = new ScreenWakeLock();
  const vrWorld = new VrWorld({ buildRouteWorld, buildStudioWorld });
  let name = paired.name;
  let riderId = null;
  let latest = null;
  let host = null;
  let view = null;
  let world = null;
  let smoother = null;
  let wasLive = false;

  const note = (text) => {
    $("vr-note").textContent = text ?? "";
    $("vr-note").hidden = !text;
  };

  connection.on("status", (status) => {
    name = status.name ?? name;
    riderId = status.riderId;
    model.onStatus(status);
  });
  connection.on("state", (message) => {
    vrWorld.want(worldWanted(message, riderId));
    host = pickHost(message.riders, riderId);
    // The cockpit model follows one rider: the host.
    model.onState({ ...message, riders: host ? [host] : [] }, name);
    if (message.type === "state") {
      const riders = message.riders.map((rider) => stamps.stamp(rider));
      stamps.keep(message.riders);
      smoother?.update(riders, nowS());
    }
    latest = message;
  });
  connection.on("display", (data) => model.onDisplay(data));
  connection.on("invalid", () => {
    $("vr-invalid").hidden = false;
  });

  vrWorld.on("failed", (error) => {
    console.error(error);
    note(t("vr.unavailable"));
  });
  vrWorld.on("world", (built) => {
    // Drop the old world's buffers before the new one is uploaded.
    view?.dispose();
    view = null;
    world = built;
    smoother = null;
    note("");
    try {
      view = new View3D($("world3d"), $("labels3d"), built.route, built.scene);
    } catch (error) {
      console.error(error);
      note(t("vr.unavailable"));
      return;
    }
    view.routes = built.routes;
    view.network = built.network;
    view.setQuality(setting(QUALITY_KEY) === "low" ? "low" : "high");
    view.setTimeMode(TIME_MODES.includes(setting(TIME_KEY)) ? setting(TIME_KEY) : "day");
    if (built.kind === "studio") {
      const seat = host?.seat ?? 3;
      const reducedMotion = Boolean(globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
      view.camera = new StudioCamera(built.scene.studio, latest?.room ?? 0, seat, cameraModeOf(setting(STUDIO_CAMERA_KEY)), { reducedMotion });
    } else {
      smoother = new RiderSmoother(built.route, { routeOf: (rider) => built.routes.get(rider.route) });
      const camera = setting(CAMERA_KEY);
      if (CAMERA_MODES[camera]) view.setCameraMode(camera);
    }
    renderCameraButton();
  });

  const cameraLabel = (mode) => viewControls({ studio: world?.kind === "studio" }).cameras.find((camera) => camera.id === mode)?.label ?? mode;
  function renderCameraButton() {
    $("vr-camera").hidden = !view;
    if (view) $("vr-camera").textContent = t("camera.label", { mode: cameraLabel(view.camera.mode) });
  }
  function cycleCamera() {
    if (!view) return;
    const studio = world.kind === "studio";
    const cameras = viewControls({ studio }).cameras;
    const index = cameras.findIndex((camera) => camera.id === view.camera.mode);
    if (index < 0) return;
    const next = cameras[(index + 1) % cameras.length].id;
    view.setCameraMode(next);
    try {
      localStorage.setItem(studio ? STUDIO_CAMERA_KEY : CAMERA_KEY, next);
    } catch {
      // Not remembered; the camera still changed.
    }
    renderCameraButton();
  }
  $("vr-camera").addEventListener("click", cycleCamera);
  window.addEventListener("keydown", (event) => {
    if (event.key.toLowerCase() === "c" && !event.ctrlKey && !event.metaKey && !event.altKey) cycleCamera();
  });

  const frame = () => {
    requestAnimationFrame(frame);
    if (!view || !latest || !host) return;
    const timeS = nowS();
    let riders;
    if (world.kind === "studio") {
      if (latest.type !== "studio_state") return;
      view.setStudioRooms(latest.rooms);
      view.camera.place?.(latest.room, host.seat);
      riders = studioSceneRiders(latest);
    } else {
      if (latest.type !== "state" || !smoother) return;
      riders = smoother.sample(timeS);
    }
    view.render({ riders, myId: riderId, myCadence: host.cadence ?? 0, timeS, colors: themeColors() });
  };

  const renderHud = () => {
    const status = model.status;
    $("vr-waiting").textContent = name ? t("vr.waiting", { name }) : t("vr.waitingTablet");
    $("vr-waiting").hidden = status !== "waiting" || !$("vr-invalid").hidden;
    $("vr-badge").hidden = status !== "stale";
    $("vr-hud").hidden = status === "waiting";
    const values = hudValues(model, host);
    const known = (value, format) => (value === null || value === undefined ? "–" : format(value));
    $("vr-power").textContent = known(values.power, (v) => formatNumber(v, 0));
    $("vr-cadence").textContent = known(values.cadence, (v) => formatNumber(v, 0));
    $("vr-speed").textContent = known(values.speedKmh, (kmh) => formatSpeed(kmh / 3.6));
    $("vr-speed-unit").textContent = speedUnit();
    $("vr-grade").textContent = known(values.grade, formatGrade);
    $("vr-hr").textContent = known(values.heartRate, (v) => formatNumber(v, 0));
    $("vr-hr-stat").hidden = values.heartRate === null;
    const live = status === "live";
    if (live !== wasLive) {
      wasLive = live;
      if (live) wakeLock.acquire();
      else wakeLock.release();
    }
  };

  window.openradlrVr = { get view3d() { return view; }, source: null };
  connection.start();
  setInterval(renderHud, HUD_MS);
  requestAnimationFrame(frame);
}

start();
