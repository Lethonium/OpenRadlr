/**
 * Dev-only plant workbench: every plant of the world kit on a turntable,
 * lit by the world's daylight and drawn through the same engine and post
 * chain. The asset list is `NATURE`; the options panel is built from each
 * asset's `meta.options`. Not loaded by the app: open `/workbench.html`,
 * optionally with `?asset=olive&season=autumn&time=dusk`.
 *
 * `globalThis.Workbench` is the scripting API of headless shots. Its labels are
 * English on purpose (`// i18n-ok`), like the gallery's were: it is a dev page.
 */
import * as THREE from "./three.js";
import { NATURE } from "./view3d/assets/nature/index.js";
import { engineFor } from "./view3d/engine/engine.js";
import { QUALITY_LEVELS, qualitySettings } from "./view3d/quality.js";
import { createWorldScene } from "./view3d/scene/worldScene.js";
import { createTracker } from "./view3d/scene/tracker.js";
import { TIME_PRESETS, environmentAt, resolvePreset } from "./world/daylight.js";
import { SEASONS } from "./world/seasons.js";
import { WORKBENCH_TIMES, workbenchState } from "./workbenchState.js";

const IDS = Object.keys(NATURE);
const GROUND = Object.freeze({ spring: "#7fae4f", summer: "#7aa24a", autumn: "#9a9a50", winter: "#e9eef2" });
const TURN_SPEED = 0.35;
const el = (id) => document.getElementById(id);
const canvas = el("canvas");
const stage = el("stage");

const tracker = createTracker();
const engine = engineFor(canvas);
const state = { ...workbenchState(location.search), options: {}, turn: true, quality: "medium", yaw: 0.8, pitch: 0.35, zoom: 1 };
const camera = new THREE.PerspectiveCamera(40, 1, 0.05, 6000);
const world = createWorldScene({ season: state.season }, { settings: qualitySettings(state.quality), track: tracker.track });
const ground = new THREE.Mesh(tracker.track(new THREE.CircleGeometry(1, 64)), tracker.track(new THREE.MeshStandardMaterial({ roughness: 1 })));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
world.scene.add(ground);
engine.renderer.info.autoReset = false;

let asset = null;
let frame = { target: new THREE.Vector3(), radius: 1 };
let environment = null;
let readyFrames = 0;

/** The asset on the bench, rebuilt from the state, and the camera fitted to it. */
function build(refit) {
  asset?.dispose();
  if (asset) world.scene.remove(asset.object);
  asset = NATURE[state.asset].create({ ...state.options, season: state.season, track: tracker.track, uniforms: world.uniforms });
  world.scene.add(asset.object);
  asset.object.updateMatrixWorld(true);
  if (refit) {
    const box = new THREE.Box3().setFromObject(asset.object);
    const size = box.getSize(new THREE.Vector3());
    frame = { target: box.getCenter(new THREE.Vector3()), radius: Math.max(size.x, size.y, size.z, 0.5) };
    ground.scale.setScalar(Math.max(frame.radius * 2.5, 4));
    state.zoom = 1;
  }
  ground.material.color.set(GROUND[state.season]);
  readyFrames = 0;
}

function lighten() {
  environment = environmentAt(resolvePreset(state.time), state.season);
  world.setEnvironment(environment);
  readyFrames = 0;
}

// ---- panels

function row(parent, label, control) {
  const wrap = document.createElement("div");
  wrap.className = "wb-row";
  const name = document.createElement("label");
  name.textContent = label;
  wrap.append(name, control);
  parent.append(wrap);
  return wrap;
}

function select(values, current, onChange) {
  const input = document.createElement("select");
  for (const value of values) input.append(new Option(value, value));
  input.value = current;
  input.addEventListener("change", () => onChange(input.value));
  return input;
}

/** One control for one `meta.options` entry: select, range, bool, colour or text. */
function optionControl(key, def, value) {
  const set = (next) => api.setOption(key, next);
  if (def.type === "select") return select(def.values, value, set);
  const input = document.createElement("input");
  if (def.type === "range") {
    Object.assign(input, { type: "range", min: def.min, max: def.max, step: def.step, value });
    input.addEventListener("change", () => set(Number(input.value)));
  } else if (def.type === "bool") {
    Object.assign(input, { type: "checkbox", checked: Boolean(value) });
    input.addEventListener("change", () => set(input.checked));
  } else {
    input.type = def.type === "color" ? "color" : "text";
    input.value = value;
    input.addEventListener("change", () => set(input.value));
  }
  return input;
}

