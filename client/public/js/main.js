/**
 * Composition root of the browser client: creates the services, wires them
 * to the DOM and runs the render loop. All logic lives in the imported
 * modules, which are unit-tested; this file only connects them.
 */
import { loadAnalytics } from "./analytics.js";
import { DeviceLog } from "./ble/deviceLog.js";
import { HeartRateMonitor, PaddleTrainer, SimulatedTrainer, SmartTrainer, canExportRide, deviceKind, hasRealPowerSource, isBluetoothAvailable } from "./ble/devices.js";
import { KnownDevices, grantedDevices, whenInRange } from "./ble/knownDevices.js";
import { ZwiftController } from "./ble/zwiftController.js";
import { ControllerInput } from "./input/controller.js";
import { activateFocused, moveFocus } from "./input/focusNav.js";
import { bindKeyboard } from "./input/keyboard.js";
import { GameConnection } from "./net/connection.js";
import { Reconnector } from "./net/reconnector.js";
import { RidePause } from "./ride/ridePause.js";
import { defaultServerUrl } from "./net/protocol.js";
import { StravaClient, activityUrl, stravaMessage } from "./net/strava.js";
import { levelAfterRace, levelAfterRide, levelLabel, levelOf } from "./profile/level.js";
import { eventBanner, groupGapLine, eventResultRows, eventRideName, eventRows, renderEventList, sharingLine } from "./view/events.js";
import { ProfileStore, validateProfile } from "./profile/profileStore.js";
import { draftInfo } from "./ride/draft.js";
import { applyDifficulty } from "./ride/difficulty.js";
import { RideSession } from "./ride/rideSession.js";
import { TrainingControl } from "./ride/trainingControl.js";
import { PRESET_WORKOUTS, parseZwo, totalDuration } from "./ride/workout.js";
import { Gearbox, SHIFTING_CW, effectiveGrade, referenceRatio } from "./ride/virtualShifting.js";
import { RiderSmoother } from "./ride/smoothing.js";
import { JUNCTION_WINDOW_M, OFF_ROUTE_ID, junctionAhead, offRouteRoad, stepOption } from "./ride/junction.js";
import { RideAutosave, continueAllowed, indexedDbStore, unfinishedLabel } from "./ride/rideAutosave.js";
import { RideHistory, rideRecord } from "./ride/rideHistory.js";
import { RideRecorder, rideFileName } from "./ride/rideRecorder.js";
import { SPLIT_SETTINGS, computeSplits, resolveSplitMode } from "./ride/splits.js";
import { toLatLon } from "./route/geo.js";
import { RouteGeometry } from "./route/geometry.js";
import { fetchMapNeighbours, fetchMapNetwork, roadNetworkOf } from "./route/worldMap.js";
import { studioBoard } from "./studio/board.js";
import { classWorkout } from "./studio/classClock.js";
import { StudioSession } from "./studio/studioSession.js";
import { displayToKg, distanceUnit, formatDistance, formatDistanceWithUnit, formatDuration, formatElevation, formatGrade, formatLength, formatSpeed, formatWkg, kgToDisplay, setUnits, speedUnit, unitMetres, weightUnit } from "./util/format.js";
import { themeColors } from "./view/canvas.js";
import { drawMinimap } from "./view/minimapView.js";
import {
  LAYOUT_LABELS,
  MetricBinder,
  chooseLayout,
  formatPosition,
  formatTimeGap,
  gaugeFraction,
  nextLayoutChoice,
  nextMarker,
  powerZone,
  raceStanding,
  splitLabel,
  splitLine,
} from "./view/hud.js";
import { appendFeed, describeEvent, inRace, nearbyRiders, onlineSummary, raceStatus, renderResults, renderRiderList, riderName, riderSections } from "./view/panels.js";
import { PhotoAlbum, canShareFiles, canvasToPng, composePhoto, composeSummary, downloadBlob, grabScene, photoFileName, photoStats } from "./view/photos.js";
import { drawPeloton } from "./view/pelotonView.js";
import { renderSplits } from "./view/splitsView.js";
import { drawProfile, drawUpcoming } from "./view/profileView.js";
import { ftpProvenance } from "./view/ftpProvenance.js";
import { ftpPromptText } from "./view/ftpPrompt.js";
import { ftpTestState } from "./view/ftpTestView.js";
import { FtpTestSession } from "./ride/ftpTestSession.js";
import { suggestFtp } from "./ride/ftpEstimate.js";
import { drawRaceTimeline } from "./view/raceTimelineView.js";
import { drawMapPreview } from "./view/mapPreview.js";
import { MenuStage } from "./view/menuStage.js";
import { BUILD } from "./build.js";
import { buildLabel, communityDistance, pickRoute, renderRoutes, routesOf, serverStatus, stageHeadline, stageLede, stageStats, workoutRoute, devicesVisible, privacyUrl } from "./view/startMenu.js";
import { PRESETS } from "./workout/presets.js";
import { planDuration, planSummary } from "./workout/plan.js";
import { WorkoutSession } from "./workout/workoutSession.js";
import { startKeepalive } from "./workout/keepalive.js";
import { createCue } from "./workout/cue.js";
import { gymOfRoute } from "./workout/gymSpots.js";
import { WorkoutStudioView, blockProgress, resyncWorkout, startingViewMode, summaryText, workoutHudText } from "./view/workoutStudioView.js";
import { drawWorkout } from "./view/workoutView.js";
import { HIGHLIGHT, buildHighlight } from "./view3d/highlight.js";
import { MenuCamera } from "./view3d/menuCamera.js";
import { CAMERA_MODES, TIME_MODES, View3D, droneLens, gymLens, isWebGl2Available } from "./view3d/view3d.js";
import { buildScene } from "./view3d/worldScene.js";
import { INSTRUCTOR, STUDIO_CAMERAS, STUDIO_CAMERA_LABELS, StudioView3D } from "./view3d/studioScene.js";
import { ScreenWakeLock } from "./util/wakeLock.js";
import { PaddleView } from "./view/paddleView.js";
import { SeatEnergy, aboardLine, boardingRoute, elsewhereRoute, isCaptain, vehicleErrorLine } from "./ride/vehicle.js";
import { VehicleView } from "./view/vehicleView.js";

const $ = (id) => document.getElementById(id);
const now = () => performance.now() / 1000;
/** How often a ride is written to the browser while it goes on (#73). */
const AUTOSAVE_INTERVAL_MS = 10_000;
// Storage keys keep the old "openride." prefix so saved settings survive the rename.
const VIEW_KEY = "openride.view";
const CAMERA_KEY = "openride.camera";
const TIME_KEY = "openride.time";
const QUALITY_KEY = "openride.quality";
const LAYOUT_KEY = "openride.layout";
const ROUTE_KEY = "openride.route";
const STUDIO_CAMERA_KEY = "openradlr.studio-camera";
const COACH_VOICE_KEY = "openradlr.coach-voice";
const INFO_REFRESH_MS = 5000;
const TICKER_ITEMS = 3;
const TICKER_SECONDS = 9;
const readSetting = (key) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const writeSetting = (key, value) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Settings are a convenience; ignore unavailable storage.
  }
};

const profiles = new ProfileStore();
const deviceLog = new DeviceLog();
const app = {
  profile: profiles.load(),
  redrawStage: null,
  trainer: null,
  heartRateMonitor: null,
  /** Zwift Click / Play / Ride controllers (a Play pair is two). */
  controllers: [],
  /** Handlers of the current ride's actions, shared by keyboard and controllers. */
  actions: null,
  connection: null,
  session: null,
  route: null,
  /** The route file as served (the 3D world is built from it in a worker). */
  routeFile: null,
  /** Every route of my map by id (RouteGeometry), mine included: where other riders ride. */
  routes: new Map(),
  /** The route I joined: names the ride, its files and Strava activity (app.route follows turns). */
  rideRoute: null,
  /** My map's road network (RoadNetwork), for junctions (#15); null without one. */
  network: null,
  /** My road as the server last sent it (`edge`, `dir`, `offset`, `next`). */
  myRoad: null,
  /** My last road on a route, the road before when I turn off every route. */
  lastRoad: null,
  /** Off every route: the road I ride ({key, current, prev, geometry, base}). */
  offRoute: null,
  /** The junction ahead with its options, while it is in reach. */
  junction: null,
  /** Shared vehicles (#55): panels, energy per seat for the summary, code to board on joining. */
  vehicleView: null,
  seatsView: null,
  startVehicleView: null,
  seatEnergy: null,
  vehicleId: null,
  vehicleKind: null,
  vehicleCode: null,
  boardingCode: null,
  pendingBoardCode: null,
  lastVehicleAt: 0,
  lastCaptainHintAt: 0,
  smoother: null,
  state: null,
  riderId: null,
  rideStartedAt: 0,
  rideDistance: 0,
  /** The pause of this ride (#89), and when (the `now()` clock) its timer stopped. Null in the studio. */
  pause: null,
  pausedFrom: null,
  /** Per rider id: when it was first seen parked, for the animation system to come (#89). */
  parkedSince: new Map(),
  /** Per workout rider id: the exercise last seen and since when (the `now()` clock), for its clip (#77). */
  exerciseSince: new Map(),
  /** Splits (#83): the resolved mode and unit of this ride, the live result, how many closed splits were shown. */
  splitMode: "off",
  splitUnitM: 1000,
  splits: [],
  shownSplits: 0,
  splitToastTimer: null,
  /** Studio distance ridden before a rejoin, which restarts the room's odometer (#73). */
  distanceOffset: 0,
  lastMyDistance: null,
  /** Where my rider last was on a route: a rejoin starts there (#73). */
  lastOnRoute: null,
  /** The connection dropped and is being restored; the ride goes on. */
  offline: false,
  /** The autosaved ride "Continue" picks up: `{snapshot, photos}`. */
  restored: null,
  /** The ride autosaved in this browser (#73), and the one the start menu offers. */
  autosave: new RideAutosave({ store: indexedDbStore() }),
  /** Every finished ride, kept locally (#48, #83). */
  history: new RideHistory({ store: indexedDbStore("openradlr-history") }),
  finishSplits: [],
  unfinished: null,
  reconnector: null,
  autosaveTimer: null,
  lastTrainerDataAt: null,
  gearbox: null,
  training: null,
  /** The guided FTP ramp test of this ride (null outside a ride). */
  ftpTest: null,
  workouts: [...PRESET_WORKOUTS],
  view3d: null,
  /** The start menu's map, profile and drone view (null once riding). */
  menu: null,
  /** The menu's 3D view, handed over to the ride when it was built for the joined route. */
  menuView: null,
  viewMode: "2d",
  hud: null,
  layoutChoice: "auto",
  layout: "cockpit",
  standing: null,
  workoutPower: { joules: 0, seconds: 0, lastT: null },
  info: null,
  /** Client time the current `info` arrived, to keep event countdowns running between refreshes. */
  infoAt: 0,
  /** Event to join with the connection that is being opened (from the events list). */
  pendingEventId: null,
  /** The event I entered during this ride: names the ride files. */
  eventRide: null,
  /** Client time my event started (for my race average power). */
  eventStartedAt: null,
  /** Text lines of an event's results, kept in the results list. */
  eventResults: null,
  routeId: readSetting(ROUTE_KEY),
  infoTimer: null,
  strava: new StravaClient(),
  wakeLock: new ScreenWakeLock(),
  /** undefined = not checked yet, null = not connected. */
  stravaAccount: undefined,
  recorder: null,
  /** Humans on the whole server, refreshed from /api/info during the ride. */
  serverPlayers: null,
  album: new PhotoAlbum(),
  /** Callbacks waiting for the next rendered frame of the world. */
  sceneRequests: [],
  /** The world as it looked when the finish dialog opened (summary image background). */
  finishScene: null,
  /** Set once the ride was downloaded or uploaded, so leaving needs no warning. */
  rideSaved: false,
  /** Spin studio ride (null on a route): class clock, targets, ERG. */
  studio: null,
  studioView: null,
  /** The café workout of this ride (null on a road or in the studio, #77). */
  workout: null,
  /** The plan being worked out (without the get-ready block), its HUD view, beep, latest heart rate, and the heart-rate subscription. */
  workoutPlan: null,
  workoutView: null,
  workoutCue: null,
  workoutHeartRate: null,
  workoutUnsubscribe: null,
  workoutKeepalive: null,
  workoutAudio: null,
  coachVoice: readSetting(COACH_VOICE_KEY) === "on",
  /**
   * The ride being joined or ridden ({unbindKeyboard}), null in the menu.
   * Late callbacks of an ended ride see a different object and stop.
   */
  ride: null,
};

/**
 * The ride screen as the page loaded it. Each ride starts from a fresh copy,
 * so back in the menu nothing of the last ride is left: no listeners, no
 * state in the DOM. Devices live outside it and stay connected (#43).
 */
const rideTemplate = $("ride").cloneNode(true);

/** True unless the trainer is known to only report power. */
const canControl = (trainer) => trainer?.canControlResistance !== false;

// ---------------------------------------------------------------- setup ---

/** The learned riding level, shown next to FTP once a ride has moved it. */
function showLevel() {
  const hasLevel = Number.isFinite(app.profile.levelW);
  $("level-label").hidden = !hasLevel;
  if (hasLevel) $("level-label").textContent = levelLabel(levelOf(app.profile), app.profile.weightKg);
}

/**
 * Shows the units setting: unit labels, the toggles and the weight field
 * (which is in lb for imperial riders but stored in kg). Safe to repeat; the
 * ride screen is cloned fresh for every ride and calls it again.
 */
function renderUnits() {
  const labels = { speed: speedUnit(), distance: distanceUnit(), weight: weightUnit() };
  for (const element of document.querySelectorAll("[data-unit]")) element.textContent = labels[element.dataset.unit];
  for (const button of document.querySelectorAll("[data-units]")) {
    button.setAttribute("aria-pressed", String(button.dataset.units === app.profile.units));
  }
  const weight = $("weight");
  weight.min = kgToDisplay(30);
  weight.max = kgToDisplay(200);
  weight.step = app.profile.units === "imperial" ? 1 : 0.5;
  for (const option of $("split-mode").options) {
    if (Number(option.value)) option.textContent = `Every ${option.value} ${distanceUnit()}`;
  }
}

/** Switches between metric and imperial display; data, files and the server stay metric. */
function setUnitSystem(system) {
  if (system === app.profile.units) return;
  // What's typed in the weight field is read in the old units, then shown in the new.
  const typed = Number($("weight").value);
  const kg = typed > 0 ? displayToKg(typed) : app.profile.weightKg;
  setUnits(system);
  app.profile = profiles.save({ ...app.profile, units: system });
  renderUnits();
  $("weight").value = typed > 0 ? kgToDisplay(kg) : kgToDisplay(app.profile.weightKg);
  if (!$("setup").hidden) {
    renderStartMenu();
    app.redrawStage?.();
  }
}

/** Shows the profile's FTP in the setup form together with where it came from. */
function refreshFtpFields() {
  $("ftp").value = app.profile.ftp;
  $("ftp-source").textContent = ftpProvenance(app.profile, { locale: navigator.language });
}

/** Makes `ftp` the rider's FTP everywhere it is read: profile, trainer, workouts, studio and the form. */
function applyFtp(ftp, source, extra = {}) {
  app.profile = profiles.save({ ...app.profile, ...extra, ftp }, { ftpSource: source });
  if (app.training) app.training.ftp = ftp;
  if (app.trainer instanceof PaddleTrainer) app.trainer.setFtp(ftp);
  if (app.studio) app.studio.ftp = ftp;
  refreshFtpFields();
  renderFtpTest();
}

/** After the ride is stored, offers a higher FTP when the history supports one. */
async function offerFtp() {
  const prompt = $("ftp-prompt");
  prompt.hidden = true;
  const records = await app.history.list();
  if (!records.length || records[0].test) return;
  // Rides from before a typed or tested FTP was set must not argue it back up
  const { ftp, ftpDismissed: dismissed, ftpSource, ftpDate } = app.profile;
  const since = (ftpSource === "tested" || ftpSource === "typed") && Number.isFinite(ftpDate) ? ftpDate : 0;
  const suggestion = suggestFtp(records, { ftp, dismissed, since }, Date.now());
  if (!suggestion) return;
  const { title, detail } = ftpPromptText(suggestion);
  $("ftp-prompt-title").textContent = title;
  $("ftp-prompt-detail").textContent = detail;
  $("ftp-prompt-use").onclick = () => {
    applyFtp(suggestion.ftp, "estimated", { ftpDismissed: null });
    prompt.hidden = true;
  };
  $("ftp-prompt-dismiss").onclick = () => {
    app.profile = profiles.save({ ...app.profile, ftpDismissed: suggestion.ftp });
    prompt.hidden = true;
  };
  prompt.hidden = false;
}

