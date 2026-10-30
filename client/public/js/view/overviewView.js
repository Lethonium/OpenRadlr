// The menu's Overview page: live ride figures, a power chart of the last 10
// minutes and, on a phone, the stat strip at the top of the dialog. It
// refreshes once a second, only while shown. The finish summary draws the same
// chart over the whole ride with `drawPowerChart`.
import { t } from "../i18n/i18n.js";
import { liveStats, powerWindow } from "../ride/liveStats.js";
import { prepareCanvas, themeColors } from "./canvas.js";
import { ZONE_COLORS } from "./workoutView.js";

export const OVERVIEW_REFRESH_MS = 1000;
/** The live chart's span, seconds. */
const LIVE_WINDOW_S = 600;
/** Upper edges of zones 1–5 as a fraction of FTP (see ride/workout.js zoneFor). */
const ZONE_EDGES = [0.56, 0.76, 0.91, 1.06, 1.21];
/** A gap longer than this (a pause) breaks the power line. */
const GAP_S = 5;
const EFFORT_KEYS = { 5: "overview.effort.5s", 60: "overview.effort.1min", 300: "overview.effort.5min", 1200: "overview.effort.20min" };
const DASH = "–";

/**
 * What should run: "page" on the Overview page, "strip" on a phone's other
 * menu screens (the strip stays live there), null otherwise.
 */
export function overviewMode({ open, page, narrow }) {
  if (!open) return null;
  if (page === "overview") return "page";
  return narrow ? "strip" : null;
}

/**
 * Power, speed and grade for the strip. The studio's route has no geometry
 * (`gradeAt`), so its grade is 0.
 */
export function liveReading({ me, route, power }) {
  return {
    power: Number.isFinite(power) ? power : 0,
    speed: me?.speed ?? 0,
    grade: me && typeof route?.gradeAt === "function" ? route.gradeAt(me.distance) : 0,
  };
}

/**
 * The figures as [label, value] rows; dashes until something is recorded.
 * @returns {{stats: string[][], efforts: string[][]}}
 */
export function overviewFigures({ summary, samples, pauses, ftp }, format) {
  const empty = samples.length === 0;
  const s = liveStats({ summary, samples, pauses, ftp });
  const value = (fn) => (empty ? DASH : fn());
  const stats = [
    [t("finish.time"), value(() => format.duration(s.elapsedS))],
    [t("finish.distance"), value(() => format.distance(s.distanceM))],
    [t("finish.climbed"), value(() => format.elevation(s.climbedM))],
    [t("finish.avgPower"), value(() => format.power(s.avgPower))],
    // Weighted power needs 30 s of riding; liveStats reports 0 before that.
    [t("overview.weightedPower"), s.weightedPower > 0 ? format.power(Math.round(s.weightedPower)) : DASH],
    [t("finish.work"), value(() => `${format.number(s.kJ, 0)} kJ`)], // i18n-ok: unit
  ];
  if (s.avgHeartRate) stats.push([t("finish.avgHeartRate"), `${format.number(s.avgHeartRate, 0)} bpm`]); // i18n-ok: unit
  if (s.load !== null && !empty) stats.push([t("overview.load"), format.number(s.load, 0)]);
  const best = new Map(s.efforts.map(({ s: seconds, w }) => [seconds, w]));
  const efforts = Object.entries(EFFORT_KEYS).map(([seconds, key]) => {
    const w = best.get(Number(seconds));
    return [t(key), w === undefined ? DASH : format.power(Math.round(w))];
  });
  return { stats, efforts };
}

function figureList(doc, rows) {
  const list = doc.createElement("dl");
  list.className = "summary overview-figures";
  list.append(...rows.map(([label, value]) => {
    const item = doc.createElement("div");
    const dt = doc.createElement("dt");
    dt.textContent = label;
    const dd = doc.createElement("dd");
    dd.textContent = value;
    item.append(dt, dd);
    return item;
  }));
  return list;
}