function renderControls() {
  const box = el("controls");
  box.replaceChildren();
  row(box, "Season", select(SEASONS, state.season, (value) => api.setSeason(value))); // i18n-ok: dev page label
  row(box, "Time", select(WORKBENCH_TIMES, state.time, (value) => api.setTime(value))); // i18n-ok: dev page label
  row(box, "Quality", select(QUALITY_LEVELS, state.quality, (value) => api.setQuality(value))); // i18n-ok: dev page label
  const turn = document.createElement("button");
  turn.textContent = "Turntable"; // i18n-ok: dev page label
  turn.classList.toggle("on", state.turn);
  turn.addEventListener("click", () => {
    state.turn = !state.turn;
    turn.classList.toggle("on", state.turn);
  });
  const night = document.createElement("button");
  night.textContent = "Night"; // i18n-ok: dev page label
  night.classList.toggle("on", state.time === "night");
  night.addEventListener("click", () => api.setTime(state.time === "night" ? "day" : "night"));
  const buttons = document.createElement("div");
  buttons.className = "wb-row";
  buttons.append(turn, night);
  box.append(buttons);
}

function renderOptions() {
  const box = el("options");
  box.replaceChildren();
  const meta = NATURE[state.asset].meta;
  const description = document.createElement("p");
  description.className = "wb-desc";
  description.textContent = meta.description;
  box.append(description);
  for (const [key, def] of Object.entries(meta.options ?? {})) row(box, key, optionControl(key, def, key === "season" ? state.season : state.options[key] ?? def.default));
}

function renderList() {
  const list = el("assets");
  list.replaceChildren(
    ...IDS.map((id) => {
      const button = document.createElement("button");
      button.textContent = NATURE[id].meta.name;
      button.classList.toggle("on", id === state.asset);
      button.addEventListener("click", () => api.select(id));
      return button;
    }),
  );
}

// ---- scripting API

const api = {
  ready: false,
  select(id) {
    if (!NATURE[id]) return;
    state.asset = id;
    state.options = {};
    renderList();
    renderOptions();
    build(true);
  },
  setOption(key, value) {
    if (key === "season") return api.setSeason(value);
    state.options[key] = value;
    build(false);
  },
  setSeason(season) {
    if (!SEASONS.includes(season)) return;
    state.season = season;
    world.setSeason(season);
    lighten();
    renderControls();
    renderOptions();
    build(false);
  },
  setTime(time) {
    if (!WORKBENCH_TIMES.includes(time) || !TIME_PRESETS[time]) return;
    state.time = time;
    lighten();
    renderControls();
  },
  setQuality(level) {
    if (!QUALITY_LEVELS.includes(level)) return;
    state.quality = level;
    const settings = qualitySettings(level);
    engine.setQuality(settings);
    world.setQuality(settings);
    readyFrames = 0;
  },
};
globalThis.Workbench = api;

// ---- camera and loop

canvas.addEventListener("pointerdown", (down) => {
  canvas.setPointerCapture(down.pointerId);
  const move = (event) => {
    state.yaw -= event.movementX * 0.008;
    state.pitch = Math.min(1.45, Math.max(-0.1, state.pitch + event.movementY * 0.008));
    readyFrames = 0;
  };
  canvas.addEventListener("pointermove", move);
  canvas.addEventListener("pointerup", () => canvas.removeEventListener("pointermove", move), { once: true });
});
canvas.addEventListener("wheel", (event) => {
  event.preventDefault();
  state.zoom = Math.min(4, Math.max(0.2, state.zoom * Math.exp(event.deltaY * 0.001)));
});

function resize() {
  const { width, height } = stage.getBoundingClientRect();
  engine.resize(width, height, Math.min(globalThis.devicePixelRatio || 1, qualitySettings(state.quality).pixelRatioMax));
  camera.aspect = width / Math.max(1, height);
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(stage);

const stats = el("stats");
let last = performance.now();
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (state.turn) state.yaw += dt * TURN_SPEED;
  const distance = frame.radius * 2.4 * state.zoom + 1;
  camera.position.set(
    frame.target.x + Math.sin(state.yaw) * Math.cos(state.pitch) * distance,
    frame.target.y + Math.sin(state.pitch) * distance,
    frame.target.z + Math.cos(state.yaw) * Math.cos(state.pitch) * distance,
  );
  camera.lookAt(frame.target);
  camera.near = Math.max(0.02, distance / 200);
  camera.far = 6000;
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  world.update({ dt, t: now / 1000, camera, focus: frame.target.toArray(), shadowHalf: Math.max(6, frame.radius * 1.6) });
  engine.beginFrame();
  engine.renderer.info.reset();
  engine.renderScene(world.scene, camera);
  const { triangles, calls } = engine.renderer.info.render;
  engine.present(camera, environment, { ride: false });
  stats.textContent = `${triangles.toLocaleString()} triangles\n${calls} draw calls\n${state.asset} · ${state.season} · ${state.time}`; // i18n-ok: dev page label
  readyFrames += 1;
  api.ready = readyFrames > 2;
}

renderList();
renderControls();
lighten();
api.select(state.asset);
resize();
requestAnimationFrame(loop);