function initSetup() {
  setUnits(app.profile.units);
  $("name").value = app.profile.name;
  $("weight").value = kgToDisplay(app.profile.weightKg);
  renderUnits();
  // Delegated: the ride screen (and its Units buttons) is rebuilt for every ride.
  document.addEventListener("click", (event) => {
    const button = event.target.closest?.("[data-units]");
    if (button) setUnitSystem(button.dataset.units);
  });
  refreshFtpFields();
  $("split-mode").value = SPLIT_SETTINGS.includes(app.profile.splitMode) ? app.profile.splitMode : "auto";
  $("auto-pause").checked = Boolean(app.profile.autoPause);
  showLevel();
  setDifficultyInputs(app.profile.difficulty);
  initWorkoutSetup();

  if (!isBluetoothAvailable()) {
    $("bluetooth-warning").hidden = false;
    // Buttons that can't work here only get in the way (an iPhone never gets Bluetooth).
    $("profile-form").classList.add("no-bluetooth");
    $("connect-trainer").disabled = true;
    $("connect-hr").disabled = true;
    $("connect-controller").disabled = true;
  }
  initKnownDevices();

  $("difficulty").addEventListener("input", (e) => setDifficultyInputs(e.target.value / 100));
  $("virtual-shifting").checked = app.profile.virtualShifting;
  $("chainring").value = app.profile.chainring;
  $("cog").value = app.profile.cog;
  $("gear-settings").hidden = !app.profile.virtualShifting;
  $("virtual-shifting").addEventListener("change", (e) => ($("gear-settings").hidden = !e.target.checked));
  $("use-simulated").addEventListener("click", () => {
    useTrainer(new SimulatedTrainer());
    renderReconnectButtons();
  });
  $("use-paddles").addEventListener("click", () => {
    useTrainer(new PaddleTrainer({ ftp: Number($("ftp").value) }));
    renderReconnectButtons();
  });
  for (const kind of Object.keys(DEVICES)) {
    // Connecting takes seconds on some phones; a second tap meanwhile would pair a controller twice.
    const pick = async (button, names) => {
      button.disabled = true;
      await connectDevice(() => DEVICES[kind].connect(names), (device) => connected(kind, device), DEVICES[kind].statusId, { keepLabel: true });
      button.disabled = false;
      if (kind === "controller" && app.controllers.length) renderControllerStatus();
      renderReconnectButtons();
    };
    $(`connect-${kind}`).addEventListener("click", (event) => pick(event.currentTarget));
    // The chooser lists only the remembered devices: one tap and a confirm.
    $(`reconnect-${kind}`).addEventListener("click", (event) => pick(event.currentTarget, missingDevices(kind).map((entry) => entry.name)));
  }
  // The strong controller focus ring only while a controller drives the focus.
  window.addEventListener("pointerdown", () => document.documentElement.classList.remove("controller-nav"));
  initDiagnostics();
  initStartVehicle();
  initStartMenu();
  initRecovery();
  $("profile-form").addEventListener("submit", (event) => {
    event.preventDefault();
    joinRide().catch(joinFailed);
  });
}

/** The preset picker of the Workout card: the saved choice, a summary under it. */
function initWorkoutSetup() {
  const select = $("workout-preset");
  select.replaceChildren(
    ...PRESETS.map((plan) => {
      const option = document.createElement("option");
      option.value = plan.id;
      option.textContent = `${plan.name} · ${Math.round(planDuration(plan) / 60)} min`;
      return option;
    }),
  );
  select.value = PRESETS.some((plan) => plan.id === app.profile.workoutPreset) ? app.profile.workoutPreset : PRESETS[0].id;
  $("workout-cues").checked = app.profile.workoutCues !== false;
  const summarise = () => ($("workout-preset-summary").textContent = planSummary(PRESETS.find((plan) => plan.id === select.value)));
  select.addEventListener("change", summarise);
  summarise();
}

function setDifficultyInputs(difficulty) {
  const percent = Math.round(difficulty * 100);
  for (const [input, output] of [
    ["difficulty", "difficulty-value"],
    ["ride-difficulty", "ride-difficulty-value"],
  ]) {
    $(input).value = percent;
    $(output).textContent = `${percent} %`;
  }
  app.profile.difficulty = difficulty;
}

// ------------------------------------------------------------ start menu ---

function initStartMenu() {
  openStartMenu();
  // Countdowns tick every second between the (slower) info refreshes.
  setInterval(renderEvents, 1000);
  window.addEventListener("resize", () => app.menu && app.drawMenuStage());

  // Coming back from Strava: show what happened, then tidy the address bar.
  const params = new URLSearchParams(location.search);
  const message = stravaMessage(params.get("strava"));
  if (message) {
    $("strava-message").textContent = message;
    $("strava-message").hidden = false;
    history.replaceState(null, "", location.pathname);
  }
  $("strava-logout").addEventListener("click", async () => {
    await app.strava.logout().catch(() => {});
    app.stravaAccount = null;
    renderStartMenu();
  });
}

/** Shows the start menu: its stage and the server's routes and riders, kept fresh. */
function openStartMenu() {
  const refresh = async () => {
    try {
      const response = await fetch("/api/info", { cache: "no-store" });
      app.info = response.ok ? await response.json() : null;
      app.infoAt = Date.now();
      loadAnalytics(app.info, document);
    } catch {
      app.info = null;
    }
    renderStartMenu();
  };
  initMenuStage();
  renderStartMenu();
  refresh();
  clearInterval(app.infoTimer);
  app.infoTimer = setInterval(refresh, INFO_REFRESH_MS);
}

/**
 * The menu's stage: map and profile of the picked route and, where the device
 * can afford it, the 3D island behind the menu. The ride's 3D canvas lives in
 * the menu's background until joining, so the built world carries over.
 */
