/**
 * Composition root of the VR page (a paired headset or any browser): watches
 * the tablet's ride through the relay as a "world" watcher and draws it in a
 * View3D, in a 2D window, with the ride screen's HUD (view/rideHud.js) filled
 * from the relayed state and the display frames. No logic of its own worth
 * testing: the decisions live in vrWorld.js and rideHud.js.
 */
import { applyTranslations } from "../i18n/apply.js";
import { initLocale, t } from "../i18n/i18n.js";
import { defaultServerUrl } from "../net/protocol.js";
import { deviceName } from "../net/deviceName.js";
import { pairDevice } from "../net/screenPairing.js";
import { mountPairNow } from "../view/codeInput.js";
import { ProfileStore } from "../profile/profileStore.js";
import { CockpitConnection } from "../cockpit/cockpitConnection.js";
import { CockpitModel } from "../cockpit/cockpitModel.js";
import { RiderSmoother } from "../ride/smoothing.js";
import { RiderStamps } from "../ride/riderStamps.js";
import { RouteGeometry } from "../route/geometry.js";
import { fetchMapNeighbours, fetchMapNetwork, roadNetworkOf } from "../route/worldMap.js";
import { distanceUnit, getUnits, setUnits, speedUnit } from "../util/format.js";
import { onRoute } from "../ride/roadRiders.js";
import { workoutName } from "../ride/workout.js";
import { ScreenWakeLock } from "../util/wakeLock.js";
import { themeColors } from "../view/canvas.js";
import { chooseLayout, raceStanding } from "../view/hud.js";
import { drawMinimap } from "../view/minimapView.js";
import { inRace, raceStatus } from "../view/panels.js";
import { drawProfile, drawUpcoming } from "../view/profileView.js";
import { drawWorkout } from "../view/workoutView.js";
import { drawRaceTimeline } from "../view/raceTimelineView.js";
import { RideHud, rideHudValues } from "../view/rideHud.js";
import { routesOf } from "../view/startMenu.js";
import { studioSceneRiders, studioWorld } from "../view/studioWorld.js";
import { viewControls } from "../view/viewControls.js";
import { DEFAULT_BIOME, resolveBiome } from "../view3d/biomes/index.js";
import { StudioCamera, cameraModeOf } from "../view3d/studioCamera.js";
import { CAMERA_MODES, TIME_MODES, View3D } from "../view3d/view3d.js";
import { Renderer, createContext } from "../view3d/renderer.js";
import { buildScene } from "../view3d/worldScene.js";
import { PreviewSource, parseHead } from "./previewSource.js";
import { VrWorld, pickHost, worldWanted } from "./vrWorld.js";
import { WebXrSource } from "./webXrSource.js";
import { workoutFromPlan, workoutState } from "./workoutFromPlan.js";
import { switchToXr } from "./xrLoop.js";

const COCKPIT_KEY = "openradlr.cockpit";
const CAMERA_KEY = "openride.camera";
const STUDIO_CAMERA_KEY = "openradlr.studio-camera";
const TIME_KEY = "openride.time";
const QUALITY_KEY = "openride.quality";
const BIOME_KEY = "openride.biome";
const HUD_MS = 250;
const DEFAULT_WEIGHT_KG = 75;
const DEFAULT_FTP = 200;

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

/** What the server says about itself, fetched once. */
let serverInfo = null;
const info = () => (serverInfo ??= fetchJson("/api/info"));

/** The routes the server offers (for the map's neighbours); empty if /api/info fails. */
const listedRoutes = () => info().then(routesOf, () => []);

