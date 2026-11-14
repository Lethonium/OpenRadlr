/**
 * The cockpit's tile catalogue: pure descriptions, no DOM.
 *
 * `{ id, labelKey, sizes, value?(model, format), unit?(), zone?(model), draw?(ctx, model, w, h),
 * hidden?(model) }`. A number tile has `value` (a string, "–" without data); a
 * graph tile has `draw`. The first size is the one a newly added tile gets.
 * Values follow the units set with `setUnits` from the stored profile.
 */
import { distanceUnit, formatDistance, formatDuration, formatElevation, formatGrade, formatNumber, formatSpeed, speedUnit } from "../util/format.js";
import { powerZone } from "../view/hud.js";
import { paintMinimap } from "../view/minimapView.js";
import { paintProfile } from "../view/profileView.js";
import { ZONE_COLORS } from "../view/workoutView.js";

const NONE = "–";
const ACCENT = "#ff7a1a";
const MUTED = "#8a94a3";
const GRID = "#2a313b";
const TEXT = "#e8ecf1";
const HR_COLOR = "#ff5d5d";
const SPEED_COLOR = "#4fc3f7";
/** The main app's map colours (styles.css), for the minimap and profile views. */
const MAP_COLORS = Object.freeze({
  text: TEXT,
  muted: MUTED,
  road: "#3a434f",
  terrain: "#24402f",
  terrainEdge: "#5fb47c",
  me: ACCENT,
  human: "#4cc3ff",
  bot: "#8f99a8",
  remote: "#2ec4a6",
  climb: "rgba(255, 93, 93, 0.12)",
  sprint: "rgba(76, 195, 255, 0.12)",
});

const FORMAT = { speed: formatSpeed, distance: formatDistance, duration: formatDuration, grade: formatGrade, number: formatNumber, elevation: formatElevation };

const known = (value) => Number.isFinite(value);
const whole = (value) => (known(value) ? String(Math.round(value)) : NONE);
const label = (id) => `cockpit.tile.${id}`;

/** A number tile reading one model field through a formatter. */
const number = (id, sizes, read, { unit, zone, hidden } = {}) => ({
  id,
  labelKey: label(id),
  sizes,
  value: (model, format = FORMAT) => read(model, format),
  ...(unit && { unit }),
  ...(zone && { zone }),
  ...(hidden && { hidden }),
});

const graph = (id, sizes, draw, hidden) => ({ id, labelKey: label(id), sizes, draw, ...(hidden && { hidden }) });

/** A text tile: a sentence in the tile, not a big number (styled `.tile-text`). */
const textTile = (id, sizes, read, hidden) => ({
  id,
  labelKey: label(id),
  sizes,
  text: true,
  value: (model) => read(model),
  unit: () => "",
  ...(hidden && { hidden }),
});

const stat = (model, field) => model.stats?.[field];

/** Draws a series (oldest first) as a line over the full width; 0 and non-numbers are gaps. */
function drawSeries(ctx, series, w, h, { color, max, floor = 0 }) {
  const values = series.slice(-w);
  if (values.length < 2) return;
  const top = max ?? Math.max(1, ...values);
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  let pen = false;
  values.forEach((value, index) => {
    const x = (index / (values.length - 1)) * w;
    if (!(value > floor)) {
      pen = false;
      return;
    }
    const y = h - (Math.min(value, top) / top) * (h - 4) - 2;
    if (pen) ctx.lineTo(x, y);
    else ctx.moveTo(x, y);
    pen = true;
  });
  ctx.stroke();
}