function initMenuStage() {
  const saveData = Boolean(globalThis.navigator?.connection?.saveData);
  const use3d = isWebGl2Available() && readSetting(QUALITY_KEY) !== "low" && !saveData;
  const reducedMotion = Boolean(globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
  const canvas = $("world3d");
  const home = { parent: canvas.parentElement, next: canvas.nextSibling };
  app.menuCanvasHome = home;
  if (use3d) $("menu-world").append(canvas);
  let shown = { route: null, routes: [] };
  const drawStage = () => {
    const { route, routes } = shown;
    const picked = pickRoute(routesOf(app.info), app.routeId);
    $("stage-name").textContent = picked?.name ?? "";
    $("stage-stats").textContent = stageStats(picked);
    $("menu-profile").hidden = !route;
    drawMapPreview($("menu-map"), { routes, selectedId: route?.id ?? null, network: shown.network ?? null });
    if (route) drawProfile($("menu-profile"), { route, riders: [], myId: null, colors: themeColors() });
  };
  app.redrawStage = drawStage;
  app.menu = new MenuStage({
    fetchRouteFile,
    fetchNetwork: fetchNetworkFile,
    buildScene: use3d ? buildScene : null,
    createView: use3d
      ? (route, scene) => {
          const view = new View3D(canvas, $("labels3d"), route, scene);
          view.lens = droneLens(scene.overview);
          view.setQuality("low");
          view.setTimeMode(TIME_MODES.includes(readSetting(TIME_KEY)) ? readSetting(TIME_KEY) : "day");
          return view;
        }
      : null,
    lensFor: (kind, overview) => (kind === "gym" ? gymLens(overview) : droneLens(overview)),
    createCamera: (overview) => new MenuCamera(overview, { reducedMotion }),
    highlights: (route, others) => [
      ...others.map((other) => ({ mesh: buildHighlight(other, { color: HIGHLIGHT.other, width: 6, beacon: 0 }), glow: 0.35 })),
      { mesh: buildHighlight(route), glow: 1 },
    ],
    onRoute: (stage) => {
      shown = stage;
      drawStage();
    },
    onWorld: (ready) => {
      $("setup").classList.toggle("world-ready", ready);
      // The map changes size (full stage or the corner inset): draw it again.
      drawStage();
    },
    render: (view, dt, timeS) => {
      view.viewOffset = stageOffset($("menu-stage"));
      view.render({ riders: [], myId: null, timeS, colors: themeColors() });
    },
  });
  app.drawMenuStage = drawStage;
}

/** Where the stage sits on screen, as an offset that centres the 3D view on it. */
function stageOffset(stage) {
  const rect = stage.getBoundingClientRect();
  const clamp = (v) => Math.max(-0.85, Math.min(0.85, v));
  return [clamp(((rect.left + rect.width / 2) / window.innerWidth) * 2 - 1), clamp(1 - ((rect.top + rect.height / 2) / window.innerHeight) * 2)];
}

/** Ends the menu; keeps its 3D view for the ride if it shows `routeId`. */
function closeMenuStage(routeId) {
  if (!app.menu) return;
  app.menuView = app.menu.takeView(routeId);
  app.menu = null;
  $("setup").classList.remove("world-ready");
  const canvas = $("world3d");
  const { parent, next } = app.menuCanvasHome;
  if (canvas.parentElement !== parent) parent.insertBefore(canvas, next);
}

async function loadStravaAccount() {
  try {
    app.stravaAccount = await app.strava.me();
  } catch {
    app.stravaAccount = null;
  }
  // A connected Strava account fills an empty name.
  if (app.stravaAccount && !$("name").value.trim()) $("name").value = app.stravaAccount.name;
  renderStartMenu();
}

function renderAccount() {
  const strava = app.info?.strava;
  $("account").hidden = !strava?.enabled;
  if (!strava?.enabled) return;
  if (app.stravaAccount === undefined) {
    app.stravaAccount = null;
    loadStravaAccount();
  }
  const account = app.stravaAccount;
  $("strava-connected").hidden = !account;
  $("strava-disconnected").hidden = Boolean(account);
  if (account) $("strava-name").textContent = account.name;
  $("strava-hint").textContent = strava.required
    ? "This server needs a Strava account to ride (it keeps bots out). Uploading stays your choice after each ride."
    : "Optional: upload rides to Strava when you finish (rides with a real trainer).";
}

function renderStartMenu() {
  renderAccount();
  const status = serverStatus(app.info);
  $("server-label").textContent = app.info?.name ?? "OpenRadlr";
  $("server-players").textContent = status.text;
  const build = buildLabel(app.info, BUILD);
  const privacy = privacyUrl(app.info);
  $("privacy-link").hidden = !privacy;
  if (privacy) $("privacy-link").href = privacy;
  $("build-label").textContent = build.text;
  $("build-label").title = `${build.details} (tap to copy)`;
  $("build-reload").hidden = !build.stale;
  $("server-dot").className = `status-dot${status.online ? (status.full ? " full" : " online") : ""}`;

  // Production servers may hide the simulated trainer (OPENRADLR_ALLOW_SIMULATED_TRAINER=false).
  $("use-simulated").hidden = app.info?.simulated_trainer === false;

  const routes = routesOf(app.info);
  const selected = pickRoute(routes, app.routeId);
  $("routes-empty").hidden = routes.length > 0;
  const community = communityDistance(app.info);
  $("community-distance").hidden = !community;
  $("community-distance").textContent = community ?? "";
  renderRoutes($("route-list"), routes, selected?.id ?? null, (id) => {
    app.routeId = id;
    writeSetting(ROUTE_KEY, id);
    renderStartMenu();
  });
  app.menu?.select(routes, selected?.id ?? null);
  renderEvents();
  renderUnfinished();
  // Paddles ride the road: the studio's classes need a trainer (or the sim).
  $("use-paddles").hidden = app.info?.paddle_mode === false || selected?.kind === "studio";
  // The workout needs no trainer: its preset picker replaces the devices, bar the heart-rate row.
  const workout = selected?.kind === "workout";
  $("profile-form").classList.toggle("workout", workout);
  $("workout-setup").hidden = !workout;
  $("routes-title").textContent = stageHeadline(selected);
  $("routes-lede").textContent = stageLede(selected);
  $("devices").hidden = !devicesVisible(selected, isBluetoothAvailable());
  // Vehicles are on the roads: no boarding from the workout card.
  $("board-start").hidden = workout;
  if (workout) $("start-vehicle").hidden = true;
  const join = $("join");
  const needsStrava = Boolean(app.info?.strava?.required) && !app.stravaAccount;
  if (!join.dataset.busy) {
    // A rider on a phone takes a phone seat, so the trainer seats being gone doesn't stop them.
    const full = deviceKind(app.trainer) === "paddle" ? status.phoneFull : status.full;
    join.disabled = full || needsStrava;
    join.textContent = full ? "Server is full" : needsStrava ? "Connect Strava to ride" : workout ? "Start workout" : selected ? `Ride ${selected.name}` : "Ride";
  }
}

/** The scheduled events from the last /api/info, in the start menu and the ride menu. */
function renderEvents() {
  const info = app.info;
  const rows = info?.events?.length && Number.isFinite(info.now_s) ? eventRows({ ...info, now_s: info.now_s + (Date.now() - app.infoAt) / 1000 }, Date.now(), {}, enteredEventId()) : [];
  const riding = Boolean(app.ride) && !$("ride").hidden;
  $("events").hidden = rows.length === 0 || riding;
  if (!$("events").hidden) renderEventList($("event-list"), rows, joinEventFromMenu);
  $("events-panel").hidden = rows.length === 0 || !riding;
  if (!$("events-panel").hidden) renderEventList($("ride-event-list"), rows, joinEventFromRide, leaveEventFromRide);
}

/** True while a scheduled event holds my route (lobby or running). */
const eventBlocksRace = (event) => Boolean(event && (event.phase === "lobby" || event.phase === "running"));

/** The scheduled event I'm entered in, or null. */
const enteredEventId = () => (app.state?.event?.entered ? app.state.event.id : null);

function leaveEventFromRide() {
  app.connection?.leaveEvent();
}

/** Start menu: ride the event's route, then enter the event once connected. */
function joinEventFromMenu(row) {
  if ($("join").dataset.busy) return;
  app.routeId = row.routeId;
  writeSetting(ROUTE_KEY, row.routeId);
  app.pendingEventId = row.id;
  renderStartMenu();
  joinRide().catch(joinFailed);
}

/** Ride menu: on my route just enter; on another one, restart there. */
function joinEventFromRide(row) {
  if (!app.connection) return;
  if (row.routeId === app.route?.id) {
    app.connection.joinEvent(row.id);
    return;
  }
  if (leaveRide()) joinEventFromMenu(row);
}

/** @returns {Promise<boolean>} true once connected */
async function connectDevice(connect, onConnected, statusId, { keepLabel = false, pending = "Connecting…" } = {}) {
  const status = $(statusId);
  status.textContent = pending;
  status.classList.remove("ok");
  try {
    const device = await connect();
    onConnected(device);
    // useTrainer() writes its own label (it knows about power-only trainers).
    if (!keepLabel) status.textContent = device.label;
    status.classList.add("ok");
    return true;
  } catch (error) {
    // Given up quietly: the rider connected another device meanwhile.
    if (error.name === "AbortError") return false;
    status.textContent = error.name === "NotFoundError" ? "Cancelled" : `Failed: ${error.message}`;
    if (error.name !== "NotFoundError") deviceLog.error(`Connecting failed: ${error.message}`);
    return false;
  }
}

// -------------------------------------------------------- known devices ---

const knownDevices = new KnownDevices();
const hasController = (id) => app.controllers.some((c) => c.id === id);

/** Each kind of device: through the chooser (`names`: only these) or, already granted, without it. */
const DEVICES = {
  trainer: {
    statusId: "trainer-status",
    connect: (names) => SmartTrainer.connect(undefined, { log: deviceLog, names }),
    open: (device) => SmartTrainer.open(device, { log: deviceLog }),
    use: (trainer) => useTrainer(trainer),
    has: () => Boolean(app.trainer),
  },
  hr: {
    statusId: "hr-status",
    connect: (names) => HeartRateMonitor.connect(undefined, { log: deviceLog, names }),
    open: (device) => HeartRateMonitor.open(device, { log: deviceLog }),
    use: (monitor) => useHeartRateMonitor(monitor),
    has: () => Boolean(app.heartRateMonitor),
  },
  controller: {
    statusId: "controller-status",
    connect: (names) => ZwiftController.connect(undefined, { log: deviceLog, names, isConnected: (device) => hasController(device.id) }),
    open: (device) => ZwiftController.open(device, { log: deviceLog }),
    use: (controller) => useController(controller),
    // Any trainer or strap will do; controllers count one by one (a Play is two).
    has: (id) => hasController(id),
  },
};

/** Remembered devices of `kind` that aren't connected now. */
function missingDevices(kind) {
  const entries = knownDevices.of(kind);
  return kind === "controller" ? entries.filter((entry) => !hasController(entry.id)) : DEVICES[kind].has() ? [] : entries;
}

/** A device was picked or found again: remember it for the next start. */
function connected(kind, device) {
  knownDevices.remember(kind, device);
  DEVICES[kind].use(device);
  renderReconnectButtons();
}

/** "Reconnect KICKR CORE" next to each kind with a remembered device that isn't connected. */
function renderReconnectButtons() {
  for (const kind of Object.keys(DEVICES)) {
    const button = $(`reconnect-${kind}`);
    const names = [...new Set(missingDevices(kind).map((entry) => entry.name))];
    button.hidden = !isBluetoothAvailable() || names.length === 0;
    button.textContent = `Reconnect ${names.join(" + ")}`;
  }
}

/**
 * On start: remembered devices that this site may use without the chooser
 * connect on their own, once they are switched on (#43). Browsers without
 * `getDevices()` get the Reconnect buttons only.
 */
async function initKnownDevices() {
  renderReconnectButtons();
  const known = knownDevices.list();
  if (!isBluetoothAvailable() || !known.length) return;
  const found = await grantedDevices(known);
  const support = typeof navigator.bluetooth.getDevices === "function" ? `getDevices() found ${found.length}` : "no getDevices() in this browser";
  deviceLog.info(`Remembered devices: ${known.map((e) => e.name).join(", ")} (${support})`);
  for (const { entry, device } of found) autoConnect(entry, device);
}

async function autoConnect(entry, device) {
  const spec = DEVICES[entry.kind];
  const taken = () => (entry.kind === "controller" ? spec.has(entry.id) : spec.has());
  if (taken()) return;
  const ok = await connectDevice(
    async () => {
      await whenInRange(device);
      const opened = await spec.open(device);
      // Picked by hand meanwhile: that one stays.
      if (taken()) {
        opened.disconnect();
        throw Object.assign(new Error("already connected"), { name: "AbortError" });
      }
      return opened;
    },
    (opened) => connected(entry.kind, opened),
    spec.statusId,
    { keepLabel: true, pending: entry.kind === "controller" ? `Press a button on ${entry.name}…` : `Looking for ${entry.name}…` },
  );
  // Two controllers share one status line: show the ones that made it.
  if (!ok && entry.kind === "controller" && app.controllers.length) renderControllerStatus();
}

function trainerLabel(trainer) {
  return canControl(trainer) ? trainer.label : `${trainer.label} · power only`;
}

function useTrainer(trainer) {
  app.trainer?.disconnect();
  app.trainer = trainer;
  app.lastTrainerDataAt = null;
  $("trainer-status").classList.add("ok");

  // Power-only trainers: no ERG, no virtual shifting.
  const controllable = canControl(trainer);
  const paddles = trainer instanceof PaddleTrainer;
  $("power-only-note").hidden = controllable || paddles;
  $("paddle-note").hidden = !paddles;
  $("trainer-status").textContent = trainerLabel(trainer);
  $("virtual-shifting").disabled = !controllable;
  if (!controllable) {
    $("virtual-shifting").checked = false;
    $("gear-settings").hidden = true;
  }

  // Live check on the setup screen: the rider sees right away whether data arrives.
  $("live-reading").hidden = false;
  trainer.on("data", ({ power, cadence }) => {
    app.lastTrainerDataAt = now();
    const watts = Number.isFinite(power) ? Math.round(power) : "–";
    const rpm = Number.isFinite(cadence) ? Math.round(cadence) : "–";
    $("live-values").textContent = `${watts} W · ${rpm} rpm`;
  });
  trainer.on("disconnected", () => {
    $("trainer-status").textContent = "Reconnecting…";
    $("trainer-status").classList.remove("ok");
    notify(`${trainer.label} disconnected. Reconnecting…`, "error");
  });
  trainer.on("reconnected", () => {
    $("trainer-status").textContent = trainerLabel(trainer);
    $("trainer-status").classList.add("ok");
    notify(`${trainer.label} is back.`);
  });
}

function useHeartRateMonitor(monitor) {
  app.heartRateMonitor?.disconnect();
  app.heartRateMonitor = monitor;
  const status = $("hr-status");
  status.textContent = monitor.label;
  status.classList.add("ok");
  monitor.on("disconnected", () => {
    status.textContent = "Reconnecting…";
    status.classList.remove("ok");
    notify(`${monitor.label} disconnected. Reconnecting…`, "error");
  });
  monitor.on("reconnected", () => {
    status.textContent = monitor.label;
    status.classList.add("ok");
    notify(`${monitor.label} is back.`);
  });
}

function useController(controller) {
  app.controllers.push(controller);
  const input = new ControllerInput();
  $("controller-live").hidden = false;
  controller.on("buttons", (pressed) => {
    if (pressed.length) $("controller-buttons").textContent = `${controller.label}: ${pressed.join(" + ")}`;
    for (const action of input.update(pressed, navigationRoot() !== null)) runAction(action);
  });
  controller.on("battery", renderControllerStatus);
  controller.on("disconnected", () => {
    renderControllerStatus();
    notify(`${controller.label} disconnected. Press a button to wake it; reconnecting…`, "error");
  });
  controller.on("reconnected", () => {
    renderControllerStatus();
    notify(`${controller.label} is back.`);
  });
  renderControllerStatus();
}

function renderControllerStatus() {
  const status = $("controller-status");
  status.textContent = app.controllers
    .map((c) => (c.connected ? `${c.label}${c.battery !== null ? ` · ${c.battery} %` : ""}` : `${c.label} · reconnecting…`))
    .join(", ");
  status.classList.toggle("ok", app.controllers.every((c) => c.connected));
}

/** Whatever the rider navigates with a controller right now; null while riding. */
function navigationRoot() {
  if (!$("finish").hidden) return $("finish");
  for (const id of ["menu", "social"]) if (!$(id).hidden) return $(id);
  if (!$("setup").hidden) return $("setup");
  return null;
}

/** Runs an action from a controller: menu navigation here, the rest like the keyboard. */
function runAction(action) {
  const root = navigationRoot();
  if (action === "focusNext" || action === "focusPrev") {
    document.documentElement.classList.add("controller-nav");
    if (root) moveFocus(root, action === "focusNext" ? +1 : -1);
  } else if (action === "select") {
    if (root) activateFocused(root);
  } else {
    app.actions?.[action]?.();
  }
}

/** A message for the rider: kept in the feed drawer and shown briefly on the HUD. */
function notify(text, kind = "event") {
  appendFeed($("feed"), text, kind);
  if (!$("hud-ticker")) return;
  const ticker = $("hud-ticker");
  const item = document.createElement("li");
  item.className = `feed-${kind}`;
  item.textContent = text;
  ticker.append(item);
  while (ticker.children.length > TICKER_ITEMS) ticker.firstElementChild.remove();
  setTimeout(() => item.remove(), TICKER_SECONDS * 1000);
}

// ---------------------------------------------------------- diagnostics ---

function initDiagnostics() {
  $("build-label").addEventListener("click", () => {
    const details = buildLabel(app.info, BUILD).details;
    navigator.clipboard?.writeText(details).then(
      () => notify(`Copied: ${details}`),
      () => notify(details),
    );
  });
  $("build-reload").addEventListener("click", () => location.reload());
  let scheduled = false;
  const render = () => {
    scheduled = false;
    $("diagnostics-log").textContent = deviceLog.report({
      userAgent: navigator.userAgent,
      build: buildLabel(app.info, BUILD).details,
    });
    const total = Object.values(deviceLog.packets).reduce((sum, n) => sum + n, 0);
    $("trainer-packets").textContent = total ? `${total} packets` : "";
  };
  const schedule = () => {
    if (!scheduled) {
      scheduled = true;
      setTimeout(render, 250);
    }
  };
  deviceLog.on("entry", (entry) => {
    console.debug("[device]", entry.message);
    schedule();
  });
  deviceLog.on("packet", schedule);

  const copy = async (button) => {
    const text = deviceLog.report({ userAgent: navigator.userAgent });
    try {
      await navigator.clipboard.writeText(text);
      button.textContent = "Copied";
    } catch {
      $("diagnostics").open = true;
      button.textContent = "Select the text above to copy";
    }
    setTimeout(() => (button.textContent = button.dataset.label), 2000);
  };
  // Delegated: the ride's button is replaced with every new ride.
  document.addEventListener("click", (event) => {
    const button = event.target.closest?.("#copy-diagnostics, #ride-copy-diagnostics");
    if (!button) return;
    button.dataset.label ??= button.textContent;
    copy(button);
  });
}

function showSetupError(message) {
  app.pendingEventId = null;
  app.menu?.resume();
  $("setup-error").textContent = message;
  delete $("join").dataset.busy;
  renderStartMenu();
}

/** @param {{snapshot: object, photos: object[]} | null} [restored] an autosaved ride to continue (#73) */
async function joinRide(restored = null) {
  // Codes count for this join attempt only, also when it fails early.
  const vehicleCode = app.vehicleCode;
  const boardCode = app.pendingBoardCode;
  app.vehicleCode = null;
  app.pendingBoardCode = null;
  $("setup-error").textContent = "";
  const profile = {
    ...app.profile,
    name: $("name").value.trim(),
    weightKg: displayToKg(Number($("weight").value)),
    ftp: Number($("ftp").value),
    splitMode: $("split-mode").value,
    autoPause: $("auto-pause").checked,
    difficulty: Number($("difficulty").value) / 100,
    virtualShifting: $("virtual-shifting").checked,
    chainring: Number($("chainring").value),
    cog: Number($("cog").value),
  };
  const errors = validateProfile(profile);
  if (pickRoute(routesOf(app.info), app.routeId)?.kind === "workout") return joinWorkout(profile, errors);
  if (!app.trainer) errors.push("Connect a trainer or use the simulated trainer.");
  if (app.trainer instanceof SimulatedTrainer && app.info?.simulated_trainer === false) {
    errors.push("This server only accepts real trainers.");
  }
  if (app.trainer instanceof PaddleTrainer) {
    if (app.info?.paddle_mode === false) errors.push("This server doesn't allow phone paddles.");
    if (pickRoute(routesOf(app.info), app.routeId)?.kind === "studio") errors.push("Phone paddles ride the routes: pick a road, or use the simulated trainer for the studio.");
  }
  if (errors.length) return showSetupError(errors.join("\n"));
  // A new ride replaces the autosaved one (#73).
  if (!restored && app.unfinished) {
    if (!confirm("Start a new ride? Your unfinished ride is discarded: save it first.")) return;
    await discardUnfinished();
  }
  app.restored = restored;

  const route = pickRoute(routesOf(app.info), app.routeId);
  // Callbacks of this join check it is still the current ride.
  const ride = { unbindKeyboard: null };
  app.ride = ride;
  app.menu?.pause();
  $("join").disabled = true;
  $("join").dataset.busy = "1";
  $("join").textContent = "Joining…";
  const saved = profiles.save(profile);
  app.profile = await profiles.ensureKeys(saved).catch(() => saved);

  const controllable = canControl(app.trainer);
  if (route?.kind === "studio") {
    const response = await fetch("/api/studio");
    if (!response.ok) throw new Error(`Could not load the studio (HTTP ${response.status}).`);
    app.studio = new StudioSession({ catalog: await response.json(), ftp: app.profile.ftp, canControl: controllable });
    // Names the ride (photos, files, Strava); the class name is added once it starts.
    app.route = { id: route.id, name: route.name };
    app.rideRoute = app.route;
  } else {
    app.routeFile = await fetchRouteFile(route?.id);
    app.route = new RouteGeometry(app.routeFile);
    // The map's routes: its riders all ride one world (#14), each on their own route.
    app.rideRoute = app.route;
    app.routes = new Map([[app.route.id, app.route]]);
    fetchMapNeighbours(app.routeFile, routesOf(app.info), fetchRouteFile)
      .then((files) => app.ride === ride && files.forEach((file) => app.routes.set(file.id, new RouteGeometry(file))))
      .catch(() => {});
    // The network's junctions are where riders can turn (#15).
    fetchMapNetwork(app.routeFile, fetchNetworkFile)
      .then((file) => {
        if (app.ride !== ride) return;
        app.network = file ? roadNetworkOf(file) : null;
        if (app.view3d) app.view3d.network = app.network;
      })
      .catch(() => {});
    app.smoother = new RiderSmoother(app.route, { routeOf: (rider) => app.routes.get(rider.route) });
  }

  const connection = new GameConnection({ url: defaultServerUrl() });
  wireConnection(connection);
  app.connection = connection;
  if (app.trainer instanceof PaddleTrainer) app.trainer.setFtp(app.profile.ftp);
  app.riderId = await connection.join({
    ...app.profile,
    vehicleCode,
    routeId: route?.id,
    level: levelOf(app.profile),
    device: deviceKind(app.trainer),
    // Continuing an autosaved ride: the same rider if the server still holds them, else where it stopped.
    resumeToken: restored?.snapshot.resumeToken,
    resume: restored && route?.kind !== "studio" ? restored.snapshot.resumePoint : null,
  });
  closeMenuStage(route?.kind === "studio" ? null : route?.id);
  if (app.pendingEventId) {
    connection.joinEvent(app.pendingEventId);
    app.pendingEventId = null;
  }
  if (boardCode) {
    app.boardingCode = boardCode;
    connection.boardVehicle(boardCode);
  }

  app.gearbox = app.profile.virtualShifting && controllable ? new Gearbox() : null;
  app.training = new TrainingControl({ ftp: app.profile.ftp, canControl: controllable });
  // Per ride, so its test flag lives and dies with the ride record
  app.ftpTest = new FtpTestSession({ training: app.training, getSamples: () => app.recorder?.samples ?? [] });
  app.session = new RideSession({
    connection,
    trainer: app.trainer,
    heartRateMonitor: app.heartRateMonitor,
    flat: Boolean(app.studio),
    resistanceModel: (roadGrade) => {
      // The road (flat in the studio: no grades arrive), with virtual gears if on.
      const road = () => {
        if (!app.gearbox) return applyDifficulty(roadGrade, app.profile.difficulty);
        const me = app.state ? myRider(app.state.riders) : null;
        const draft = me && !app.studio ? draftInfo(me, app.state.riders, app.route) : null;
        const grade = effectiveGrade({
          gradePercent: applyDifficulty(roadGrade, app.profile.difficulty, { descents: 1 }),
          ratio: app.gearbox.ratio,
          referenceRatio: referenceRatio(app.profile.chainring, app.profile.cog),
          speed: me?.speed ?? 0,
          dragFactor: 1 - (draft?.savingPercent ?? 0) / 100,
          massKg: app.profile.weightKg + 9,
        });
        return { grade, cw: SHIFTING_CW };
      };
      return app.studio ? app.studio.command(road, now()) : app.training.command(road);
    },
    onError: (error) => notify(`Trainer: ${error.message}`, "error"),
  });
  app.session.start();
  startRide();
}

/** The café workout (#77): joins the default route's world without a trainer and runs the plan. */
async function joinWorkout(profile, errors) {
  const routeId = workoutRoute(app.info);
  if (!routeId) errors.push("This server has no route to work out on.");
  if (errors.length) return showSetupError(errors.join("\n"));
  const plan = PRESETS.find((preset) => preset.id === $("workout-preset").value) ?? PRESETS[0];
  // No "discard your unfinished ride?" prompt: a workout never touches the autosave
  // (no recorder, so saveRide() does nothing), the unfinished ride is still offered afterwards.
  app.restored = null;
  const ride = { unbindKeyboard: null };
  app.ride = ride;
  app.menu?.pause();
  $("join").disabled = true;
  $("join").dataset.busy = "1";
  $("join").textContent = "Joining…";
  const saved = profiles.save({ ...profile, workoutPreset: plan.id, workoutCues: $("workout-cues").checked });
  app.profile = await profiles.ensureKeys(saved).catch(() => saved);

  app.routeFile = await fetchRouteFile(routeId);
  app.route = new RouteGeometry(app.routeFile);
  app.rideRoute = app.route;
  app.routes = new Map([[app.route.id, app.route]]);
  app.smoother = new RiderSmoother(app.route, { routeOf: (rider) => app.routes.get(rider.route) });

  const connection = new GameConnection({ url: defaultServerUrl() });
  wireConnection(connection);
  app.connection = connection;
  app.riderId = await connection.join({ ...app.profile, routeId, level: levelOf(app.profile), device: "workout" });
  closeMenuStage(routeId);
  app.workoutPlan = plan;
  app.workout = new WorkoutSession({ plan, now, wallNow: () => Date.now() });
  startRide();
}

function joinFailed(error) {
  endRide();
  showSetupError(vehicleErrorLine(error.code) ?? error.message);
}

/** A long hard ride nudges the riding level up (studio rides count too). */
function learnLevel() {
  const samples = app.recorder?.samples;
  if (!samples?.length) return;
  const level = levelAfterRide(levelOf(app.profile), samples);
  if (level === levelOf(app.profile)) return;
  app.profile = profiles.save({ ...app.profile, levelW: level });
  showLevel();
}

/**
 * Ends the ride (or a join that failed) and shows the menu again, without
 * reloading the page: a reload would drop every Bluetooth device (#43).
 * Trainer, heart rate monitor and controllers stay connected.
 */
function endRide() {
  const ride = app.ride;
  if (!ride) return;
  app.ride = null;
  learnLevel();
  saveWorkoutRecord();
  app.workoutUnsubscribe?.();
  app.workoutKeepalive?.();
  app.workoutKeepalive = null;
  app.workoutAudio?.close?.().catch?.(() => {});
  app.workoutAudio = null;
  app.workoutView?.dispose();
  document.body.classList.remove("working-out");
  $("workout-note").hidden = true;
  ride.unbindKeyboard?.();
  app.actions = null;
  app.session?.stop();
  app.reconnector?.stop();
  clearInterval(app.autosaveTimer);
  // Leaving on purpose: the server frees the rider at once instead of holding them (#73).
  app.connection?.leave();
  app.wakeLock.release();
  app.paddleView?.dispose();
  document.body.classList.remove("paddling");
  // Leave the trainer on a flat road, not holding the last ERG target.
  if (app.session && canControl(app.trainer)) Promise.resolve(app.trainer.setGrade(0)).catch(() => {});
  app.view3d?.dispose();
  app.studioView?.dispose();
  app.menuView?.dispose();
  if ("speechSynthesis" in globalThis) speechSynthesis.cancel();
  app.album.clear();
  Object.assign(app, {
    connection: null,
    session: null,
    route: null,
    routeFile: null,
    routes: new Map(),
    rideRoute: null,
    network: null,
    myRoad: null,
    lastRoad: null,
    offRoute: null,
    junction: null,
    vehicleId: null,
    vehicleKind: null,
    seatEnergy: null,
    boardingCode: null,
    pendingBoardCode: null,
    smoother: null,
    state: null,
    riderId: null,
    rideStartedAt: 0,
    pause: null,
    pausedFrom: null,
    parkedSince: new Map(),
    exerciseSince: new Map(),
    rideDistance: 0,
    splits: [],
    shownSplits: 0,
    splitToastTimer: (clearTimeout(app.splitToastTimer), ($("split-toast").hidden = true), null),
    distanceOffset: 0,
    lastMyDistance: null,
    lastOnRoute: null,
    offline: false,
    restored: null,
    gearbox: null,
    training: null,
    ftpTest: null,
    view3d: null,
    menuView: null,
    viewMode: "2d",
    hud: null,
    standing: null,
    workoutPower: { joules: 0, seconds: 0, lastT: null },
    recorder: null,
    serverPlayers: null,
    sceneRequests: [],
    finishScene: null,
    rideSaved: false,
    studio: null,
    studioView: null,
    workout: null,
    workoutPlan: null,
    workoutView: null,
    workoutCue: null,
    workoutHeartRate: null,
    workoutUnsubscribe: null,
    workoutKeepalive: null,
    workoutAudio: null,
    eventRide: null,
    eventStartedAt: null,
    eventResults: null,
    paddleView: null,
    reconnector: null,
    autosaveTimer: null,
  });

  // A fresh ride screen; the 3D canvases move over, keeping their WebGL contexts.
  const fresh = rideTemplate.cloneNode(true);
  for (const id of ["world3d", "labels3d", "studio3d", "studio-labels"]) fresh.querySelector(`#${id}`).replaceWith($(id));
  $("ride").replaceWith(fresh);
  document.body.classList.remove("riding");
  $("setup").hidden = false;
  delete $("join").dataset.busy;
  // A join that failed never left the menu: it is only paused.
  if (app.menu) {
    app.menu.resume();
    renderStartMenu();
  } else {
    openStartMenu();
  }
  refreshUnfinished();
}

// ----------------------------------------------------------------- ride ---

function wireConnection(connection) {
  // An ended ride's connection closes on its own; it no longer drives the screen.
  const on = (type, handler) => connection.on(type, (message) => connection === app.connection && handler(message));
  on("state", (message) => {
    // My rider decides which road I'm on: my route, another one I turned onto, or off every route.
    const mine = message.riders.find((rider) => rider.id === app.riderId);
    if (mine?.route) app.lastOnRoute = { routeId: mine.route, distanceM: mine.distance };
    const me = mine && followMyRoad(mine);
    const riders = message.riders.map((rider) => stampExercise(stampParked(rider === mine ? me : onMyOwnRoad(rider))));
    for (const id of app.parkedSince.keys()) if (!message.riders.some((rider) => rider.id === id && rider.parked)) app.parkedSince.delete(id);
    for (const id of app.exerciseSince.keys()) if (!message.riders.some((rider) => rider.id === id)) app.exerciseSince.delete(id);
    // Riders of the map's other routes only show in 3D; panels and 2D views follow my route.
    app.smoother.update(riders, now());
    // Humans on other routes still go in the Riders drawer, under their route's name.
    const elsewhere = riders.filter((rider) => !rider.is_bot && !onMyRoute(rider));
    app.state = { ...message, riders: riders.filter(onMyRoute), elsewhere };
    // The workout screen has none of the ride panels.
    if (!app.workout) updatePanels();
  });
  on("studio_state", (message) => {
    app.state = message;
    app.studio?.update(message, now());
    updateStudioPanels();
  });
  on("event", ({ event }) => {
    if (event.kind === "event_started") app.eventStartedAt = Date.now();
    if (event.kind === "event_finished") eventFinished(event);
    const text = describeEvent(event, app.riderId, app.state?.vehicle?.id ?? null);
    if (text) notify(text);
  });
  on("chat", ({ name, text }) => notify(`${name}: ${text}`, "chat"));
  on("error", ({ code, message }) => {
    // The server won't pause here (a race, an event or a vehicle): ride on (#89).
    if (code === "pause_rejected") {
      performPause(app.pause?.rejected() ?? [], now());
      notify("You can't pause in a race, event or vehicle.", "error");
      return;
    }
    // The workout sends no riding messages; a stray refusal is nothing to show (the HUD is not the ride's).
    if (app.workout && (code === "in_workout" || code === "not_in_workout")) return console.warn("workout:", code, message);
    // A refused turn: the server's plan stands, the next state shows it.
    if (code === "turn_rejected") app.myRoad = app.myRoad && { ...app.myRoad, next: null };
    if (code === "vehicle_elsewhere" && boardElsewhere(elsewhereRoute(message))) return;
    notify(vehicleErrorLine(code) ?? message, "error");
  });
  // The ride goes on: try to get back onto the server (#73).
  on("close", () => connectionLost(connection));
}

/** Notes when a rider was first seen parked and hands it to the view as `parkedSince` (null when not parked). */
function stampParked(rider) {
  if (!rider.parked) return { ...rider, parkedSince: null };
  if (!app.parkedSince.has(rider.id)) app.parkedSince.set(rider.id, now());
  return { ...rider, parkedSince: app.parkedSince.get(rider.id) };
}

/** Notes when a rider's `exercise` last changed and hands it to the view as `exerciseSince`: the clip starts there. */
function stampExercise(rider) {
  const exercise = rider.exercise ?? null;
  const seen = app.exerciseSince.get(rider.id);
  if (!seen || seen.exercise !== exercise) app.exerciseSince.set(rider.id, { exercise, since: now() });
  return { ...rider, exerciseSince: app.exerciseSince.get(rider.id).since };
}

function startRide() {
  const info = app.connection.serverInfo;
  $("server-label").textContent = app.studio ? `${info.server_name} · ${app.route.name}` : `${info.server_name} · ${app.route.name} · ${formatDistanceWithUnit(app.route.length, 1)}`;
  setDifficultyInputs(app.profile.difficulty);
  $("setup").hidden = true;
  $("ride").hidden = false;
  clearInterval(app.infoTimer);
  app.infoTimer = setInterval(refreshServerPlayers, INFO_REFRESH_MS * 2);
  refreshServerPlayers();
  $("power-only").hidden = canControl(app.trainer) || app.trainer instanceof PaddleTrainer;
  document.body.classList.add("riding");
  $("hud-route").textContent = app.route.name;
  app.rideStartedAt = now();
  app.pause = app.studio || app.workout ? null : new RidePause({ autoPause: Boolean(app.profile.autoPause) });
  app.parkedSince = new Map();
  app.exerciseSince = new Map();

  if (app.workout) return startWorkout();

  const simulated = app.trainer instanceof SimulatedTrainer;
  $("sim-panel").hidden = !simulated;
  $("sim-stepper").hidden = !simulated;
  $("power-hint").hidden = !simulated;
  const setSimPower = (watts) => {
    app.trainer.setPower(watts);
    $("sim-power").value = app.trainer.power;
    $("sim-power-value").textContent = `${app.trainer.power} W`;
    $("sim-stepper-value").textContent = `${app.trainer.power} W`;
  };
  if (simulated) setSimPower(app.trainer.power);
  $("sim-power").addEventListener("input", (e) => setSimPower(Number(e.target.value)));
  // The HUD stepper goes through the actions: ERG and workouts take ↑/↓ over.
  $("sim-up").addEventListener("click", () => app.actions?.powerUp());
  $("sim-down").addEventListener("click", () => app.actions?.powerDown());
  app.wakeLock.acquire();

  $("ride-difficulty").addEventListener("input", (e) => {
    setDifficultyInputs(Number(e.target.value) / 100);
    profiles.save(app.profile);
    app.session.refreshResistance();
  });
  $("chat-form").addEventListener("submit", (event) => {
    event.preventDefault();
    app.connection.chat($("chat-input").value);
    $("chat-input").value = "";
  });
  // After the reconnector gave up: end the ride with its file, or try again.
  $("finish-and-save").addEventListener("click", () => openFinish());
  $("keep-trying").addEventListener("click", () => connectionLost(app.connection));

  initShifting();
  initHudCommon();
  if (app.studio) startStudio({ simulated, setSimPower });
  else startRoad({ simulated, setSimPower });

  app.recorder = new RideRecorder();
  if (app.restored) restoreRide(app.restored);
  startSplits();
  initFinish();
  initPhotos();
  startAutosave();
  notify(`Welcome to ${info.server_name}! Riders marked "bot" are computer-controlled.`);
  // One loop per ride: it ends with the ride.
  const ride = app.ride;
  const draw = app.studio ? studioFrame : frame;
  const loop = () => {
    if (app.ride !== ride) return;
    requestAnimationFrame(loop);
    draw();
  };
  requestAnimationFrame(loop);
}

function startRoad({ simulated, setSimPower }) {
  $("start-race").addEventListener("click", () => app.connection.startRace(Number($("race-laps").value)));
  $("leave-race").addEventListener("click", () => app.connection.leaveRace());
  $("race-call-button").addEventListener("click", () => toggleRace());
  $("event-call-button").addEventListener("click", () => toggleRace());
  initViews();
  initTraining({ simulated, setSimPower });
  initHud();
  initVehicle();

  app.actions = {
    // Before a junction the lane keys pick the road instead (#15); on a vehicle only the captain steers.
    laneLeft: () => (notCaptain() ? captainSteersHint() : app.junction ? chooseTurn(stepOption(app.junction, -1)) : app.connection.laneLeft()),
    laneRight: () => (notCaptain() ? captainSteersHint() : app.junction ? chooseTurn(stepOption(app.junction, +1)) : app.connection.laneRight()),
    // ERG target or workout intensity; otherwise the simulated trainer's power.
    powerUp: () => (app.training.mode === "erg" || app.training.guided ? adjustErg(+1) : simulated && setSimPower(app.trainer.power + 10)),
    powerDown: () => (app.training.mode === "erg" || app.training.guided ? adjustErg(-1) : simulated && setSimPower(app.trainer.power - 10)),
    shiftUp: () => shift(+1),
    shiftDown: () => shift(-1),
    toggleView: () => setViewMode(app.viewMode === "3d" ? "2d" : "3d"),
    cycleCamera: () => cycleCamera(),
    cycleTime: () => {
      const next = TIME_MODES[(TIME_MODES.indexOf($("time-mode").value) + 1) % TIME_MODES.length];
      setTimeMode(next);
    },
    cycleLayout: () => setLayoutChoice(nextLayoutChoice(app.layoutChoice)),
    toggleRace: () => toggleRace(),
    toggleMenu: () => toggleDrawer("menu"),
    takePhoto: () => takePhoto(),
    togglePause: () => performPause(app.pause?.toggle(now()) ?? [], now()),
    closePanels: () => {
      closeDrawers();
      $("finish").hidden = true;
    },
  };
  app.ride.unbindKeyboard = bindKeyboard(window, app.actions);
  $("pause-ride").addEventListener("click", () => app.actions?.togglePause());
  $("lane-left").addEventListener("click", () => app.actions?.laneLeft());
  $("lane-right").addEventListener("click", () => app.actions?.laneRight());
  if (app.trainer instanceof PaddleTrainer) {
    document.body.classList.add("paddling");
    app.paddleView = new PaddleView($("paddles"), app.trainer, {
      onLane: (side) => (side === "left" ? app.actions?.laneLeft() : app.actions?.laneRight()),
    });
  }
}

// -------------------------------------------------------------- vehicles ---

/**
 * Start menu: board a vehicle with its code. Joins the selected route (the first
 * map when the studio is), then boards; a code on another route rejoins there (#55).
 */
function initStartVehicle() {
  const view = new VehicleView($("start-vehicle"), {
    onBoard: (code) => {
      if ($("join").dataset.busy) return;
      const routeId = boardingRoute(routesOf(app.info), app.routeId);
      if (routeId) app.routeId = routeId;
      app.pendingBoardCode = code;
      renderStartMenu();
      joinRide().catch(joinFailed);
    },
  });
  app.startVehicleView = view;
  $("board-start").addEventListener("click", () => view.showBoard());
}

/** Ride menu: create or board a vehicle, see its seats, leave it. */
function initVehicle() {
  for (const id of ["vehicle-view", "hud-seats"]) $(id).replaceChildren();
  app.vehicleView = new VehicleView($("vehicle-view"), {
    onCreate: (options) => app.connection.createVehicle(options),
    onBoard: (code) => {
      app.boardingCode = code;
      app.connection.boardVehicle(code);
    },
    onLeave: () => app.connection.leaveVehicle(),
  });
  app.seatsView = new VehicleView($("hud-seats"), {}, { compact: true });
  // Assigned as properties: the ride's DOM outlives a ride, listeners would pile up.
  $("vehicle-create-open").onclick = () => app.vehicleView.showCreate();
  $("vehicle-board-open").onclick = () => app.vehicleView.showBoard();
}

const notCaptain = () => Boolean(app.state?.vehicle) && !isCaptain(app.state.vehicle, app.riderId);

function captainSteersHint() {
  if (now() - app.lastCaptainHintAt < 3) return;
  app.lastCaptainHintAt = now();
  notify("The captain steers");
}

/** Panels, HUD line and energy for the vehicle I'm on (null: none). */
function renderVehicle(vehicle) {
  document.body.classList.toggle("aboard", Boolean(vehicle));
  const riders = app.state?.riders ?? [];
  app.vehicleView?.update(vehicle, app.riderId, riders);
  app.seatsView?.update(vehicle, app.riderId, riders);
  $("vehicle-buttons").hidden = Boolean(vehicle);
  const line = aboardLine(vehicle, app.riderId);
  app.hud.set("vehicle", line ?? "");
  $("hud-vehicle").hidden = !line;
  // Boarding or leaving moves me to the captain's spot: that jump isn't distance ridden.
  if ((vehicle?.id ?? null) !== app.vehicleId) app.lastMyDistance = null;
  if (!vehicle) {
    app.vehicleId = null;
    return;
  }
  if (app.vehicleId !== vehicle.id) {
    app.vehicleId = vehicle.id;
    app.seatEnergy = new SeatEnergy();
    app.lastVehicleAt = now();
  }
  app.vehicleKind = vehicle.kind;
  const t = now();
  app.seatEnergy.add(vehicle, Math.min(1, Math.max(0, t - app.lastVehicleAt)));
  app.lastVehicleAt = t;
}

/** The code I tried is on another route: restart there and board on joining. */
function boardElsewhere(routeId) {
  if (!routeId || !app.boardingCode || !app.connection) return false;
  const code = app.boardingCode;
  if (!leaveRide()) {
    notify("Finish your ride to board that vehicle");
    return true;
  }
  app.routeId = routeId;
  writeSetting(ROUTE_KEY, routeId);
  app.vehicleCode = code;
  renderStartMenu();
  joinRide().catch(joinFailed);
  return true;
}

// -------------------------------------------------------------- workout ---

/** The café workout screen (#77): the workout HUD instead of the ride's, the world behind it. */
function startWorkout() {
  document.body.classList.add("working-out");
  $("workout-hud").hidden = false;
  app.workoutView = new WorkoutStudioView($("workout-hud"));
  app.workoutHeartRate = null;
  app.workoutAudio = "AudioContext" in globalThis ? new AudioContext() : null;
  // The server drops a joined connection after 120 s of silence: repeat the exercise as a keepalive.
  app.workoutKeepalive = startKeepalive({ send: (exercise) => app.connection?.workout(exercise), current: () => app.workout?.currentExercise() ?? null });
  app.workoutCue = createCue({
    audioContext: app.workoutAudio,
    vibrate: navigator.vibrate ? (ms) => navigator.vibrate(ms) : null,
  });
  app.workoutUnsubscribe = app.heartRateMonitor?.on("data", ({ heartRate }) => {
    if (!Number.isFinite(heartRate)) return;
    app.workoutHeartRate = heartRate;
    app.workout?.heartRate(heartRate);
  });
  app.wakeLock.acquire();

  const run = (actions) => runWorkoutActions(actions);
  const togglePause = () => run(app.workout.state === "paused" ? app.workout.resume() : app.workout.pause());
  $("workout-pause").addEventListener("click", togglePause);
  $("workout-skip-block").addEventListener("click", () => run(app.workout.skip()));
  $("workout-end").addEventListener("click", () => run(app.workout.end()));
  $("workout-back").addEventListener("click", () => endRide());
  // After the reconnector gave up: end the workout (its record is kept), or try again.
  $("finish-and-save").addEventListener("click", () => run(app.workout.end()));
  $("keep-trying").addEventListener("click", () => connectionLost(app.connection));
  app.actions = { togglePause };
  app.ride.unbindKeyboard = bindKeyboard(window, app.actions);

  initViews();
  // One loop per workout: it ends with the ride.
  const ride = app.ride;
  const loop = () => {
    if (app.ride !== ride) return;
    requestAnimationFrame(loop);
    workoutFrame();
  };
  requestAnimationFrame(loop);
}

/** Carries out what the workout session decided. */
function runWorkoutActions(actions) {
  for (const [kind, value] of actions) {
    if (kind === "send") app.connection.workout(value);
    else if (kind === "cue") {
      if (app.profile.workoutCues !== false) app.workoutCue?.();
    } else if (kind === "finished") finishWorkout();
  }
}

function workoutFrame() {
  const workout = app.workout;
  if (!workout) return;
  runWorkoutActions(workout.tick());
  const t = now();
  let blockStart = null;
  if (workout.state !== "done") {
    const position = workout.position();
    app.workoutView.render(workoutHudText(position, { state: workout.state, heartRate: app.workoutHeartRate }), blockProgress(position));
    $("workout-pause").textContent = workout.state === "paused" ? "Resume" : "Pause";
    // Paused, the plan clock is frozen: the avatar's idle clip keeps the server's start so it keeps moving.
    if (position.block && workout.state !== "paused") blockStart = t - (position.block.seconds - position.blockRemainingS);
  }
  if (app.state && app.viewMode === "3d") {
    // My avatar keeps step with my timer: its clip starts with the block, not when the server echoed it.
    const riders = app.smoother.sample(t).map((rider) => (rider.id === app.riderId && blockStart !== null ? { ...rider, exerciseSince: blockStart } : rider));
    app.view3d.render({ riders, myId: app.riderId, myCadence: 0, timeS: t, colors: themeColors() });
  }
}

/** Stores the history record of the workout so far, if an exercise block was done. @returns {?object} */
function saveWorkoutRecord() {
  const record = app.workout?.record() ?? null;
  if (record) app.history.save(record);
  return record;
}

function finishWorkout() {
  const record = saveWorkoutRecord();
  $("workout-hud").hidden = true;
  $("workout-summary-plan").textContent = app.workoutPlan.name;
  $("workout-summary-none").hidden = Boolean(record);
  $("workout-summary-list").hidden = !record;
  $("workout-summary-title").textContent = "Workout ended";
  if (record) {
    const text = summaryText(record, app.workoutPlan, { finished: app.workout.completed });
    $("workout-summary-title").textContent = text.title;
    $("workout-summary-worked").textContent = text.worked;
    $("workout-summary-blocks").textContent = text.blocks;
    $("workout-summary-hr").textContent = text.hr;
    $("workout-summary-hr-row").hidden = text.hr === "";
  }
  $("workout-summary").hidden = false;
  $("workout-back").focus();
}

// --------------------------------------------------------------- studio ---

function startStudio({ simulated, setSimPower }) {
  const studio = app.studio;
  $("ride").dataset.mode = "studio";
  $("hud-route").textContent = app.route.name;
  $("studio-wrap").hidden = false;
  $("sim-panel").hidden = !simulated;

  const renderControls = () => {
    $("studio-erg").setAttribute("aria-pressed", String(studio.erg));
    $("studio-erg").disabled = !studio.canControl;
    $("studio-erg").title = studio.canControl ? "ERG: the trainer holds the target" : "Your trainer only sends power: follow the targets yourself";
    $("studio-intensity").textContent = `${Math.round(studio.intensity * 100)} %`;
    $("studio-voice").setAttribute("aria-pressed", String(app.coachVoice));
    $("hud-gear-tile").hidden = !app.gearbox || studio.erg;
    $("power-hint").hidden = !simulated || studio.erg;
    $("sim-stepper").hidden = !simulated || studio.erg;
  };
  const adjust = (direction) => {
    if (studio.erg) {
      studio.adjust(direction);
      renderControls();
    } else if (simulated) {
      setSimPower(app.trainer.power + direction * 10);
    }
  };
  $("studio-erg").addEventListener("click", () => {
    studio.setErg(!studio.erg);
    renderControls();
    app.session.refreshResistance();
    if (simulated && !studio.erg) setSimPower(app.trainer.power);
  });
  $("studio-intensity-up").addEventListener("click", () => adjust(+1));
  $("studio-intensity-down").addEventListener("click", () => adjust(-1));
  $("studio-voice").hidden = !("speechSynthesis" in globalThis);
  $("studio-voice").addEventListener("click", () => {
    app.coachVoice = !app.coachVoice;
    writeSetting(COACH_VOICE_KEY, app.coachVoice ? "on" : "off");
    renderControls();
  });
  renderControls();

  if (isWebGl2Available()) {
    try {
      app.studioView = new StudioView3D($("studio3d"), $("studio-labels"));
      const camera = readSetting(STUDIO_CAMERA_KEY);
      if (STUDIO_CAMERAS.includes(camera)) app.studioView.cameraMode = camera;
    } catch (error) {
      console.error(error);
      notify("The 3D studio is unavailable on this device; targets and the board still work.", "error");
    }
  }

  app.actions = {
    powerUp: () => adjust(+1),
    powerDown: () => adjust(-1),
    shiftUp: () => shift(+1),
    shiftDown: () => shift(-1),
    cycleCamera: () => cycleCamera(),
    toggleMenu: () => toggleDrawer("menu"),
    takePhoto: () => takePhoto(),
    closePanels: () => {
      closeDrawers();
      $("finish").hidden = true;
    },
  };
  app.ride.unbindKeyboard = bindKeyboard(window, app.actions);
}

/** The coach reads a cue out loud, if the rider wants that. */
function speak(text) {
  if (!app.coachVoice || !("speechSynthesis" in globalThis)) return;
  speechSynthesis.cancel();
  speechSynthesis.speak(new SpeechSynthesisUtterance(text));
}

function updateStudioPanels() {
  const state = app.state;
  const me = state.riders.find((r) => r.id === app.riderId);
  $("studio-room").textContent = state.rooms > 1 ? `Room ${state.room + 1} of ${state.rooms}` : "The room";
  const board = studioBoard(state.riders, app.riderId);
  for (const list of [$("studio-board"), $("rider-list")]) {
    list.replaceChildren(
      ...board.map((row) => {
        const item = document.createElement("li");
        if (row.me) item.className = "me";
        const name = Object.assign(document.createElement("span"), { className: "board-name", textContent: `${row.rank}. ${row.name}` });
        if (row.isBot) name.append(Object.assign(document.createElement("span"), { className: "badge", textContent: "bot" }));
        item.append(name, Object.assign(document.createElement("span"), { textContent: row.onTarget }));
        return item;
      }),
    );
  }
  $("studio-on-target").textContent = me?.on_target_pct === null || me?.on_target_pct === undefined ? "–" : `${Math.round(me.on_target_pct)} %`;
  $("studio-kj").textContent = `${Math.round(me?.class_kj ?? 0)} kJ`;
  renderOnline();
  // Files and Strava get the class name once it runs.
  if (state.class.elapsed_s >= 0) app.route.name = `Spin Studio · ${state.class.name}`;
}

function studioFrame() {
  const studio = app.studio;
  if (!studio.state) return;
  const t = now();
  const riders = studio.state.riders;
  const me = riders.find((r) => r.id === app.riderId);
  const position = studio.position(t);
  const plan = studio.plan;
  const { power, cadence, heartRate } = app.session.latest;

  // The coach pedals at the cadence the block asks for.
  const coachCadence = position?.cadence ? (position.cadence[0] + position.cadence[1]) / 2 : 75;
  if (app.studioView) {
    const colors = themeColors();
    const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim();
    app.studioView.render({ riders, myId: app.riderId, myCadence: cadence, coachCadence, timeS: t, colors: { ...colors, accent } });
  }
  if (app.sceneRequests.length) {
    const scene = app.studioView ? grabScene($("studio3d")) : null;
    for (const callback of app.sceneRequests.splice(0)) callback(scene);
  }

  const cue = studio.newCue(t);
  if (cue) {
    const text = cue.phase === "lobby" ? `Welcome! ${plan.name} starts in ${formatDuration(cue.startsInS)}.` : cue.cue;
    notify(`${INSTRUCTOR.name}: ${text}`, "chat");
    speak(text);
  }

  if (position && plan) {
    const lobby = position.phase === "lobby";
    const countdown = lobby ? position.startsInS : (position.blockRemainingS ?? null);
    $("studio-phase").textContent = lobby ? `Next class · ${plan.name}` : position.phase === "done" ? plan.name : `${plan.name} · block ${position.index + 1} of ${plan.segments.length}`;
    $("studio-cue").textContent = position.cue;
    $("studio-countdown").textContent = countdown === null ? "–" : formatDuration(countdown);
    $("studio-countdown").classList.toggle("soon", countdown !== null && countdown <= 5);
    const next = position.next;
    $("studio-next").textContent = next ? `Next: ${next.cue} · ${formatDuration(next.duration_s)} at ${Math.round(((next.from + next.to) / 2) * 100)} % FTP` : "";
    $("studio-class").textContent = plan.name;
    $("studio-class-left").textContent = lobby ? `starts in ${formatDuration(position.startsInS)}` : position.classRemainingS ? `${formatDuration(position.classRemainingS)} left` : "";
    drawWorkout($("studio-chart"), { workout: classWorkout(plan), elapsedS: Math.max(0, studio.elapsed(t)), colors: themeColors() });
  }

  const target = studio.targetWatts(t);
  const watts = Math.round(power || 0);
  $("studio-target").textContent = target ?? "–";
  $("studio-power").textContent = watts;
  const onTarget = target !== null && Math.abs(watts - target) <= target * 0.1;
  $("studio-power").classList.toggle("on-target", onTarget);
  $("studio-power").classList.toggle("off-target", target !== null && !onTarget);
  $("studio-cadence").textContent = Number.isFinite(cadence) ? Math.round(cadence) : "–";
  $("studio-cadence-cue").textContent = position?.cadence ? `${position.cadence[0]}–${position.cadence[1]}` : "";
  app.hud.set("hr", Number.isFinite(heartRate) ? Math.round(heartRate) : "–");
  app.hud.set("time", formatDuration(t - app.rideStartedAt));
  app.hud.set("distance", formatDistance(me?.distance ?? 0));
  app.hud.set("avg-speed", averageSpeed(me?.distance ?? 0, t - app.rideStartedAt));
  app.rideDistance = me ? app.distanceOffset + me.distance : app.rideDistance;

  // Offline the rider's last state is stale: they don't move until the server is back.
  if (app.recorder.add({ t: Date.now(), distance: app.rideDistance, power, cadence, heartRate, speed: app.offline ? 0 : (me?.speed ?? 0), elevation: null })) updateSplits();
  const silentFor = t - (app.lastTrainerDataAt ?? app.rideStartedAt);
  $("trainer-warning").hidden = silentFor < 5;
}

// --------------------------------------------------------------- finish ---

/** Back to the menu; asks first when the ride or its photos would be lost. @returns {boolean} false if the rider stayed */
function leaveRide() {
  // The ride and its photos only live in this page until it is left.
  const exportable = canExportRide(app.trainer);
  const unsaved = (exportable && !app.rideSaved && !app.recorder.empty) || app.album.size > 0;
  const question = exportable
    ? "Back to the menu? This ride and its photos are not kept: download or upload them first."
    : "Back to the menu? Your photos are not kept: save them first.";
  if (unsaved && !confirm(question)) return false;
  // Left on purpose: nothing to continue later.
  app.autosave.clear();
  endRide();
  return true;
}

function initFinish() {
  $("finish-ride").addEventListener("click", () => openFinish());
  $("ride-on").addEventListener("click", () => ($("finish").hidden = true));
  $("back-to-start").addEventListener("click", () => leaveRide());
  $("download-tcx").addEventListener("click", () => {
    if (!canExportRide(app.trainer)) return;
    const tcx = app.recorder.toTcx({ name: rideName(), splits: app.finishSplits });
    downloadBlob(new Blob([tcx], { type: "application/vnd.garmin.tcx+xml" }), rideFileName(app.recorder.samples[0].t, app.rideRoute.id));
    rideKept();
  });
  $("download-fit").addEventListener("click", () => {
    if (!canExportRide(app.trainer)) return;
    downloadBlob(new Blob([app.recorder.toFit({ indoor: Boolean(app.studio), splits: app.finishSplits })], { type: "application/vnd.ant.fit" }), rideFileName(app.recorder.samples[0].t, app.rideRoute.id, "fit"));
    rideKept();
  });
  $("download-gpx").addEventListener("click", () => {
    if (!canExportRide(app.trainer)) return;
    const gpx = app.recorder.toGpx({ name: rideName() });
    downloadBlob(new Blob([gpx], { type: "application/gpx+xml" }), rideFileName(app.recorder.samples[0].t, app.rideRoute.id, "gpx"));
    rideKept();
  });
  $("upload-strava").addEventListener("click", () => uploadToStrava());
}

const rideName = () => (app.eventRide ? eventRideName(app.eventRide.kind, app.eventRide.routeName) : `OpenRadlr · ${app.rideRoute.name}`);

function finishStats() {
  const summary = app.recorder.summary();
  const stats = [
    ["Time", formatDuration(summary.durationS)],
    ["Distance", formatDistanceWithUnit(summary.distanceM)],
    ["Avg power", `${summary.avgPower} W`],
    ["Max power", `${summary.maxPower} W`],
    ["Climbed", formatElevation(summary.elevationGainM)],
    ["Work", `${summary.kilojoules} kJ`],
  ];
  if (summary.avgHeartRate) stats.push(["Avg heart rate", `${summary.avgHeartRate} bpm`]);
  if (app.seatEnergy && app.vehicleKind) {
    stats.push(["Vehicle", app.seatEnergy.summaryLine(app.vehicleKind)]);
    for (const seat of app.seatEnergy.perSeat()) stats.push([`${seat.name}${seat.isBot ? " (bot)" : ""}`, `${Math.round(seat.kj)} kJ`]);
  }
  return stats;
}

function openFinish() {
  closeDrawers();
  const stats = finishStats();
  app.finishScene = null;
  requestScene((scene) => {
    app.finishScene = scene;
    refreshSummaryImage();
  });
  renderPhotos();
  $("finish-summary").replaceChildren(
    ...stats.map(([label, value]) => {
      const item = document.createElement("div");
      const dt = Object.assign(document.createElement("dt"), { textContent: label });
      const dd = Object.assign(document.createElement("dd"), { textContent: value });
      item.append(dt, dd);
      return item;
    }),
  );
  $("finish-route").textContent = `${app.rideRoute.name} · ${app.connection.serverInfo.server_name}`;
  const empty = app.recorder.empty;
  app.finishSplits = empty ? [] : rideSplits(true);
  renderSplits($("finish-splits"), app.finishSplits, app.splitUnitM);
  $("download-tcx").disabled = empty;
  $("download-gpx").disabled = empty;
  $("download-fit").disabled = empty;
  // A studio ride stays in the room: no positions, so no GPX (TCX still works).
  $("download-gpx").hidden = Boolean(app.studio);
  // Phone paddle rides: photos and the summary card only, no ride files.
  const exportable = canExportRide(app.trainer);
  if (!exportable) for (const id of ["download-tcx", "download-gpx", "download-fit"]) $(id).hidden = true;
  // Strava gets rides measured by a real trainer only, not taps or keys.
  const measured = hasRealPowerSource(app.trainer);
  $("ftp-prompt").hidden = true;
  if (!empty) {
    app.history.save(
      rideRecord({
        recorder: app.recorder,
        splits: app.finishSplits,
        splitMode: app.splitMode,
        routeId: app.studio ? null : app.rideRoute.id,
        measured,
        profile: app.profile,
        test: app.ftpTest?.testFlag ?? null,
      }),
    ).then(offerFtp);
  }
  const canUpload = measured && Boolean(app.stravaAccount?.can_upload);
  $("upload-strava").hidden = !canUpload;
  $("upload-strava").disabled = empty;
  $("upload-status").textContent = empty
    ? "Ride a little longer to save this ride."
    : !exportable
      ? "Phone paddle rides stay in OpenRadlr: no ride files and no Strava upload. Save your photos and the summary card below."
      : !measured
        ? "Strava uploads need a real trainer: this ride's power came from the simulated trainer. You can still download it and save the photos."
      : app.stravaAccount && !canUpload
      ? "Uploading needs the \"upload activities\" permission: disconnect and connect Strava again to allow it."
      : "";
  $("finish").hidden = false;
}

function uploadToStrava() {
  if (!hasRealPowerSource(app.trainer)) return;
  return uploadRide(app.recorder, rideName(), { indoor: Boolean(app.studio), splits: app.finishSplits, button: $("upload-strava"), status: $("upload-status"), onSaved: rideKept });
}

/**
 * Uploads `recorder`'s ride to Strava as FIT, reporting in `status`. Also
 * used for an autosaved ride from the start menu (#73).
 */
async function uploadRide(recorder, name, { indoor, splits = [], button, status, onSaved }) {
  button.disabled = true;
  status.textContent = "Uploading to Strava…";
  try {
    // FIT: the only format that tells Strava it was a virtual ride (and keeps its climbing).
    const upload = await app.strava.upload(recorder.toFit({ indoor, splits }), name);
    status.textContent = "Uploaded. Strava is processing it…";
    const done = await app.strava.waitForActivity(upload);
    if (done.error) {
      status.textContent = `Strava: ${done.error}`;
      button.disabled = false;
    } else if (done.activity_id) {
      onSaved();
      status.replaceChildren(
        "Done! ",
        Object.assign(document.createElement("a"), { href: activityUrl(done.activity_id), target: "_blank", rel: "noopener", textContent: "View on Strava" }),
        // Strava only lets partner apps attach photos, so riders add them by hand.
        " · Strava doesn't let apps add photos: save or share the images below and add them there.",
      );
    } else {
      onSaved();
      status.textContent = "Uploaded. It will appear on Strava in a minute.";
    }
  } catch (error) {
    status.textContent = `Upload failed: ${error.message}`;
    button.disabled = false;
  }
}

// ------------------------------------------------------------- recovery ---
// A ride survives a dropped connection and a crashed tab (#73).

/** The ride file is downloaded or uploaded: nothing left to recover. */
function rideKept() {
  app.rideSaved = true;
  app.autosave.clear();
}

/** The socket closed mid-ride: keep riding and try to get back on. */
function connectionLost(lost) {
  if (!app.ride || app.reconnector?.running) return;
  app.offline = true;
  $("disconnected").hidden = true;
  $("reconnecting").hidden = false;
  const ride = app.ride;
  app.reconnector = new Reconnector({
    connect: () => rejoin(lost),
    onConnected: (back) => app.ride === ride && reconnected(back, lost),
    onGiveUp: () => {
      if (app.ride !== ride) return;
      $("reconnecting").hidden = true;
      $("disconnected").hidden = false;
    },
  });
  app.reconnector.start();
}

/** One attempt: a new connection that asks for the same rider back. */
async function rejoin(lost) {
  const connection = new GameConnection({ url: defaultServerUrl() });
  wireConnection(connection);
  try {
    const riderId = await connection.join({
      ...app.profile,
      routeId: app.route.id,
      level: levelOf(app.profile),
      // A workout rider is flagged again by its join, also when the server forgot it.
      device: app.workout ? "workout" : deviceKind(app.trainer),
      resumeToken: lost.resumeToken,
      resume: app.studio || app.workout ? null : app.lastOnRoute,
    });
    return { connection, riderId, close: () => connection.close() };
  } catch (error) {
    connection.close();
    throw error;
  }
}

/**
 * Back on the server: the same rider (nothing to do) or a new one after the
 * grace period. Only the same rider comes back with the same token; ids
 * start again after a server restart.
 */
function reconnected({ connection, riderId }, lost) {
  const fresh = connection.resumeToken !== lost.resumeToken || riderId !== app.riderId;
  app.connection = connection;
  app.session?.setConnection(connection);
  app.offline = false;
  $("reconnecting").hidden = true;
  $("disconnected").hidden = true;
  // A pause (or its end) sent while offline never arrived, and a new rider is not parked.
  if (app.pause) connection[app.pause.state === "parked" ? "pause" : "resume"]();
  // The avatar is parked at the café again (a fresh rider is flagged by the join): say what it is doing.
  resyncWorkout(app.workout, connection);
  if (!fresh) return;
  const me = app.state?.riders?.find((rider) => rider.id === app.riderId);
  const ended = [(me?.lap ?? null) !== null || app.eventRide ? " · your race ended" : "", app.vehicleId ? " · your seat ended" : ""].join("");
  // The new rider starts where the old one was: no distance for the jump.
  Object.assign(app, {
    riderId,
    state: null,
    lastMyDistance: null,
    distanceOffset: app.rideDistance,
    myRoad: null,
    lastRoad: null,
    offRoute: null,
    junction: null,
    vehicleId: null,
    vehicleKind: null,
    seatEnergy: null,
    boardingCode: null,
    eventRide: null,
    eventStartedAt: null,
    eventResults: null,
  });
  if (!app.studio) app.smoother = new RiderSmoother(app.route, { routeOf: (rider) => app.routes.get(rider.route) });
  notify(app.workout ? "Back at the gym" : `Back on the road as a free rider${ended}`);
}

/** The splits of the recorded ride; `final: false` while it goes on (the last one is still open). */
function rideSplits(final) {
  return computeSplits(app.recorder.samples, app.recorder.pauses, {
    mode: app.splitMode,
    unitM: app.splitUnitM,
    routeLength: (id) => app.routes.get(id)?.length ?? null,
    final,
  });
}

/** Whole-ride average speed for the top-left HUD ("–" in the first seconds); time excludes pauses (rideStartedAt follows rejoins). */
const averageSpeed = (metres, seconds) => (seconds >= 5 ? formatSpeed(metres / seconds) : "–");

/** The "Last split" fields: the full line, and label and time only for the narrow training column. */
function showLastSplit(split) {
  app.hud.set("last-split", split ? splitLine(split, app.splitUnitM) : "–");
  app.hud.set("last-split-short", split ? `${splitLabel(split, app.splitUnitM)} · ${formatDuration(split.durationS)}` : "–");
}

/** Fixes the split mode and unit for this ride (#83); splits already closed before a rejoin don't pop up again. */
function startSplits() {
  app.splitMode = resolveSplitMode(app.profile.splitMode, app.studio ? null : app.route.length);
  app.splitUnitM = unitMetres();
  app.splits = rideSplits(false);
  app.shownSplits = Math.max(0, app.splits.length - 1);
  const latest = app.splits[app.shownSplits - 1];
  showLastSplit(latest);
}

/** Called for every recorded sample: shows a split the moment it closes. */
function updateSplits() {
  if (app.splitMode === "off") return;
  app.splits = rideSplits(false);
  const closed = app.splits.length - 1;
  if (closed <= app.shownSplits) return;
  app.shownSplits = closed;
  const line = splitLine(app.splits[closed - 1], app.splitUnitM);
  showLastSplit(app.splits[closed - 1]);
  const toast = $("split-toast");
  toast.textContent = line;
  toast.hidden = false;
  clearTimeout(app.splitToastTimer);
  app.splitToastTimer = setTimeout(() => (toast.hidden = true), 5000);
}

/** Continue: the autosaved recorder and photos, with the gap as a pause. */
function restoreRide({ snapshot, photos }) {
  app.recorder = RideRecorder.from(snapshot.recorder);
  app.recorder.pause(snapshot.savedAt);
  app.recorder.resume(Date.now());
  app.rideStartedAt = now() - app.recorder.summary().durationS;
  app.rideDistance = snapshot.distance;
  // The same rider back (within the grace period) keeps the studio's odometer; a new one starts at 0.
  const same = app.connection.resumeToken === snapshot.resumeToken && app.riderId === snapshot.riderId;
  app.distanceOffset = same ? snapshot.distanceOffset : snapshot.distance;
  for (const photo of photos) app.album.add(photo.blob, { name: photo.name, takenAt: photo.takenAt });
  if (photos.length) {
    $("photo-count").textContent = app.album.size;
    $("photo-count").hidden = false;
  }
  app.restored = null;
  app.unfinished = null;
}

function startAutosave() {
  clearInterval(app.autosaveTimer);
  app.autosaveTimer = setInterval(saveRide, AUTOSAVE_INTERVAL_MS);
}

/** Writes the ride to the browser (phone paddle rides have no file to keep). */
function saveRide() {
  if (!app.ride || !app.recorder?.samples.length || app.rideSaved || !canExportRide(app.trainer)) return;
  app.autosave.save({
    version: 1,
    savedAt: Date.now(),
    serverUrl: defaultServerUrl(),
    routeId: app.route.id,
    routeName: app.rideRoute.name,
    studio: Boolean(app.studio),
    trainerKind: deviceKind(app.trainer),
    rideStartedAt: Date.now() - (now() - app.rideStartedAt) * 1000,
    distance: app.rideDistance,
    riderId: app.riderId,
    distanceOffset: app.distanceOffset,
    resumeToken: app.connection?.resumeToken ?? null,
    graceS: app.connection?.graceS ?? 0,
    resumePoint: app.studio ? null : app.lastOnRoute,
    recorder: app.recorder.toJSON(),
  });
}

async function refreshUnfinished() {
  app.unfinished = await app.autosave.load();
  renderUnfinished();
}

function renderUnfinished() {
  const saved = app.unfinished;
  $("unfinished").hidden = !saved || Boolean(app.ride);
  if (!saved) return;
  $("unfinished-label").textContent = unfinishedLabel(saved, { now: Date.now(), formatDistance: (m) => formatDistanceWithUnit(m, 1) });
  $("continue-ride").hidden = !continueAllowed(saved, { now: Date.now(), serverUrl: defaultServerUrl() });
}

async function discardUnfinished() {
  await app.autosave.clear();
  app.unfinished = null;
  renderUnfinished();
}

function initRecovery() {
  // The page may be gone in a moment (tab closed, phone locked): save now.
  window.addEventListener("pagehide", saveRide);
  window.addEventListener("pagehide", saveWorkoutRecord);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "hidden") return;
    saveRide();
    saveWorkoutRecord();
  });
  $("continue-ride").addEventListener("click", async () => {
    const snapshot = app.unfinished;
    if (!snapshot) return;
    const restored = { snapshot, photos: await app.autosave.photos() };
    app.routeId = snapshot.routeId;
    renderStartMenu();
    joinRide(restored).catch(joinFailed);
  });
  $("save-unfinished").addEventListener("click", async () => {
    const snapshot = app.unfinished;
    if (!snapshot) return;
    const photos = await app.autosave.photos();
    $("unfinished-save").hidden = false;
    $("unfinished-photos").hidden = photos.length === 0;
    $("unfinished-strava").hidden = !(snapshot.trainerKind === "trainer" && app.stravaAccount?.can_upload);
  });
  const recorderOf = (snapshot) => RideRecorder.from(snapshot.recorder);
  const kept = () => {
    $("unfinished-status").textContent = "Saved. Your ride is no longer kept in this browser.";
    discardUnfinished();
  };
  $("unfinished-fit").addEventListener("click", () => {
    const snapshot = app.unfinished;
    if (!snapshot) return;
    const recorder = recorderOf(snapshot);
    downloadBlob(new Blob([recorder.toFit({ indoor: snapshot.studio })], { type: "application/vnd.ant.fit" }), rideFileName(recorder.samples[0].t, snapshot.routeId, "fit"));
    kept();
  });
  $("unfinished-photos").addEventListener("click", async () => {
    const photos = await app.autosave.photos();
    photos.forEach((photo, i) => setTimeout(() => downloadBlob(photo.blob, photo.name), i * 250));
  });
  $("unfinished-strava").addEventListener("click", () => {
    const snapshot = app.unfinished;
    if (!snapshot) return;
    uploadRide(recorderOf(snapshot), `OpenRadlr · ${snapshot.routeName}`, {
      indoor: snapshot.studio,
      button: $("unfinished-strava"),
      status: $("unfinished-status"),
      onSaved: kept,
    });
  });
  $("discard-unfinished").addEventListener("click", () => {
    if (confirm("Discard the unfinished ride? Its file and photos are gone for good.")) discardUnfinished();
  });
  refreshUnfinished();
}