/** The preview's head input from the page: dragging the canvas and the keyboard. */
function pageInput(canvas) {
  return {
    onDrag(fn) {
      let last = null;
      canvas.addEventListener("pointerdown", (event) => {
        last = event;
        canvas.setPointerCapture?.(event.pointerId);
      });
      canvas.addEventListener("pointermove", (event) => {
        if (!last) return;
        fn(event.clientX - last.clientX, event.clientY - last.clientY);
        last = event;
      });
      for (const end of ["pointerup", "pointercancel"]) canvas.addEventListener(end, () => (last = null));
    },
    onKey(fn) {
      window.addEventListener("keydown", (event) => {
        if (!event.ctrlKey && !event.metaKey && !event.altKey) fn(event.key);
      });
    },
  };
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

/** "Pair now" with an inline code entry, for a screen that is not (or no longer) paired. */
function offerPairing() {
  if (!$("vr-pairing").hidden) return;
  $("vr-pairing").hidden = false;
  mountPairNow({ button: $("vr-pair"), entry: $("vr-entry"), pair: (code) => pairDevice({ code, storage: localStorage }), onPaired: () => location.reload(), t: (key, params) => t(key, params), doc: document });
}

function start() {
  initLocale({ storage: localStorage, languages: navigator.languages });
  applyTranslations();
  const profile = new ProfileStore().load();
  /** The tablet's units once its display frames say them; until then, this device's own profile. */
  const applyUnits = (units) => {
    setUnits(units);
    for (const element of document.querySelectorAll("[data-unit]")) element.textContent = { speed: speedUnit(), distance: distanceUnit() }[element.dataset.unit] ?? element.textContent;
  };
  applyUnits(profile.units);
  const paired = pairing(localStorage);
  if (!paired) {
    $("vr-unpaired").hidden = false;
    offerPairing();
    return;
  }
  $("vr-forget").hidden = false;
  $("vr-forget").addEventListener("click", () => {
    localStorage.removeItem(COCKPIT_KEY);
    location.href = "index.html";
  });

  const model = new CockpitModel({ now: () => Date.now() });
  const connection = new CockpitConnection({ url: defaultServerUrl(), key: paired.key, view: "world", device: deviceName(navigator.userAgent) });
  const stamps = new RiderStamps({ now: nowS });
  const wakeLock = new ScreenWakeLock();
  const rideHud = new RideHud($("hud"), { drawProfile, drawMinimap, drawUpcoming, drawRaceTimeline, drawWorkout });
  const vrWorld = new VrWorld({ buildRouteWorld, buildStudioWorld });
  let name = paired.name;
  let riderId = null;
  let latest = null;
  let host = null;
  let view = null;
  let world = null;
  let smoother = null;
  let wasLive = false;
  let xrPreview = false;
  let xrSupported = false;
  let autoPreview = new URLSearchParams(location.search).get("preview") === "1";
  let source = null;
  /** The running workout's power so far, for its average: `{ key, sum, n }` (the HUD shows the average of the frames it saw). */
  let workoutPower = null;
  let planned = null;

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
    updatePreviewButton();
    // The cockpit model follows one rider: the host.
    model.onState({ ...message, riders: host ? [host] : [] }, name);
    if (message.type === "state") {
      const riders = message.riders.map((rider) => stamps.stamp(rider));
      stamps.keep(message.riders);
      smoother?.update(riders, nowS());
    }
    latest = message;
  });
  connection.on("display", (data) => {
    if (data.units && data.units !== getUnits()) applyUnits(data.units);
    model.onDisplay(data);
    trackAverage(data);
  });
  connection.on("invalid", () => {
    $("vr-invalid").hidden = false;
    offerPairing();
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
      // An XR-compatible context, so the headset can draw into it.
      const gl = createContext($("world3d"), { xrCompatible: true });
      if (!gl) throw new Error("WebGL 2 is not available");
      view = new View3D($("world3d"), $("labels3d"), built.route, built.scene, { renderer: new Renderer(gl) });
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
    if (built.kind === "route") $("hud-route").textContent = built.route.name;
    renderCameraButton();
    updatePreviewButton();
    updateEnterButton();
  });

  const cameraLabel = (mode) => viewControls({ studio: world?.kind === "studio" }).cameras.find((camera) => camera.id === mode)?.label ?? mode;
  function renderCameraButton() {
    // In the preview and in VR the camera is the head.
    $("vr-camera").hidden = !view || Boolean(source);
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

  /** Adds the host's power to the running workout's average; a new workout or ride starts over. */
  function trackAverage(data) {
    if (data.workout_plan) return;
    if (!data.workout) {
      workoutPower = null;
      return;
    }
    const key = `${data.ride}/${data.workout.id}`;
    if (workoutPower?.key !== key) workoutPower = { key, sum: 0, n: 0 };
    if (Number.isFinite(host?.power)) {
      workoutPower.sum += host.power;
      workoutPower.n += 1;
    }
  }

  /** The workout the tablet runs, built from its plan; null until the plan arrives or if it does not fit the position. */
  function workoutOnTablet(ftp) {
    const plan = model.plan;
    const position = model.workout;
    if (!plan || !position || plan.id !== position.id) return null;
    if (planned?.plan !== plan || planned.ftp !== ftp) planned = { plan, ftp, workout: workoutFromPlan(plan, ftp) };
    const state = workoutState(planned.workout, position);
    return state ? { workout: planned.workout, state, name: workoutName({ name: plan.id }) } : null;
  }

  /** What the ride HUD shows for the host: moving figures from the state, the rest from the display frames. */
  function hudSnapshot(me) {
    const rider = me ?? host;
    const stats = model.stats;
    return {
      power: rider.power,
      cadence: model.cadence,
      heartRate: model.hr,
      me,
      route: world.route,
      rideDistanceM: stats?.distanceM ?? 0,
      elapsedS: stats?.elapsedS ?? 0,
      target: model.workout?.target_w ?? null,
      // The tablet's intensity setting is not in the display frames; its target already includes it.
      intensity: 1,
      weightKg: profile.weightKg ?? DEFAULT_WEIGHT_KG,
      ftp: model.ftp ?? profile.ftp ?? DEFAULT_FTP,
    };
  }

  /** The ride screen's HUD for the host. */
  function renderRideHud(me, riders) {
    const rider = me ?? host;
    const race = latest.race ?? null;
    const layout = chooseLayout({ choice: "auto", workoutRunning: Boolean(model.workout), racePhase: race?.phase ?? null, inRace: inRace(race, rider, riderId) });
    if ($("ride").dataset.layout !== layout) $("ride").dataset.layout = layout;
    const route = world.route;
    const standing = me ? raceStanding(race, riders, riderId, route.length) : null;
    const snapshot = hudSnapshot(me);
    const ftp = snapshot.ftp;
    const colors = themeColors();
    rideHud.render(snapshot, { layout, riders, myId: riderId, standing, colors });
    const running = workoutOnTablet(ftp);
    if (running) {
      $("workout-name").textContent = running.name;
      // The target already carries the intensity; the average is over the frames seen here.
      rideHud.renderWorkout({ workout: running.workout, state: running.state, ftp, intensity: 1, avgW: workoutPower?.n ? workoutPower.sum / workoutPower.n : null, paused: false, layout, colors });
    }
    rideHud.renderRace({ race, standing, status: raceStatus(race, rider.lap) });
  }

  /** The riders to draw now, or null until the world, the host and a state of the right kind are there. */
  function sample() {
    if (!view || !latest || !host) return null;
    const timeS = nowS();
    if (world.kind === "studio") {
      if (latest.type !== "studio_state") return null;
      view.setStudioRooms(latest.rooms);
      view.camera.place?.(latest.room, host.seat);
      return { timeS, riders: studioSceneRiders(latest), me: null, onMyRoute: [] };
    }
    if (latest.type !== "state" || !smoother) return null;
    const riders = smoother.sample(timeS);
    const onMyRoute = riders.filter((rider) => onRoute(rider, world.route.id));
    return { timeS, riders, me: onMyRoute.find((rider) => rider.id === riderId) ?? null, onMyRoute };
  }

  const frame = () => {
    requestAnimationFrame(frame);
    if (source) return;
    const now = sample();
    if (!now) return;
    view.render({ riders: now.riders, myId: riderId, myCadence: host.cadence ?? 0, timeS: now.timeS, colors: themeColors() });
    renderRideHud(now.me, now.onMyRoute);
  };

  function onXrFrame(xrFrame) {
    const now = sample();
    if (!now) return;
    // The hologram on the handlebars shows the window's numbers (and the workout, if one runs).
    const snapshot = hudSnapshot(now.me);
    const hud = { values: rideHudValues(snapshot), workout: workoutOnTablet(snapshot.ftp) };
    view.renderXr({ riders: now.riders, myId: riderId, myCadence: host.cadence ?? 0, timeS: now.timeS, colors: themeColors() }, xrFrame, { hud });
  }

  /** Hands the page to an XR frame source (the preview or the headset) in place of the 2D window. */
  function enter(next) {
    if (source || !view) return Promise.resolve(false);
    source = next;
    window.openradlrVr.source = next;
    updatePreviewButton();
    updateEnterButton();
    renderCameraButton();
    return switchToXr(next, {
      stop2d() {
        $("labels3d").hidden = true;
        $("hud").hidden = true;
      },
      start2d: restore2d,
      onFrame: onXrFrame,
    });
  }
  /** Back to the 2D window and its frame loop; safe to call again once it is back. */
  function restore2d() {
    if (!source) return;
    source = null;
    window.openradlrVr.source = null;
    $("labels3d").hidden = false;
    renderHud();
    updatePreviewButton();
    updateEnterButton();
    renderCameraButton();
  }
  function leave() {
    const current = source;
    if (!current) return;
    current.stop();
    restore2d();
  }
  function startPreview() {
    if (source || !view) return;
    autoPreview = false;
    const initial = parseHead(location.search) ?? { yawDeg: 0, pitchDeg: 0, position: [0, 0, 0] };
    enter(new PreviewSource({ canvas: $("world3d"), now: nowS, input: pageInput($("world3d")), initial }));
  }
  async function enterVr() {
    if (source || !view) return;
    const entered = await enter(new WebXrSource({ gl: view.renderer.gl, now: nowS }));
    if (!entered) note(t("vr.enterFailed"));
  }
  function updateEnterButton() {
    $("vr-enter").hidden = !(xrSupported && view) || Boolean(source);
  }
  $("vr-enter").addEventListener("click", enterVr);
  navigator.xr?.isSessionSupported?.("immersive-vr").then(
    (supported) => {
      xrSupported = Boolean(supported);
      updateEnterButton();
    },
    () => {},
  );
  function updatePreviewButton() {
    const previewing = source instanceof PreviewSource;
    const available = xrPreview && Boolean(view) && (previewing || !source);
    $("vr-preview").hidden = !available;
    $("vr-preview").textContent = t(previewing ? "vr.leavePreview" : "vr.preview");
    if (available && autoPreview && host) startPreview();
  }
  $("vr-preview").addEventListener("click", () => (source ? leave() : startPreview()));
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" /* i18n-ok */) leave();
  });
  info().then(
    (data) => {
      xrPreview = Boolean(data.xr_preview);
      updatePreviewButton();
    },
    () => {},
  );

  const renderHud = () => {
    const status = model.status;
    $("vr-waiting").textContent = name ? t("vr.waiting", { name }) : t("vr.waitingTablet");
    $("vr-waiting").hidden = status !== "waiting" || !$("vr-invalid").hidden;
    $("vr-badge").hidden = status !== "stale";
    $("hud").hidden = status === "waiting" || Boolean(source);
    const live = status === "live";
    document.body.toggleAttribute("data-live", live);
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