function drawPowerGraph(ctx, model, w, h) {
  const series = model.history.power;
  const max = Math.max(model.ftp ? model.ftp * 1.6 : 0, ...series, 100);
  if (model.ftp) {
    const y = h - (model.ftp / max) * (h - 4) - 2;
    ctx.strokeStyle = GRID;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
  drawSeries(ctx, series, w, h, { color: ACCENT, max, floor: -1 });
}

function drawHrGraph(ctx, model, w, h) {
  const series = model.history.hr;
  const shown = series.filter((v) => v > 0);
  const low = shown.length ? Math.min(...shown) - 10 : 0;
  drawSeries(ctx, series.map((v) => (v > 0 ? v - low : 0)), w, h, { color: HR_COLOR, max: Math.max(1, (shown.length ? Math.max(...shown) : 0) - low + 10) });
}

/** Speed over time, standing still at the bottom; scaled to the fastest moment, at least 10 m/s. */
function drawSpeedGraph(ctx, model, w, h) {
  const series = model.history.speed;
  drawSeries(ctx, series, w, h, { color: SPEED_COLOR, max: Math.max(10, ...series), floor: -1 });
}

/** The map tiles show while the rider rides the loaded route; studio and own roads have none. */
const offRoute = (model) => !model.route || model.routeId !== model.route.id;
const onRouteView = (model) => ({ route: model.route, riders: [model.rider], myId: model.rider.id, colors: MAP_COLORS });

function drawMinimap(ctx, model, w, h) {
  if (!offRoute(model)) paintMinimap(ctx, w, h, onRouteView(model));
}

function drawProfile(ctx, model, w, h) {
  if (!offRoute(model)) paintProfile(ctx, w, h, onRouteView(model));
}

/** Time in each power zone as six bars, tallest = most time. */
function drawZones(ctx, model, w, h) {
  const zones = model.zonesS ?? [];
  const peak = Math.max(1, ...zones);
  const gap = 6;
  const barW = (w - gap * 5) / 6;
  zones.forEach((seconds, index) => {
    const barH = Math.max(2, (seconds / peak) * (h - 16));
    ctx.fillStyle = ZONE_COLORS[index];
    ctx.fillRect(index * (barW + gap), h - 14 - barH, barW, barH);
    ctx.fillStyle = MUTED;
    ctx.fillText(`Z${index + 1}`, index * (barW + gap), h - 2);
  });
}

/** The workout's steps as bars (height = target), the current step lit, with a progress mark. */
function drawWorkout(ctx, model, w, h) {
  const steps = model.plan?.steps ?? [];
  const total = steps.reduce((sum, s) => sum + s.s, 0);
  if (total === 0) return;
  const peak = Math.max(1, ...steps.map((s) => Math.max(s.from_w, s.to_w)));
  const current = model.workout?.step;
  let x = 0;
  steps.forEach((step, index) => {
    const stepW = Math.max(1, (step.s / total) * w);
    const mean = (step.from_w + step.to_w) / 2;
    const barH = (mean / peak) * (h - 6);
    ctx.fillStyle = index === current ? ACCENT : GRID;
    ctx.fillRect(x, h - barH, stepW - 1, barH);
    if (index === current) {
      const progress = Math.min(1, (model.workout.step_elapsed_s ?? 0) / step.s);
      ctx.fillStyle = TEXT;
      ctx.fillRect(x + progress * stepW, 0, 2, h);
    }
    x += stepW;
  });
}

const effortLabel = (s) => (s < 60 ? `${s} s` : `${s / 60} min`); // i18n-ok

function drawEfforts(ctx, model, w, h) {
  const efforts = model.stats?.efforts ?? [];
  const column = w / 4;
  efforts.slice(0, 4).forEach((effort, index) => {
    ctx.fillStyle = MUTED;
    ctx.fillText(effortLabel(effort.s), index * column, 14);
    ctx.fillStyle = TEXT;
    ctx.fillText(`${Math.round(effort.w)} W`, index * column, Math.min(h - 4, 36));
  });
}

function drawRaceGaps(ctx, model, w, h) {
  const results = model.race?.results ?? [];
  results.slice(0, 5).forEach((result, index) => {
    const y = 16 + index * 18;
    if (y > h) return;
    ctx.fillStyle = TEXT;
    ctx.fillText(`${index + 1}. ${result.name}`, 0, y);
    ctx.fillStyle = MUTED;
    ctx.fillText(formatDuration(result.time_s), w - 48, y);
  });
}

const inRace = (model) => model.race?.phase === "running" && known(model.lap);

export const TILES = Object.freeze([
  number("power3s", ["big", "half", "wide"], (m) => whole(m.power3s), { unit: () => "W", zone: (m) => powerZone(m.power3s, m.ftp) }),
  number("heartRate", ["big", "half", "wide"], (m) => whole(m.hr), { unit: () => "bpm", hidden: (m) => !known(m.hr) }),
  number("cadence", ["half", "wide"], (m) => whole(m.cadence), { unit: () => "rpm" }),
  number("speed", ["half", "wide"], (m, f) => (known(m.speed) ? f.speed(m.speed) : NONE), { unit: speedUnit }),
  number("grade", ["half", "wide"], (m, f) => (known(m.grade) ? f.grade(m.grade) : NONE), { unit: () => "%" }),
  number("elapsed", ["half", "wide"], (m, f) => (known(stat(m, "elapsedS")) ? f.duration(stat(m, "elapsedS")) : NONE)),
  graph("workout", ["wide", "big"], drawWorkout, (m) => !m.workout),
  graph("zones", ["wide", "big"], drawZones),
  number("avgPower", ["half", "wide"], (m) => whole(stat(m, "avgPower")), { unit: () => "W" }),
  number("np", ["half", "wide"], (m) => whole(stat(m, "weightedPower")), { unit: () => "W" }),
  number("kj", ["half", "wide"], (m) => whole(stat(m, "kJ")), { unit: () => "kJ" }),
  number("distance", ["half", "wide"], (m, f) => (known(stat(m, "distanceM")) ? f.distance(stat(m, "distanceM")) : NONE), { unit: distanceUnit }),
  graph("efforts", ["wide", "big"], drawEfforts),
  number("load", ["half", "wide"], (m) => whole(stat(m, "load"))),
  number("climbed", ["half", "wide"], (m, f) => (known(stat(m, "climbedM")) ? f.elevation(stat(m, "climbedM")) : NONE)),
  number("avgHeartRate", ["half", "wide"], (m) => whole(stat(m, "avgHeartRate")), { unit: () => "bpm" }),
  graph("powerGraph", ["wide", "big"], drawPowerGraph),
  graph("hrGraph", ["wide", "big"], drawHrGraph),
  graph("speedGraph", ["wide", "big"], drawSpeedGraph),
  graph("minimap", ["big", "wide"], drawMinimap, offRoute),
  graph("profile", ["wide", "big"], drawProfile, offRoute),
  number("laps", ["half", "wide"], (m) => (inRace(m) ? `${m.lap} / ${m.race.laps}` : NONE), { hidden: (m) => !inRace(m) }),
  graph("raceGaps", ["wide", "big"], drawRaceGaps, (m) => !(m.race?.results?.length > 0)),
  textTile("goals", ["wide", "big"], (m) => m.goals ?? NONE, (m) => !m.goals),
]);

/** What a new cockpit shows, top to bottom. */
export const DEFAULT_LAYOUT = Object.freeze(
  [
    ["power3s", "big"],
    ["heartRate", "big"],
    ["cadence", "half"],
    ["speed", "half"],
    ["grade", "half"],
    ["elapsed", "half"],
    ["workout", "wide"],
    ["powerGraph", "wide"],
    ["minimap", "big"],
    ["zones", "wide"],
    ["avgPower", "half"],
    ["np", "half"],
    ["kj", "half"],
    ["distance", "half"],
  ].map(([id, size]) => Object.freeze({ id, size })),
);

const BY_ID = new Map(TILES.map((tile) => [tile.id, tile]));

export const tileById = (id) => BY_ID.get(id);