// --------------------------------------------------------------- photos ---

function initPhotos() {
  $("take-photo").addEventListener("click", () => takePhoto());
  $("menu-photo").addEventListener("click", () => {
    closeDrawers();
    // Let the drawer close before the next frame is captured.
    requestAnimationFrame(() => takePhoto());
  });
  $("download-photos").addEventListener("click", () => {
    app.album.images.forEach((image, i) => setTimeout(() => downloadBlob(image.blob, image.name), i * 250));
  });
  $("share-photos").addEventListener("click", () => sharePhotos());
}

/** Calls back with a copy of the next frame of the visible world (3D or 2D). */
function requestScene(callback) {
  app.sceneRequests.push(callback);
}

function takePhoto() {
  const me = app.state ? myRider(app.state.riders) : null;
  const stats = photoStats({
    distanceM: app.rideDistance,
    elapsedS: now() - app.rideStartedAt,
    power: app.session.latest.power,
    speed: me?.speed ?? 0,
    gradePercent: me && app.route.gradeAt ? app.route.gradeAt(me.distance) : 0,
  });
  const flash = $("photo-flash");
  flash.hidden = false;
  flash.classList.remove("flash");
  void flash.offsetWidth; // restart the animation
  flash.classList.add("flash");
  requestScene(async (scene) => {
    try {
      const takenAt = Date.now();
      const photo = composePhoto(scene, { routeName: app.route.name, stats, when: new Date(takenAt) });
      const blob = await canvasToPng(photo);
      const name = photoFileName(takenAt, app.rideRoute.id, app.album.size + 1);
      app.album.add(blob, { name, takenAt });
      app.autosave.addPhoto({ name, blob, takenAt });
      $("photo-count").textContent = app.album.size;
      $("photo-count").hidden = false;
      notify(`Photo ${app.album.size} saved · find your photos in the ride summary (Menu → Finish ride)`);
      if (!$("finish").hidden) renderPhotos();
    } catch (error) {
      notify(`Photo failed: ${error.message}`, "error");
    }
  });
}