/**
 * Draws power over time with zone bands and the FTP line, newest at the
 * right: the last `windowS` seconds (at least a minute), or the whole ride
 * for `windowS` null (the finish summary).
 */
export function drawPowerChart(canvas, { samples, ftp, colors, windowS = LIVE_WINDOW_S }) {
  const { ctx, width, height } = prepareCanvas(canvas);
  const whole = windowS === null;
  const points = powerWindow(samples, { windowS: whole ? Infinity : windowS });
  // The span grows with the ride up to the window, so a young ride fills the width.
  const spanS = Math.min(whole ? Infinity : windowS, Math.max(60, points[0]?.t ?? 0));
  const hasFtp = ftp > 0;
  const top = Math.max(hasFtp ? ftp * 1.5 : 0, 100, ...points.map((p) => p.w * 1.1));
  const pad = 4;
  const y = (w) => height - pad - (w / top) * (height - 2 * pad);
  const x = (secondsAgo) => width - (secondsAgo / spanS) * width;

  if (hasFtp) {
    let from = 0;
    [...ZONE_EDGES, Infinity].forEach((edge, index) => {
      const to = Math.min(edge * ftp, top);
      ctx.fillStyle = ZONE_COLORS[index];
      ctx.globalAlpha = 0.18;
      ctx.fillRect(0, y(to), width, y(from) - y(to));
      from = to;
    });
    ctx.globalAlpha = 1;
    ctx.strokeStyle = colors.muted;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(0, y(ftp));
    ctx.lineTo(width, y(ftp));
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = "10px system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.fillStyle = colors.muted;
    ctx.fillText(t("overview.ftpLine", { watts: Math.round(ftp) }), 6, y(ftp) - 4);
  }

  if (points.length === 0) return;
  ctx.beginPath();
  points.forEach((p, index) => {
    const gap = index > 0 && points[index - 1].t - p.t > GAP_S;
    if (index === 0 || gap) ctx.moveTo(x(p.t), y(p.w));
    else ctx.lineTo(x(p.t), y(p.w));
  });
  ctx.strokeStyle = colors.text;
  ctx.lineWidth = 1.5;
  ctx.lineJoin = "round";
  ctx.stroke();
}

/**
 * @param {{root: object, canvas: object, strip: object, read: () => object,
 *   setInterval: Function, clearInterval: Function, format: object,
 *   doc?: Document, colors?: () => object}} deps
 *   `read()` returns `{summary, samples, pauses, ftp, live: {power, speed, grade}}`.
 */
export function createOverviewView({
  root, canvas, strip, read, setInterval, clearInterval, format,
  doc = globalThis.document, colors = () => themeColors(),
}) {
  let timer = null;
  /** Whether the figures and chart render too, not just the strip. */
  let full = true;

  function render() {
    const recording = read();
    if (full) {
      const { stats, efforts } = overviewFigures(recording, format);
      const heading = doc.createElement("h3");
      heading.textContent = t("overview.bestEfforts");
      root.replaceChildren(figureList(doc, stats), heading, figureList(doc, efforts));
      drawPowerChart(canvas, { samples: recording.samples, ftp: recording.ftp, colors: colors() });
    }
    const { power, speed, grade } = recording.live;
    strip.replaceChildren(...[
      Number.isFinite(power) ? format.power(Math.round(power)) : DASH,
      Number.isFinite(speed) ? format.speed(speed) : DASH,
      Number.isFinite(grade) ? format.grade(grade) : DASH,
    ].map((text) => {
      const item = doc.createElement("span");
      item.className = "menu-strip-item";
      item.textContent = text;
      return item;
    }));
  }

  function hide() {
    if (timer === null) return;
    clearInterval(timer);
    timer = null;
  }

  function start(withPage) {
    full = withPage;
    render();
    if (timer === null) timer = setInterval(render, OVERVIEW_REFRESH_MS);
  }

  return {
    /** The whole page: figures, chart and strip, now and once a second. */
    show: () => start(true),
    /** Only the strip (a phone's other menu screens). */
    showStrip: () => start(false),
    hide,
    dispose: hide,
  };
}
