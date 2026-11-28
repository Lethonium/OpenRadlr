/**
 * The charts of an opened ride, in the manner of a training platform's analysis:
 * the power curve (best power over a logarithmic time axis) and, for a ride with
 * its stream (ride/rideStream.js), the ride over time: power, its average, heart
 * rate and elevation. The models are pure (scales, paths, ticks); `drawCurve` and
 * `drawTimeline` turn them into SVG with the page's colours (styles.css).
 */

import { formatDuration } from "../util/format.js";

/** Durations the power curve is drawn at, from a stream: dense where efforts are short. */
export const CHART_DURATIONS = [1, 2, 3, 5, 8, 10, 15, 20, 30, 45, 60, 90, 120, 180, 240, 300, 420, 600, 900, 1200, 1800, 2400, 3600, 5400, 7200, 10800];
/** The key points a ride shows as figures under its curve (and the longest effort). */
const KEY_DURATIONS = [5, 60, 300, 1200];
/** Time axis labels of the curve, where they fit. */
const CURVE_TICKS = [1, 5, 30, 60, 300, 1200, 3600, 7200, 10800];
/** Steps of the timeline's axis, in seconds of riding. */
const TIMELINE_STEPS = [60, 120, 300, 600, 900, 1200, 1800, 3600, 5400, 7200];
const PAD = { top: 10, right: 12, bottom: 24, left: 46 };
const MIN_TICK_GAP_PX = 40;
const SVG = "http://www.w3.org/2000/svg";

const fixed = (n) => Math.round(n * 10) / 10;

/** A round number at or above `value` for an axis to end at: 354 → 400, 1180 → 1200. */
export function niceMax(value) {
  if (!(value > 0)) return 100;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const ratio = value / magnitude;
  const step = ratio < 2 ? magnitude / 5 : ratio < 5 ? magnitude / 2 : magnitude;
  return Math.ceil(value / step - 1e-9) * step;
}