function renderPhotos() {
  const photos = app.album.photos;
  const images = app.album.images;
  $("photos-count").textContent = photos.length ? `(${photos.length})` : "";
  $("photos-hint").hidden = photos.length > 0;
  $("download-photos").hidden = images.length === 0;
  $("download-photos").textContent = images.length === 1 ? "Download image" : "Download all images";
  $("share-photos").hidden = !canShareFiles() || images.length === 0;
  $("photo-list").replaceChildren(
    ...images.map((photo) => {
      const item = document.createElement("li");
      const open = Object.assign(document.createElement("button"), { type: "button", className: "photo-thumb", title: `Download ${photo.name}` });
      const alt = photo.summary ? "Ride summary card" : `Photo taken at ${new Date(photo.takenAt).toLocaleTimeString()}`;
      open.append(Object.assign(document.createElement("img"), { src: photo.url, alt }));
      open.addEventListener("click", () => downloadBlob(photo.blob, photo.name));
      if (photo.summary) {
        item.classList.add("summary-thumb");
        item.append(open, Object.assign(document.createElement("span"), { className: "summary-label", textContent: "Summary" }));
        return item;
      }
      const remove = Object.assign(document.createElement("button"), { type: "button", className: "photo-remove", textContent: "×", title: "Delete photo" });
      remove.setAttribute("aria-label", "Delete photo");
      remove.addEventListener("click", () => {
        app.album.remove(photo.id);
        $("photo-count").textContent = app.album.size;
        $("photo-count").hidden = app.album.size === 0;
        renderPhotos();
      });
      item.append(open, remove);
      return item;
    }),
  );
}

