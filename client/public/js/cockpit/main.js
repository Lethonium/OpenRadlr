/**
 * Composition root of the cockpit page (a paired phone): wires the watching
 * connection, the model and the tile views. No 3D code, no ride logic: it
 * shows what the tablet's ride sends. Tiles are redrawn at 4 Hz, graphs at 1 Hz.
 */
import { applyTranslations } from "../i18n/apply.js";
import { initLocale, t } from "../i18n/i18n.js";
import { defaultServerUrl } from "../net/protocol.js";
import { ProfileStore } from "../profile/profileStore.js";
import { prepareCanvas } from "../view/canvas.js";
import { ZONE_COLORS } from "../view/workoutView.js";
import { setUnits } from "../util/format.js";
import { ScreenWakeLock } from "../util/wakeLock.js";
import { CockpitConnection } from "./cockpitConnection.js";
import { CockpitModel } from "./cockpitModel.js";
import { EditMode } from "./editMode.js";
import { loadLayout } from "./layout.js";
import { RouteFollower } from "./routeFollower.js";
import { tileById } from "./tiles.js";

const COCKPIT_KEY = "openradlr.cockpit";
const RENDER_MS = 250;
const GRAPH_EVERY = 4;

const $ = (id) => document.getElementById(id);

function pairing(storage) {
  try {
    const stored = JSON.parse(storage.getItem(COCKPIT_KEY));
    return typeof stored?.key === "string" && /^[0-9a-f]{32}$/.test(stored.key) ? stored : null;
  } catch {
    return null;
  }
}

/** A route file from the server the cockpit is paired through, for the map tiles. */
async function fetchRoute(id) {
  const response = await fetch(`/api/route?id=${encodeURIComponent(id)}`);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

/** One tile's element, built once; `update` refreshes it from the model. */
function buildTile({ id, size }, editing) {
  const tile = tileById(id);
  const root = document.createElement("div");
  root.className = `tile tile-${size}`;
  const caption = document.createElement("div");
  caption.className = "tile-label";
  caption.textContent = t(tile.labelKey);
  root.append(caption);
  if (tile.draw) {
    const canvas = document.createElement("canvas");
    canvas.className = "tile-canvas";
    root.append(canvas);
    return { root, update: (model, withGraph) => {
      root.hidden = !editing && Boolean(tile.hidden?.(model));
      if (root.hidden || !withGraph) return;
      const { ctx, width, height } = prepareCanvas(canvas);
      ctx.font = "12px system-ui, sans-serif";
      tile.draw(ctx, model, width, height);
    } };
  }
  const value = document.createElement("div");
  value.className = "tile-value";
  const text = document.createElement("span");
  const unit = document.createElement("span");
  unit.className = "tile-unit";
  value.append(text, unit);
  root.append(value);
  return { root, update: (model) => {
    root.hidden = !editing && Boolean(tile.hidden?.(model));
    text.textContent = tile.value(model);
    unit.textContent = tile.unit?.() ?? "";
    const zone = tile.zone?.(model) ?? 0;
    if (zone > 0) root.style.setProperty("--zone", ZONE_COLORS[zone - 1]);
    else root.style.removeProperty("--zone");
  } };
}

function start() {
  initLocale({ storage: localStorage, languages: navigator.languages });
  applyTranslations();
  setUnits(new ProfileStore().load().units);
  const paired = pairing(localStorage);
  if (!paired) {
    $("cockpit-unpaired").hidden = false;
    return;
  }
  $("cockpit-forget").hidden = false;
  $("cockpit-forget").addEventListener("click", () => {
    localStorage.removeItem(COCKPIT_KEY);
    location.href = "index.html";
  });

  const model = new CockpitModel({ now: () => Date.now() });
  const connection = new CockpitConnection({ url: defaultServerUrl(), key: paired.key });
  const wakeLock = new ScreenWakeLock();
  let tiles = [];
  let editing = false;
  let name = paired.name;
  let frames = 0;

  connection.on("status", (status) => {
    name = status.name ?? name;
    model.onStatus(status);
  });
  const routes = new RouteFollower({ fetchRoute, onRoute: (route) => model.setRoute(route) });
  connection.on("state", (message) => {
    model.onState(message, name);
    routes.follow(model.routeId);
  });
  connection.on("display", (data) => model.onDisplay(data));
  connection.on("invalid", () => {
    $("cockpit-invalid").hidden = false;
  });

  let wasLive = false;
  const render = () => {
    const status = model.status;
    $("cockpit-waiting").textContent = name ? t("cockpit.waiting", { name }) : t("cockpit.waitingTablet");
    $("cockpit-waiting").hidden = status !== "waiting" || !$("cockpit-invalid").hidden;
    $("cockpit-tiles").hidden = status === "waiting" && !editing;
    $("cockpit-badge").hidden = status !== "stale";
    if (status !== "waiting" || editing) {
      const withGraph = frames % GRAPH_EVERY === 0;
      for (const tile of tiles) tile.update(model, withGraph);
    }
    frames += 1;
    const live = status === "live";
    if (live !== wasLive) {
      wasLive = live;
      if (live) wakeLock.acquire();
      else wakeLock.release();
    }
  };

  // Rebuilt whole on every layout change: at most a few dozen small elements.
  const show = (layout, isEditing) => {
    editing = isEditing;
    tiles = layout.map((entry) => buildTile(entry, editing));
    tiles.forEach((tile, index) => {
      if (editing) editMode.decorate(tile.root, index);
    });
    $("cockpit-tiles").replaceChildren(...tiles.map((tile) => tile.root));
    render();
  };
  const editMode = new EditMode({ root: document.body, layout: loadLayout(localStorage), storage: localStorage, onChange: show });

  connection.start();
  setInterval(render, RENDER_MS);
}

start();