/** "5 s", "20 min", "1 h", "1.5 h". */
export function durationLabel(seconds) {
  if (seconds < 60) return `${seconds} s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  const hours = seconds / 3600;
  return `${Number.isInteger(hours) ? hours : fixed(hours)} h`;
}

/** Watt ticks from 0 to the axis' end, at most five steps apart. */
function wattTicks(top, toY) {
  const step = [10, 20, 25, 50, 100, 200, 250, 500, 1000].find((s) => top / s <= 5) ?? 1000;
  const ticks = [];
  for (let w = 0; w <= top + 1e-9; w += step) ticks.push({ y: fixed(toY(w)), label: `${w} W` });
  return ticks;
}

/** Room for a right-hand axis (heart rate on the timeline). */
const RIGHT_AXIS = 46;

const plotOf = ({ width, height }, { rightAxis = false } = {}) => ({ left: PAD.left, right: width - (rightAxis ? RIGHT_AXIS : PAD.right), top: PAD.top, bottom: height - PAD.bottom });

/** The points of a path; a `null` breaks the line. */
function linePath(points) {
  let path = "";
  let pen = false;
  for (const point of points) {
    if (point === null) {
      pen = false;
      continue;
    }
    path += `${path ? " " : ""}${pen ? "L" : "M"}${fixed(point.x)} ${fixed(point.y)}`;
    pen = true;
  }
  return path;
}

/**
 * The power curve: best average power per duration, on a logarithmic time axis.
 * @param {Object<number, ?number>} curve watts by duration in seconds (nulls are left out)
 * @param {{width: number, height: number}} size
 * @returns {?{plot: object, points: {seconds: number, watts: number, x: number, y: number}[], line: string, area: string, xTicks: object[], yTicks: object[]}}
 */
export function curveModel(curve, size) {
  if (!curve) return null;
  const known = Object.keys(curve)
    .map(Number)
    .filter((seconds) => seconds > 0 && Number.isFinite(curve[seconds]))
    .sort((a, b) => a - b);
  if (known.length < 2) return null;
  const plot = plotOf(size);
  const [first, last] = [Math.log(known[0]), Math.log(known.at(-1))];
  const toX = (seconds) => plot.left + ((Math.log(seconds) - first) / (last - first)) * (plot.right - plot.left);
  const top = niceMax(Math.max(...known.map((s) => curve[s])));
  const toY = (watts) => plot.bottom - (watts / top) * (plot.bottom - plot.top);
  const points = known.map((seconds) => ({ seconds, watts: Math.round(curve[seconds]), x: fixed(toX(seconds)), y: fixed(toY(curve[seconds])) }));
  const line = linePath(points);
  const area = `${line} L${points.at(-1).x} ${plot.bottom} L${points[0].x} ${plot.bottom} Z`;
  const xTicks = [];
  for (const seconds of CURVE_TICKS) {
    if (seconds < known[0] || seconds > known.at(-1)) continue;
    const x = toX(seconds);
    if (xTicks.length && x - xTicks.at(-1).x < MIN_TICK_GAP_PX) continue;
    xTicks.push({ x: fixed(x), label: durationLabel(seconds) });
  }
  return { plot, points, line, area, xTicks, yTicks: wattTicks(top, toY) };
}

/** The figures under a curve: its key durations and its longest effort. */
export function curveKeyPoints(curve) {
  if (!curve) return [];
  const known = Object.keys(curve)
    .map(Number)
    .filter((seconds) => Number.isFinite(curve[seconds]))
    .sort((a, b) => a - b);
  const shown = new Set(KEY_DURATIONS.filter((seconds) => known.includes(seconds)));
  if (known.length) shown.add(known.at(-1));
  return [...shown].sort((a, b) => a - b).map((seconds) => ({ label: durationLabel(seconds), watts: `${Math.round(curve[seconds])} W` }));
}

/** The point whose x is nearest to `x`, or null. */
export function nearestPoint(points, x) {
  let best = null;
  for (const point of points) if (best === null || Math.abs(point.x - x) < Math.abs(best.x - x)) best = point;
  return best;
}

const mean = (values) => {
  const known = values.filter((v) => v !== null && Number.isFinite(v));
  return known.length ? known.reduce((a, b) => a + b, 0) / known.length : null;
};

/**
 * The ride over time, on riding time (a pause takes no room): power as a line with its
 * average, heart rate as a line on its own scale, elevation as an area underneath.
 * Samples are averaged into `buckets`, so a long ride stays light to draw.
 * @param {{samples: object[]}} recording a decoded stream
 * @param {{width: number, height: number, buckets?: number}} size
 */
export function timelineModel(recording, { width, height, buckets = Math.round(width / 3) }) {
  const samples = recording?.samples ?? [];
  if (samples.length < 2) return null;
  const hasHeartRate = samples.some((sample) => Number.isFinite(sample.heartRate));
  const plot = plotOf({ width, height }, { rightAxis: hasHeartRate });
  const count = Math.min(buckets, samples.length);
  const per = samples.length / count;
  const points = Array.from({ length: count }, (_, k) => {
    const from = Math.floor(k * per);
    const part = samples.slice(from, Math.max(from + 1, Math.floor((k + 1) * per)));
    return { seconds: from, power: mean(part.map((s) => s.power)), heartRate: mean(part.map((s) => s.heartRate)), elevation: mean(part.map((s) => s.elevation)) };
  });
  const span = Math.max(1, samples.length - 1);
  const toX = (seconds) => plot.left + (seconds / span) * (plot.right - plot.left);
  const powerTop = niceMax(Math.max(...points.map((p) => p.power ?? 0)) * 1.05);
  const toPowerY = (watts) => plot.bottom - (watts / powerTop) * (plot.bottom - plot.top);
  for (const point of points) {
    point.x = fixed(toX(point.seconds));
    point.power = point.power === null ? null : Math.round(point.power);
    // The readout's dot sits on the power line.
    if (point.power !== null) point.y = fixed(toPowerY(point.power));
  }
  const power = linePath(points.map((p) => (p.power === null ? null : { x: p.x, y: toPowerY(p.power) })));
  const averagePower = Math.round(mean(samples.map((s) => s.power)) ?? 0);

  const rates = points.map((p) => p.heartRate).filter((v) => v !== null);
  let heartRate = null;
  const heartTicks = [];
  if (rates.length) {
    // Its own scale, in whole tens around the ride's range, with its own axis on the right.
    const low = Math.floor((Math.min(...rates) - 5) / 10) * 10;
    const high = Math.ceil((Math.max(...rates) + 5) / 10) * 10;
    const toY = (bpm) => plot.bottom - ((bpm - low) / Math.max(1, high - low)) * (plot.bottom - plot.top);
    heartRate = linePath(points.map((p) => (p.heartRate === null ? null : { x: p.x, y: toY(p.heartRate) })));
    points.forEach((p) => (p.heartRate = p.heartRate === null ? null : Math.round(p.heartRate)));
    const step = [10, 20, 30, 40, 50].find((s) => (high - low) / s <= 4) ?? 50;
    for (let bpm = Math.ceil(low / step) * step; bpm <= high; bpm += step) heartTicks.push({ y: fixed(toY(bpm)), label: `${bpm} bpm` });
  }

  const heights = points.map((p) => p.elevation).filter((v) => v !== null);
  let elevation = null;
  if (heights.length) {
    // The road's profile fills the lower part of the chart, under the lines.
    const [low, high] = [Math.min(...heights), Math.max(...heights)];
    const band = (plot.bottom - plot.top) * 0.45;
    const toY = (metres) => plot.bottom - 4 - ((metres - low) / Math.max(1, high - low)) * band;
    const top = points.filter((p) => p.elevation !== null).map((p) => ({ x: p.x, y: toY(p.elevation) }));
    elevation = `${linePath(top)} L${top.at(-1).x} ${plot.bottom} L${top[0].x} ${plot.bottom} Z`;
    points.forEach((p) => (p.elevation = p.elevation === null ? null : Math.round(p.elevation)));
  }

  const step = TIMELINE_STEPS.find((s) => Math.ceil(samples.length / s) <= 5) ?? TIMELINE_STEPS.at(-1);
  const xTicks = [];
  for (let seconds = 0; seconds < samples.length; seconds += step) xTicks.push({ seconds, x: fixed(toX(seconds)), label: formatDuration(seconds) });

  return { plot, points, power, averagePower, averageY: fixed(toPowerY(averagePower)), heartRate, heartTicks, elevation, xTicks, yTicks: wattTicks(powerTop, toPowerY) };
}

// ---------------------------------------------------------------- drawing ---

function node(tag, attributes = {}, text = null) {
  const element = document.createElementNS(SVG, tag);
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, String(value));
  if (text !== null) element.textContent = text;
  return element;
}

function frame(svg, model, { width, height }) {
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.replaceChildren();
  const { plot } = model;
  for (const tick of model.yTicks) {
    svg.append(node("line", { class: "chart-grid", x1: plot.left, x2: plot.right, y1: tick.y, y2: tick.y }));
    svg.append(node("text", { class: "chart-axis", x: plot.left - 6, y: tick.y + 4, "text-anchor": "end" }, tick.label));
  }
  for (const tick of model.xTicks) svg.append(node("text", { class: "chart-axis", x: tick.x, y: height - 6, "text-anchor": "middle" }, tick.label));
}

/** Each chart's latest drawing, read by its one set of pointer handlers. */
const drawings = new WeakMap();

/**
 * A guide line and a readout that follow the pointer; `describe` gives the readout's text
 * of a point. The handlers are added once per chart and read its latest drawing, so a
 * redraw (finer data, a new width) neither stacks handlers nor loses a readout on show.
 */
function follow(svg, model, points, describe) {
  const guide = node("line", { class: "chart-guide", y1: model.plot.top, y2: model.plot.bottom, visibility: "hidden" });
  const dot = node("circle", { class: "chart-dot", r: 4, visibility: "hidden" });
  const label = node("text", { class: "chart-readout", y: model.plot.top + 12, visibility: "hidden" });
  svg.append(guide, dot, label);
  const previous = drawings.get(svg);
  const drawing = { model, points, describe, guide, dot, label, x: previous?.x ?? null };
  drawings.set(svg, drawing);
  if (!previous) {
    const at = (event) => {
      const box = svg.getBoundingClientRect();
      return ((event.clientX - box.left) / box.width) * svg.viewBox.baseVal.width;
    };
    const show = (event) => showAt(drawings.get(svg), at(event));
    svg.addEventListener("pointermove", show);
    svg.addEventListener("pointerdown", show);
    svg.addEventListener("pointerleave", () => hide(drawings.get(svg)));
  }
  if (drawing.x !== null) showAt(drawing, drawing.x);
}

function showAt(drawing, x) {
  const point = nearestPoint(drawing.points, x);
  if (!point) return;
  drawing.x = x;
  const { guide, dot, label, model } = drawing;
  for (const el of [guide, label]) el.setAttribute("visibility", "visible");
  guide.setAttribute("x1", point.x);
  guide.setAttribute("x2", point.x);
  dot.setAttribute("cx", point.x);
  dot.setAttribute("cy", point.y ?? model.plot.bottom);
  dot.setAttribute("visibility", point.y === undefined ? "hidden" : "visible");
  label.textContent = drawing.describe(point);
  const right = point.x > (model.plot.left + model.plot.right) / 2;
  label.setAttribute("x", right ? point.x - 8 : point.x + 8);
  label.setAttribute("text-anchor", right ? "end" : "start");
}

function hide(drawing) {
  drawing.x = null;
  for (const el of [drawing.guide, drawing.dot, drawing.label]) el.setAttribute("visibility", "hidden");
}

/** Draws the power curve into `svg`. */
export function drawCurve(svg, model, size) {
  frame(svg, model, size);
  svg.append(node("path", { class: "chart-area-power", d: model.area }));
  svg.append(node("path", { class: "chart-line-power", d: model.line }));
  follow(svg, model, model.points, (p) => `${durationLabel(p.seconds)} · ${p.watts} W`);
}

/**
 * Draws the ride over time into `svg`; `texts.heartRate` and `texts.elevation` name the
 * units of the readout (bpm, m or ft are given by the caller).
 */
export function drawTimeline(svg, model, size, { elevationText = (m) => `${m} m`, averageText = (w) => `Ø ${w} W` } = {}) {
  frame(svg, model, size);
  if (model.elevation) svg.append(node("path", { class: "chart-area-elevation", d: model.elevation }));
  svg.append(node("line", { class: "chart-average", x1: model.plot.left, x2: model.plot.right, y1: model.averageY, y2: model.averageY }));
  svg.append(node("text", { class: "chart-average-label", x: model.plot.right, y: model.averageY - 4, "text-anchor": "end" }, averageText(model.averagePower)));
  svg.append(node("path", { class: "chart-line-power", d: model.power }));
  if (model.heartRate) svg.append(node("path", { class: "chart-line-heart", d: model.heartRate }));
  for (const tick of model.heartTicks) svg.append(node("text", { class: "chart-axis chart-axis-heart", x: model.plot.right + 6, y: tick.y + 4, "text-anchor": "start" }, tick.label));
  follow(svg, model, model.points, (p) =>
    [formatDuration(p.seconds), p.power === null ? null : `${p.power} W`, p.heartRate === null ? null : `${p.heartRate} bpm`, p.elevation === null ? null : elevationText(p.elevation)]
      .filter(Boolean)
      .join(" · "),
  );
}