/** Redraws the summary card (totals change while "Keep riding") and shows it with the photos. */
async function refreshSummaryImage() {
  try {
    const { blob, name } = await summaryImage();
    app.album.setSummary(blob, { name, takenAt: app.recorder.samples[0]?.t ?? Date.now() });
    if (!$("finish").hidden) renderPhotos();
  } catch (error) {
    notify(`Summary image failed: ${error.message}`, "error");
  }
}

async function summaryImage() {
  const samples = app.recorder.samples;
  const canvas = composeSummary({
    routeName: app.rideRoute.name,
    serverName: app.connection.serverInfo.server_name,
    when: new Date(samples[0]?.t ?? Date.now()),
    stats: finishStats(),
    power: samples.map((s) => s.power),
    elevation: samples.map((s) => s.elevation),
    scene: app.finishScene,
  });
  const blob = await canvasToPng(canvas);
  return { blob, name: photoFileName(samples[0]?.t ?? Date.now(), app.rideRoute.id, "summary") };
}

/** Phones: hand the summary and all photos to another app, e.g. Strava. */
async function sharePhotos() {
  try {
    const files = app.album.images.map(({ blob, name }) => new File([blob], name, { type: "image/png" }));
    await navigator.share({ files, title: rideName() });
  } catch (error) {
    if (error.name !== "AbortError") notify(`Sharing failed: ${error.message}`, "error");
  }
}

// --------------------------------------------------------------- online ---

async function refreshServerPlayers() {
  try {
    const response = await fetch("/api/info", { cache: "no-store" });
    if (!response.ok) return;
    const info = await response.json();
    app.serverPlayers = Number.isFinite(info.players) ? info.players : null;
    // The ride menu lists events from the same info.
    app.info = info;
    app.infoAt = Date.now();
    if (app.state) renderOnline();
  } catch {
    // Keep the last known count; the game connection reports real outages.
  }
}

function renderOnline() {
  const { count, text } = onlineSummary(app.serverPlayers, app.state.riders, app.state.route_riders);
  $("hud-online").textContent = count;
  $("open-social").title = `Riders and chat · ${text}`;
  $("open-social").setAttribute("aria-label", `Riders and chat, ${text}`);
  $("online-summary").textContent = text;
}

// ------------------------------------------------------------- shifting ---

function initShifting() {
  const enabled = Boolean(app.gearbox);
  $("hud-gear-tile").hidden = !enabled;
  $("shift-hint").hidden = !enabled;
  if (!enabled) return;
  $("shift-up").addEventListener("click", () => shift(+1));
  $("shift-down").addEventListener("click", () => shift(-1));
  renderGear();
}

/** Shifts one gear; the same entry point serves keyboard, buttons and controllers. */
function shift(direction) {
  if (!app.gearbox || app.training.mode === "erg" || app.studio?.erg) return;
  const changed = direction > 0 ? app.gearbox.shiftUp() : app.gearbox.shiftDown();
  if (!changed) return;
  renderGear();
  app.session.refreshResistance();
}

function renderGear() {
  $("hud-gear").textContent = app.gearbox.gear;
  $("hud-gear-count").textContent = `/${app.gearbox.count}`;
  $("hud-gear-sub").textContent = `ratio ${app.gearbox.ratio.toFixed(2)}`;
}

// ------------------------------------------------------------------ hud ---

/** HUD parts shared by roads and the studio. */
function initHudCommon() {
  app.hud = new MetricBinder($("hud"));
  renderUnits();
  $("open-menu").addEventListener("click", () => toggleDrawer("menu"));
  $("open-social").addEventListener("click", () => toggleDrawer("social"));
  for (const button of document.querySelectorAll(".drawer [data-close]")) {
    button.addEventListener("click", () => closeDrawers());
  }
  $("drawer-backdrop").addEventListener("click", () => closeDrawers());
  $("hud-camera").addEventListener("click", () => cycleCamera());
}

function initHud() {
  $("hud-layout").addEventListener("click", () => setLayoutChoice(nextLayoutChoice(app.layoutChoice)));
  $("layout-mode").addEventListener("change", (e) => setLayoutChoice(e.target.value));
  $("hud-skip").addEventListener("click", () => app.training.skipSegment());
  $("hud-stop").addEventListener("click", () => app.training.stopWorkout());
  $("hud-intensity-up").addEventListener("click", () => adjustErg(+1));
  $("hud-intensity-down").addEventListener("click", () => adjustErg(-1));
  setLayoutChoice(readSetting(LAYOUT_KEY) ?? "auto", { remember: false });
}

function toggleDrawer(id) {
  const drawer = $(id);
  const open = drawer.hidden;
  closeDrawers();
  drawer.hidden = !open;
  $("drawer-backdrop").hidden = !open;
  if (id === "menu") $("open-menu").setAttribute("aria-expanded", String(open));
}

function closeDrawers() {
  $("menu").hidden = true;
  $("social").hidden = true;
  $("drawer-backdrop").hidden = true;
  $("open-menu").setAttribute("aria-expanded", "false");
}

function setLayoutChoice(choice, { remember = true } = {}) {
  app.layoutChoice = LAYOUT_LABELS[choice] ? choice : "auto";
  $("layout-mode").value = app.layoutChoice;
  if (remember) writeSetting(LAYOUT_KEY, app.layoutChoice);
  updateLayout();
}

/** Applies the layout for the current choice and ride state. */
function updateLayout() {
  const me = app.state ? myRider(app.state.riders) : null;
  const layout = chooseLayout({
    choice: app.layoutChoice,
    workoutRunning: Boolean(app.training?.workout),
    racePhase: app.state?.race?.phase ?? null,
    inRace: inRace(app.state?.race, me, app.riderId),
  });
  if (layout !== app.layout || $("ride").dataset.layout !== layout) {
    app.layout = layout;
    $("ride").dataset.layout = layout;
  }
  const label = app.layoutChoice === "auto" ? `Auto · ${LAYOUT_LABELS[layout]}` : LAYOUT_LABELS[layout];
  if ($("hud-layout").textContent !== label) $("hud-layout").textContent = label;
}

/** Join during the countdown, leave any time before the finish. */
function toggleRace() {
  if (app.state?.vehicle) return;
  const event = app.state?.event;
  if (event) {
    const joinable = event.phase === "lobby" || (event.phase === "running" && event.kind === "group_ride");
    if (event.entered) return app.connection.leaveEvent();
    if (joinable) return app.connection.joinEvent(event.id);
  }
  const race = app.state?.race;
  const me = app.state ? myRider(app.state.riders) : null;
  if (!race || (race.phase !== "countdown" && race.phase !== "running")) return;
  if (inRace(race, me, app.riderId)) app.connection.leaveRace();
  else if (race.phase === "countdown") app.connection.joinRace();
}

/** Lobby banner, running pill and power sharing line of the scheduled event. */
function renderEventCall(event) {
  const banner = eventBanner(event);
  $("event-call").hidden = !banner;
  if (banner) {
    $("event-call-text").textContent = banner;
    $("event-call").classList.toggle("entered", Boolean(event.entered));
    $("event-call-button").textContent = event.entered ? "Leave (J)" : "Join (J)";
  }
  const gap = event?.phase === "running" && event.entered && event.sharing ? groupGapLine(event.sharing.gap_s) : "";
  $("group-gap").hidden = !gap;
  $("group-gap").textContent = gap;
  const line = sharingLine(event?.sharing);
  $("sharing-line").hidden = !line;
  $("sharing-line").textContent = line;
}

/** Shows an event's results in the menu's results list; a race I finished moves my riding level. */
function eventFinished(event) {
  const mine = event.results.find((result) => result.rider_id === app.riderId);
  // Everyone on the route hears it; only entrants get the results.
  if (!app.eventRide && !mine) return;
  const lines = eventResultRows(event.results, event.event_kind, app.riderId);
  app.eventResults = { title: event.event_kind === "race" ? "Race results" : "Group ride results", lines };
  showEventResults();
  $("menu").hidden = false;
  $("open-menu").setAttribute("aria-expanded", "true");
  const startedAt = app.eventStartedAt;
  app.eventStartedAt = null;
  if (event.event_kind !== "race" || mine?.place === undefined || mine?.place === null || !startedAt) return;
  const powers = (app.recorder?.samples ?? []).filter((sample) => sample.t >= startedAt && sample.t <= Date.now()).map((sample) => sample.power || 0);
  if (!powers.length) return;
  const level = levelAfterRace(levelOf(app.profile), powers.reduce((a, b) => a + b, 0) / powers.length);
  if (level === levelOf(app.profile)) return;
  app.profile = profiles.save({ ...app.profile, levelW: level });
  showLevel();
}

function showEventResults() {
  const { title, lines } = app.eventResults;
  $("results-title").textContent = title;
  $("results-title").hidden = false;
  $("race-results").replaceChildren(
    ...lines.map((line) => {
      const item = document.createElement("li");
      item.className = "result";
      item.textContent = line;
      return item;
    }),
  );
}

function renderRaceCall(race, me) {
  const entered = inRace(race, me, app.riderId);
  const call = $("race-call");
  $("leave-race").hidden = !entered;
  call.hidden = race.phase !== "countdown";
  if (call.hidden) return;
  const others = (race.entrants ?? []).filter((id) => id !== app.riderId).length;
  call.classList.toggle("entered", entered);
  $("race-call-title").textContent = entered ? "You're in!" : `Race · ${race.laps} ${race.laps === 1 ? "lap" : "laps"}`;
  const field = entered ? `${others} ${others === 1 ? "other" : "others"} entered` : `${others} ${others === 1 ? "rider" : "riders"} entered`;
  $("race-call-text").textContent = `starts in ${Math.ceil(race.remaining_s)} s · ${field}`;
  $("race-call-button").textContent = entered ? "Leave (J)" : "Join race (J)";
}

function markerText(marker) {
  if (!marker) return "Road ahead";
  return marker.inside ? `${marker.label}: ${formatLength(marker.inM)} to go` : `${marker.label} in ${formatLength(marker.inM)}`;
}

/** Gauge arc and target tick for the cockpit. */
function renderGauge(power, target) {
  const ftp = app.profile.ftp;
  $("gauge-fill").style.strokeDashoffset = String(100 - gaugeFraction(power, ftp) * 100);
  const tick = $("gauge-target");
  tick.hidden = target === null;
  if (target === null) return;
  const angle = Math.PI * (1 - gaugeFraction(target, ftp));
  const point = (r) => [150 + r * Math.cos(angle), 160 - r * Math.sin(angle)];
  const [x1, y1] = point(104);
  const [x2, y2] = point(136);
  tick.setAttribute("x1", x1.toFixed(1));
  tick.setAttribute("y1", y1.toFixed(1));
  tick.setAttribute("x2", x2.toFixed(1));
  tick.setAttribute("y2", y2.toFixed(1));
}

function renderRaceLists(standing) {
  const groups = $("race-groups");
  const around = $("race-around");
  if (!standing) {
    groups.replaceChildren();
    around.replaceChildren();
    return;
  }
  const row = (className, cells) => {
    const item = document.createElement("li");
    if (className) item.className = className;
    for (const [text, cellClass] of cells) {
      const cell = document.createElement("span");
      if (cellClass) cell.className = cellClass;
      cell.textContent = text;
      item.append(cell);
    }
    return item;
  };
  groups.replaceChildren(
    ...standing.groups.slice(0, 5).map((group) =>
      row(group.mine ? "mine" : "", [
        [`${group.label} · ${group.size} ${group.size === 1 ? "rider" : "riders"}`],
        [formatTimeGap(group.gapS, { mine: group.mine }), "gap"],
      ]),
    ),
  );
  around.replaceChildren(
    ...standing.around.map((entry) =>
      row(entry.mine ? "mine" : "", [
        [String(entry.position), "pos"],
        [riderName(entry.rider), "rider-name"],
        [formatTimeGap(entry.gapS, { mine: entry.mine }), "gap"],
      ]),
    ),
  );
}

// ------------------------------------------------------------- training ---

function initTraining({ simulated, setSimPower }) {
  const training = app.training;
  renderWorkoutOptions(0);
  $("workout-select").addEventListener("change", () => renderWorkoutDescription());

  $("mode-sim").addEventListener("click", () => training.setMode("sim"));
  $("mode-erg").addEventListener("click", () => training.setMode("erg"));
  for (const [id, direction] of [
    ["erg-up", +1],
    ["erg-down", -1],
    ["intensity-up", +1],
    ["intensity-down", -1],
  ]) {
    $(id).addEventListener("click", () => adjustErg(direction));
  }

  $("workout-start").addEventListener("click", () => {
    const workout = app.workouts[Number($("workout-select").value)];
    if (!workout) return;
    training.startWorkout(workout);
    notify(`Workout started: ${workout.name}`);
  });
  $("workout-skip").addEventListener("click", () => training.skipSegment());
  $("workout-stop").addEventListener("click", () => training.stopWorkout());
  $("workout-import").addEventListener("click", () => $("workout-file").click());
  $("workout-file").addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      if (file.size > 512 * 1024) throw new Error("The file is larger than 512 KB.");
      const workout = parseZwo(await file.text());
      app.workouts.push(workout);
      renderWorkoutOptions(app.workouts.length - 1);
      $("training-note").textContent = `Imported "${workout.name}".`;
    } catch (error) {
      $("training-note").textContent = `Import failed: ${error.message}`;
    }
  });

  initFtpTest({ simulated });
  training.on("change", () => {
    renderTraining({ simulated });
    app.session.refreshResistance();
    // The simulated trainer leaves ERG power behind when going back to the road.
    if (simulated && training.mode === "sim") setSimPower(app.trainer.power);
  });
  training.on("workoutFinished", (workout) => notify(`Workout complete: ${workout.name}. Well done!`));
  renderTraining({ simulated });
}

function initFtpTest({ simulated }) {
  const session = app.ftpTest;
  const actions = {
    begin: () => session.begin(),
    proceed: () => session.proceed(),
    start: () => session.start(),
    back: () => session.back(),
    done: () => session.done(),
    retry: () => session.begin(),
    use: () => {
      applyFtp(session.result.ftp, "tested", { ftpDismissed: null });
      session.reset();
    },
    keep: () => session.reset(),
  };
  for (const slot of ["primary", "secondary"]) {
    $(`ftp-test-${slot}`).addEventListener("click", () => actions[$(`ftp-test-${slot}`).dataset.action]?.());
  }
  $("ftp-test-start").addEventListener("change", (event) => session.setStart(Number(event.target.value)));
  $("ftp-test-step").addEventListener("change", (event) => session.setStep(Number(event.target.value)));
  session.on("change", () => {
    renderFtpTest();
    renderTraining({ simulated });
  });
  // The result sits in the training panel; point to it when that is closed
  session.on("result", () => {
    if ($("menu").hidden) notify("Ramp test done: open the training panel for your FTP.");
  });
  renderFtpTest();
}

/** Mirrors the session into the training panel. Cheap enough to call every frame. */
function renderFtpTest() {
  const session = app.ftpTest;
  if (!session) return;
  const view = ftpTestState({ state: session.state, startW: session.startW, stepW: session.stepW, liveMinuteW: session.liveMinuteW(), result: session.result, ftp: app.profile.ftp, source: app.profile.ftpSource });
  $("ftp-test-heading").textContent = view.heading;
  setText($("ftp-test-body"), view.body);
  $("ftp-test-fields").hidden = !view.fields;
  for (const [id, value] of [["ftp-test-start", session.startW], ["ftp-test-step", session.stepW]]) {
    if (document.activeElement !== $(id)) $(id).value = String(value);
  }
  for (const [slot, entry] of [["primary", view.primary], ["secondary", view.secondary]]) {
    const button = $(`ftp-test-${slot}`);
    button.hidden = !entry;
    if (!entry) continue;
    button.textContent = entry.label;
    button.dataset.action = entry.id;
  }
  // A studio class controls the trainer itself
  $("ftp-test-primary").disabled = session.state === "idle" && Boolean(app.studio);
}

/** Writes only when the text changed, so a per-frame call doesn't churn the live region. */
function setText(element, text) {
  if (element.textContent !== text) element.textContent = text;
}

function adjustErg(direction) {
  // The "change" event re-sends resistance.
  app.training.adjust(direction);
}

function renderWorkoutOptions(selected) {
  const select = $("workout-select");
  select.replaceChildren(
    ...app.workouts.map((workout, index) => {
      const option = document.createElement("option");
      option.value = String(index);
      option.textContent = `${workout.name} · ${Math.round(totalDuration(workout) / 60)} min`;
      return option;
    }),
  );
  select.value = String(selected);
  renderWorkoutDescription();
}

function renderWorkoutDescription() {
  $("workout-description").textContent = app.workouts[Number($("workout-select").value)]?.description ?? "";
}

function renderTraining({ simulated }) {
  const training = app.training;
  const erg = training.mode === "erg";
  const running = Boolean(training.workout);
  $("mode-sim").setAttribute("aria-pressed", String(!erg));
  $("mode-erg").setAttribute("aria-pressed", String(erg));
  $("mode-erg").disabled = !training.canControl;
  $("mode-erg").title = training.canControl ? "" : "Your trainer can't hold a target power";
  // The ramp is its own workout: no picker or manual target while a test runs
  const testing = app.ftpTest?.state !== "idle";
  $("erg-manual").hidden = !erg || running || testing;
  $("erg-intensity").hidden = !running || training.locked;
  $("workout-skip").hidden = training.locked;
  // The HUD's copies of the same controls
  $("hud-skip").hidden = training.locked;
  $("hud-intensity-down").parentElement.hidden = training.locked;
  $("workout-picker").hidden = running || testing;
  $("workout-running").hidden = !running;
  $("workout-name").textContent = running ? training.workout.name : erg ? "ERG · manual target" : "No workout running";
  $("erg-badge").hidden = !erg && !training.guided;
  $("erg-badge").textContent = training.guided ? "Guided" : "ERG";
  $("hud-gear-tile").hidden = !app.gearbox || erg;
  if (!running) resetWorkoutHud();
  $("erg-target").textContent = `${training.ergTarget} W`;
  $("intensity-value").textContent = `${Math.round(training.intensity * 100)} %`;
  $("erg-hint").hidden = !erg;
  $("power-hint").hidden = !simulated || erg;
  $("sim-panel").hidden = !simulated || erg;
  $("sim-stepper").hidden = !simulated || erg;
  if (app.gearbox) $("shift-hint").hidden = erg;
  $("training-note").textContent = !training.canControl
    ? "Your trainer only sends power: workouts show targets to follow, resistance stays as it is."
    : erg && app.gearbox
      ? "Virtual shifting is paused in ERG mode."
      : "";
}

function resetWorkoutHud() {
  $("workout-block").textContent = "Start a workout from the menu (M)";
  $("workout-next").textContent = "";
  $("workout-block-time").textContent = "–";
  $("workout-elapsed").textContent = "0:00";
  $("workout-remaining").textContent = "0:00";
  $("workout-avg").textContent = "– W";
  $("workout-progress").style.width = "0%";
  app.workoutPower = { joules: 0, seconds: 0, lastT: null };
}

function renderWorkoutProgress(t) {
  const state = app.training.tick(t, app.session.latest);
  // After the training clock, so the ramp's elapsed seconds are current
  app.ftpTest?.tick(t, app.session.latest);
  if (app.ftpTest?.state === "warmup") renderFtpTest();
  const workout = app.training.workout;
  if (!state || state.finished || !workout) return;
  const paused = app.training.player?.paused;

  // Average power over the workout's riding time (pauses excluded).
  const stats = app.workoutPower;
  if (stats.lastT !== null && !paused) {
    const dt = Math.min(1, t - stats.lastT);
    stats.joules += (app.session.latest.power || 0) * dt;
    stats.seconds += dt;
  }
  stats.lastT = t;

  if (app.layout === "training") {
    drawWorkout($("workout-chart"), { workout, elapsedS: state.elapsedS, colors: themeColors() });
  }
  const total = state.elapsedS + state.remainingS;
  const next = workout.segments[state.index + 1];
  const nextWatts = next ? Math.round(((next.from + next.to) / 2) * (app.training.player?.ftp ?? app.profile.ftp) * app.training.intensity) : 0;
  $("workout-block").textContent = `Block ${state.index + 1} of ${workout.segments.length} · ${state.segment.label}${paused ? " (paused)" : ""}`;
  $("workout-next").textContent = next ? `Next: ${next.label} ${formatDuration(next.durationS)} · ${nextWatts} W` : "Last block";
  $("workout-block-time").textContent = formatDuration(state.segmentRemainingS);
  $("workout-elapsed").textContent = formatDuration(state.elapsedS);
  $("workout-remaining").textContent = formatDuration(state.remainingS);
  $("workout-avg").textContent = stats.seconds > 0 ? `${Math.round(stats.joules / stats.seconds)} W` : "– W";
  $("workout-progress").style.width = `${total > 0 ? ((state.elapsedS / total) * 100).toFixed(1) : 0}%`;
}

// ---------------------------------------------------------------- views ---

function initViews() {
  $("view-3d").addEventListener("click", () => setViewMode("3d"));
  $("view-2d").addEventListener("click", () => setViewMode("2d"));
  $("camera-mode").addEventListener("click", () => cycleCamera());
  $("quality-mode").addEventListener("click", () => setQuality(app.view3d.quality === "high" ? "low" : "high"));
  $("time-mode").addEventListener("change", (e) => setTimeMode(e.target.value));
  $("view-3d").disabled = true;
  setViewMode("2d", { remember: false });

  if (!isWebGl2Available()) {
    $("view-note").textContent = "3D needs WebGL 2";
    return;
  }
  // Built in the menu already: ready right away.
  if (app.menuView) {
    const view = app.menuView;
    app.menuView = null;
    view.rideMode();
    show3d(null, view);
    return;
  }
  // Building the world (with the other routes on its map) takes a moment,
  // off the main thread where possible; ride in 2D meanwhile.
  $("view-note").textContent = "Building 3D world…";
  const ride = app.ride;
  Promise.all([fetchMapNeighbours(app.route, routesOf(app.info), fetchRouteFile), fetchMapNetwork(app.route, fetchNetworkFile)])
    .then(([others, network]) => buildScene(app.routeFile, others, { network }))
    .then((scene) => app.ride === ride && show3d(scene))
    .catch((error) => {
      if (app.ride !== ride) return;
      console.error(error);
      $("view-note").textContent = "3D view unavailable on this device";
    });
}

/** A route file from the server (the default route without an id). */
async function fetchRouteFile(id) {
  const response = await fetch(id ? `/api/route?id=${encodeURIComponent(id)}` : "/api/route");
  if (!response.ok) throw new Error(`Could not load the route (HTTP ${response.status}).`);
  return response.json();
}

/** A shared map's road network file (#26); fails for maps without one. */
async function fetchNetworkFile(mapId) {
  const response = await fetch(`/api/map?id=${encodeURIComponent(mapId)}`);
  if (!response.ok) throw new Error(`No road network for map ${mapId} (HTTP ${response.status}).`);
  return response.json();
}

/** Shows the 3D view once its world is built (or takes the menu's view as it is). */
function show3d(scene, view = null) {
  try {
    app.view3d = view ?? new View3D($("world3d"), $("labels3d"), app.route, scene);
  } catch (error) {
    console.error(error);
    $("view-note").textContent = "3D view unavailable on this device";
    // The workout screen has no 2D view: say so where it is visible.
    if (app.workout) {
      $("workout-note").textContent = "The gym needs 3D (WebGL2), which this device lacks. The timer and cues still work.";
      $("workout-note").hidden = false;
    }
    return;
  }
  app.view3d.routes = app.routes;
  app.view3d.network = app.network;
  if (app.view3d.route !== app.route) app.view3d.setRoute(app.route);
  $("view-note").textContent = "";
  $("view-3d").disabled = false;
  const camera = readSetting(CAMERA_KEY);
  if (CAMERA_MODES[camera]) app.view3d.setCameraMode(camera);
  renderCameraButton();
  setTimeMode(TIME_MODES.includes(readSetting(TIME_KEY)) ? readSetting(TIME_KEY) : "day");
  setQuality(readSetting(QUALITY_KEY) === "low" ? "low" : "high");
  setViewMode(startingViewMode(readSetting(VIEW_KEY), { workout: Boolean(app.workout) }), { remember: false });
  // The workout watches my avatar on the gym mat (#77).
  const gym = app.workout ? gymOfRoute(app.view3d.gyms, app.route) : null;
  if (gym) app.view3d.workoutMode(gym, { reducedMotion: Boolean(globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches) });
}

function cycleCamera() {
  if (app.studio) {
    if (!app.studioView) return;
    const mode = app.studioView.cycleCamera();
    writeSetting(STUDIO_CAMERA_KEY, mode);
    notify(`Camera: ${STUDIO_CAMERA_LABELS[mode]}`);
    return;
  }
  if (!app.view3d) return;
  writeSetting(CAMERA_KEY, app.view3d.cycleCamera());
  renderCameraButton();
}

function renderCameraButton() {
  // The workout's gym camera is not one of the ride's modes and does not cycle.
  $("camera-mode").textContent = `Camera: ${CAMERA_MODES[app.view3d.camera.mode]?.label ?? "Gym"}`;
}

function setQuality(quality) {
  app.view3d.setQuality(quality);
  $("quality-mode").textContent = `Graphics: ${quality === "high" ? "High" : "Low"}`;
  writeSetting(QUALITY_KEY, quality);
}

function setTimeMode(mode) {
  if (!app.view3d) return;
  app.view3d.setTimeMode(mode);
  $("time-mode").value = mode;
  writeSetting(TIME_KEY, mode);
}

function setViewMode(mode, { remember = true } = {}) {
  const use3d = mode === "3d" && Boolean(app.view3d);
  app.viewMode = use3d ? "3d" : "2d";
  $("world-wrap").hidden = !use3d;
  $("peloton").hidden = use3d;
  $("view-3d").setAttribute("aria-pressed", String(use3d));
  $("view-2d").setAttribute("aria-pressed", String(!use3d));
  $("scene-controls").hidden = !use3d;
  if (remember) writeSetting(VIEW_KEY, app.viewMode);
}

function myRider(riders) {
  return riders.find((rider) => rider.id === app.riderId);
}

/** After a turn, my own road hands over to the new route this far into it (past its rounded corner). */
const TURN_SETTLE_M = 80;

/**
 * Follows my rider onto the road the server has me on (#15). On a route I
 * ride its geometry. Through a turn away from it (picked, near the
 * junction, until a little past it) and off every route I ride a road of my
 * own built from the network: the road before, this one and the next, so
 * camera and rider take the turn smoothly instead of running on along the
 * old route until the server's next state. Returns my rider in the terms of
 * the road I ride.
 */
function followMyRoad(rider) {
  const road = rider.road ?? null;
  app.myRoad = road;
  const network = app.network;
  const known = (step) => step && network?.edges.has(step[0]);
  const current = road && [road.edge, road.dir];
  const next = road?.next ? [road.next.edge, road.next.dir] : null;
  const onRoute = rider.route !== null;
  const route = onRoute && rider.route ? app.routes.get(rider.route) : null;
  const ownRoad = (() => {
    if (!known(current)) return false;
    if (!onRoute) return true;
    const length = network.edges.get(road.edge).length;
    // A turn off this route is planned at the junction ahead.
    const turning = known(next) && length - road.offset <= JUNCTION_WINDOW_M && !routeContinues(rider.route, current, next);
    // Just turned: until past the corner the route's geometry doesn't match my own road.
    const settling = app.offRoute && road.offset < TURN_SETTLE_M && app.offRoute.steps.some((s) => s[0] === current[0] && s[1] === current[1]);
    return turning || settling;
  })();
  if (!ownRoad) {
    if (road && onRoute) app.lastRoad = road;
    app.offRoute = null;
    if (route && route !== app.route) switchRoute(route);
    return rider;
  }
  const key = JSON.stringify([current, next]);
  if (app.offRoute?.key !== key) {
    const same = (x, y) => x && y && x[0] === y[0] && x[1] === y[1];
    const before = app.offRoute ? app.offRoute.current : app.lastRoad && [app.lastRoad.edge, app.lastRoad.dir];
    const prev = app.offRoute && same(app.offRoute.current, current) ? app.offRoute.prev : before;
    const steps = [same(prev, current) ? null : prev, current, next].filter(known);
    const { geometry, bases } = offRouteRoad(network, steps);
    app.offRoute = { key, current, prev, steps, bases, geometry, base: bases[steps.findIndex((s) => same(s, current))] };
    app.routes.set(OFF_ROUTE_ID, geometry);
    switchRoute(geometry, onRoute ? route : null);
  }
  app.offRoute.routeId = onRoute ? rider.route : null;
  return { ...rider, route: OFF_ROUTE_ID, distance: app.offRoute.base + road.offset };
}

/** Another rider on one of the roads of my own road rides it with me: same distances. */
function onMyOwnRoad(rider) {
  const own = app.offRoute;
  const road = rider.road;
  if (!own || !road) return rider;
  const i = own.steps.findIndex(([e, d]) => e === road.edge && d === road.dir);
  return i < 0 ? rider : { ...rider, route: OFF_ROUTE_ID, distance: own.bases[i] + road.offset };
}

/** True if `route` (an id) rides `next` right after `current`. */
function routeContinues(routeId, current, next) {
  const walk = app.network?.routes.find((r) => r.id === routeId)?.walk ?? [];
  return walk.some(([e, d], i) => e === current[0] && d === current[1] && walk[(i + 1) % walk.length][0] === next[0] && walk[(i + 1) % walk.length][1] === next[1]);
}

/**
 * Rides on along `route` (another route, or my own road). `named` is the
 * route my own road belongs to while turning or settling (null off route).
 */
function switchRoute(route, named = null) {
  app.route = route;
  app.smoother.route = route;
  app.view3d?.setRoute(route);
  // Distances on the new road don't continue the old one's.
  app.lastMyDistance = null;
  $("hud-route").textContent = route.id !== OFF_ROUTE_ID ? route.name : named ? named.name : "Off route";
}

/** The roads at the junction ahead, while it's in reach (not for race or event entrants: the server locks their turns). */
function renderJunction(race, me) {
  const box = $("junction");
  const junction = app.network && !notCaptain() && !inRace(race, me, app.riderId) && !app.state?.event?.entered ? junctionAhead(app.network, app.myRoad, { routeId: app.offRoute ? app.offRoute.routeId : app.route.id }) : null;
  app.junction = junction;
  box.hidden = !junction;
  if (!junction) {
    $("junction-options").dataset.key = "";
    return;
  }
  $("junction-title").textContent = `${junction.place?.name ?? "Junction"} in ${formatLength(junction.toGo)}`;
  const list = $("junction-options");
  // Same roads as before: only the pick changes (rebuilding would eat taps).
  const key = junction.options.map((o) => `${o.edge}:${o.dir}`).join();
  if (list.dataset.key === key) {
    junction.options.forEach((option, i) => list.children[i]?.setAttribute("aria-pressed", String(option.planned)));
    return;
  }
  list.dataset.key = key;
  list.replaceChildren(
    ...junction.options.map((option) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "junction-option";
      button.setAttribute("aria-pressed", String(option.planned));
      const arrow = document.createElement("span");
      arrow.className = "junction-arrow";
      arrow.textContent = { left: "←", straight: "↑", right: "→" }[option.side];
      const label = document.createElement("span");
      label.textContent = option.route ? option.route.name : "Off route";
      const towards = document.createElement("small");
      towards.textContent = option.towards ? `to ${option.towards}` : "";
      button.append(arrow, label, towards);
      button.addEventListener("click", () => chooseTurn(option));
      return button;
    }),
  );
}

/** Takes `option` at the junction ahead (the server confirms with the next state). */
function chooseTurn(option) {
  if (!option || !app.junction || !app.myRoad) return;
  app.connection.turn(option.edge);
  app.myRoad = { ...app.myRoad, next: { edge: option.edge, dir: option.dir } };
  renderJunction(app.state.race, myRider(app.state.riders));
}

/** Riders on my route (all of them from a server that doesn't say). */
function onMyRoute(rider) {
  return !rider.route || rider.route === app.route.id;
}

function updatePanels() {
  const me = myRider(app.state.riders);
  if (!me) return;
  const routes = routesOf(app.info);
  const routeName = (id) => routes.find((route) => route.id === id)?.name ?? id;
  const elsewhere = (app.state.elsewhere ?? []).map((rider) => ({ rider, routeName: routeName(rider.route) }));
  const sections = riderSections(me, app.state.riders, app.route, elsewhere);
  renderRiderList($("rider-list"), sections.humans, app.riderId);
  renderRiderList($("bot-list"), sections.bots, app.riderId);
  $("bot-heading").hidden = $("bot-list").hidden = sections.bots.length === 0;
  renderOnline();
  if (app.layout === "broadcast") renderRiderList($("hud-nearby"), nearbyRiders(me, app.state.riders, app.route, 7), app.riderId);
  const race = app.state.race;
  // Event results stay until the next race is called.
  if (race.phase === "countdown") {
    app.eventResults = null;
    $("results-title").hidden = true;
  }
  if (!app.eventResults) renderResults($("race-results"), race.results ?? [], app.riderId, (id) => app.state.riders.find((rider) => rider.id === id));
  const event = app.state.event;
  if (event?.entered && !app.eventRide) app.eventRide = { kind: event.kind, routeName: app.route.name };
  renderEventCall(event);
  const status = raceStatus(race, me.lap);
  $("race-status").textContent = status;
  // The race banner covers the countdown; the pill shows the rest.
  $("race-status").hidden = !race.phase || race.phase === "idle" || race.phase === "countdown";
  if (event?.phase === "running" && event.entered && (!race.phase || race.phase === "idle")) {
    $("race-status").textContent = `${event.name} · running`;
    $("race-status").hidden = false;
  }
  $("start-race").disabled = race.phase === "countdown" || race.phase === "running";
  // The server reserves the route for an event, so no race can start on it.
  const blocked = eventBlocksRace(event);
  $("race-controls").hidden = blocked;
  $("race-blocked").hidden = !blocked;
  $("race-blocked").textContent = blocked ? `A ${event.kind === "race" ? "race" : "group ride"} is on this route, so races are off until it ends.` : "";
  renderRaceCall(race, me);
  renderVehicle(app.state.vehicle ?? null);
  renderJunction(race, me);

  app.standing = raceStanding(race, app.state.riders, app.riderId, app.route.length);
  updateLayout();
  renderRaceLists(app.layout === "race" ? app.standing : null);
  $("race-groups-panel").hidden = !app.standing;
  const hud = app.hud;
  const standing = app.standing;
  hud.set("lap-info", status);
  hud.set("position", standing ? formatPosition(standing.position, standing.total) : "–");
  hud.set("lap", standing ? `${standing.lap}/${standing.laps}` : "–");
  hud.set("to-go", standing ? formatLength(standing.toGoM) : "–");
  hud.set("race-caption", standing ? `${status} · ${formatLength(standing.toGoM)} to the finish` : race.phase === "countdown" ? status : "No race running · start one from the menu (M)");
}

/**
 * Runs the pause (#89) for this frame and shows it. @returns {boolean} true
 * if the ride was left (paused for too long): the frame is over.
 */
function updatePause(t, me) {
  const pause = app.pause;
  if (!pause) return false;
  const race = app.state?.race;
  pause.allowed = !app.vehicleId && !app.state?.event?.entered && !inRace(race, me, app.riderId);
  const left = performPause(pause.update({ now: t, speed: me?.speed ?? 0, power: app.session.latest.power || 0, offline: app.offline }), t);
  if (left) return true;
  const button = $("pause-ride");
  button.hidden = !pause.allowed;
  button.textContent = pause.state === "riding" ? "Pause" : "Resume";
  const pill = $("pause-pill");
  pill.hidden = pause.state === "riding";
  if (!pill.hidden) pill.textContent = `Paused · ${formatDuration(t - app.pausedFrom)}${pause.state === "parked" ? " · pedal to resume" : ""}`;
  return false;
}

/** Carries out what the pause state machine decided. @returns {boolean} true if the ride was left */
function performPause(actions, t) {
  for (const action of actions) {
    switch (action) {
      case "pauseTimer":
        app.pausedFrom = t;
        app.recorder.pause(Date.now());
        app.training.held = true;
        break;
      case "resumeTimer":
        // The ride time skips the pause.
        if (app.pausedFrom !== null) app.rideStartedAt += t - app.pausedFrom;
        app.pausedFrom = null;
        app.recorder.resume(Date.now());
        app.training.held = false;
        break;
      case "park":
        app.connection?.pause();
        break;
      case "unpark":
        app.connection?.resume();
        break;
      case "leave":
        // Paused for too long: back to the menu; the autosave offers Continue.
        saveRide();
        endRide();
        notify("Paused for 30 minutes: your ride is kept. Continue it from the menu.");
        return true;
    }
  }
  return false;
}

function frame() {
  if (!app.state) return;

  const t = now();
  const everyone = app.smoother.sample(t);
  const riders = everyone.filter(onMyRoute);
  const me = myRider(riders);
  const colors = themeColors();
  if (updatePause(t, me)) return;

  if (me) {
    if (app.lastMyDistance !== null) {
      app.rideDistance += Math.max(0, app.route.signedGap(app.lastMyDistance, me.distance));
    }
    app.lastMyDistance = me.distance;
  }

  const draft = me ? draftInfo(me, riders, app.route) : null;
  if (app.viewMode === "3d") {
    app.view3d.render({ riders: everyone, myId: app.riderId, myCadence: app.session.latest.cadence, timeS: t, colors });
  } else {
    drawPeloton($("peloton"), { route: app.route, riders, me, draft, colors });
  }
  // Read the canvas now: a WebGL buffer is cleared once the frame is shown.
  if (app.sceneRequests.length) {
    const scene = grabScene(app.viewMode === "3d" ? $("world3d") : $("peloton"));
    for (const callback of app.sceneRequests.splice(0)) callback(scene);
  }

  // Only the canvases of the visible layout are drawn.
  const layout = app.layout;
  if (layout === "broadcast") {
    drawProfile($("profile"), { route: app.route, riders, myId: app.riderId, colors });
    drawMinimap($("minimap"), { route: app.route, riders, myId: app.riderId, colors });
  } else if (layout === "cockpit" && me) {
    drawUpcoming($("upcoming"), { route: app.route, distance: me.distance, ahead: 2000, colors });
  } else if (layout === "race" && app.standing) {
    drawRaceTimeline($("race-timeline"), { standing: app.standing, myId: app.riderId, colors });
  }

  renderWorkoutProgress(t);
  const target = app.training.targetWatts();
  const { power, cadence, heartRate } = app.session.latest;
  const watts = Math.round(power || 0);
  const hud = app.hud;
  hud.set("power", watts);
  hud.set("wkg", formatWkg(power || 0, app.profile.weightKg));
  hud.set("zone", `Z${Math.max(1, powerZone(power || 0, app.profile.ftp))}`);
  hud.set("target", target === null ? "–" : target);
  hud.set("target-suffix", target === null ? "" : ` · target ${target} W`);
  hud.set("cadence", Number.isFinite(cadence) ? Math.round(cadence) : "–");
  hud.set("hr", Number.isFinite(heartRate) ? Math.round(heartRate) : "–");
  hud.set("speed", formatSpeed(me?.speed ?? 0));
  hud.set("grade", `${me ? formatGrade(app.route.gradeAt(me.distance)) : "0.0"} %`);
  hud.set("distance", formatDistance(app.rideDistance));
  // The ride time stands still while paused.
  const clock = app.pausedFrom ?? t;
  hud.set("avg-speed", averageSpeed(app.rideDistance, clock - app.rideStartedAt));
  hud.set("time", formatDuration(clock - app.rideStartedAt));
  hud.set("intensity", `${Math.round(app.training.intensity * 100)} %`);
  if (layout === "cockpit") renderGauge(power || 0, target);
  const trainingPower = $("training-power");
  const onTarget = target !== null && Math.abs(watts - target) <= Math.max(10, target * 0.05);
  trainingPower.classList.toggle("on-target", onTarget);
  trainingPower.classList.toggle("off-target", target !== null && !onTarget);

  const marker = me ? nextMarker(app.route, me.distance, 3000) : null;
  hud.set("next-marker", markerText(marker));
  const banner = $("marker-banner");
  const showBanner = layout === "race" && marker !== null && (marker.inside || marker.inM <= 1000);
  banner.hidden = !showBanner;
  if (showBanner) {
    banner.classList.toggle("climb", marker.type === "climb");
    hud.set("banner-label", marker.inside ? `${marker.label} · to go` : marker.label);
    hud.set("banner-distance", formatLength(marker.inM));
  }

  const position = me ? app.route.positionAt(me.distance) : null;
  const onRoad = me && me.route !== OFF_ROUTE_ID;
  // No samples while paused: the ride file holds the pause instead (#89).
  const kept = !app.pause?.pausedAt && app.recorder.add({
    t: Date.now(),
    ...(position ? toLatLon(position.x, position.y, app.route.geo) : {}),
    route: onRoad ? (me.route ?? app.route.id) : null,
    routeM: onRoad ? me.distance : null,
    distance: app.rideDistance,
    power,
    cadence,
    heartRate,
    // Offline the rider's last state is stale: they don't move until the server is back.
    speed: app.offline ? 0 : (me?.speed ?? 0),
    elevation: me ? app.route.elevationAt(me.distance) : null,
  });
  if (kept) updateSplits();

  const draftText = draft ? `Drafting · −${draft.savingPercent} % drag` : "";
  $("draft-status").hidden = !draft;
  if ($("draft-status").textContent !== draftText) $("draft-status").textContent = draftText;

  const silentFor = t - (app.lastTrainerDataAt ?? app.rideStartedAt);
  $("trainer-warning").hidden = silentFor < 5;
}

initSetup();

// Installable app (PWA). Service workers need https:// or localhost.
if ("serviceWorker" in navigator && globalThis.isSecureContext) {
  navigator.serviceWorker.register("/sw.js").catch((error) => console.warn("service worker:", error));
}
