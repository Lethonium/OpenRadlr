/**
 * Ghost lap: my best lap on a loop route, recorded in the browser and ridden
 * again by a see-through rider, with the live gap to it. Pure logic over my
 * rider's position and the ride clock (pauses excluded); storage is injected.
 * See docs/superpowers/specs/2026-11-10-ghost-lap-design.md.
 */
import { START_LINE_M } from "./splits.js";
import { formatDuration, formatNumber } from "../util/format.js";

export const GHOST = Object.freeze({
  /** One trace point about every this many seconds. */
  everyS: 1,
  /** A move further than this (metres) between two updates, or backwards, ends the lap: a jump, not riding. */
  maxStepM: 60,
  maxBackM: 2,
});

const PREFIX = "ghost:";
const STRIDE = 3;

/**
 * Where the lap's rider was `elapsedS` seconds after the line, or null before
 * the start or after the finish. Lane and speed between the points too.
 * @param {{points: number[]}} trace flat `[t, routeM, lane, …]`
 * @returns {{routeM: number, lane: number, speed: number} | null}
 */
export function ghostAt(trace, elapsedS) {
  const p = trace.points;
  const last = p.length - STRIDE;
  if (!(elapsedS >= 0) || last < 0 || elapsedS > p[last]) return null;
  let i = 0;
  while (i < last && p[i + STRIDE] < elapsedS) i += STRIDE;
  if (i === last) return { routeM: p[i + 1], lane: p[i + 2], speed: 0 };
  const dt = p[i + STRIDE] - p[i];
  const f = dt > 0 ? (elapsedS - p[i]) / dt : 1;
  const metres = p[i + STRIDE + 1] - p[i + 1];
  return { routeM: p[i + 1] + f * metres, lane: p[i + 2] + f * (p[i + STRIDE + 2] - p[i + 2]), speed: dt > 0 ? metres / dt : 0 };
}

/** Seconds after the line at which the lap reached `routeM`, or null past its end. */
export function timeAt(trace, routeM) {
  const p = trace.points;
  const last = p.length - STRIDE;
  if (last < 0 || routeM > p[last + 1]) return null;
  if (routeM <= p[1]) return p[0];
  let i = 0;
  while (i < last && p[i + STRIDE + 1] < routeM) i += STRIDE;
  const dm = p[i + STRIDE + 1] - p[i + 1];
  const f = dm > 0 ? (routeM - p[i + 1]) / dm : 1;
  return p[i] + f * (p[i + STRIDE] - p[i]);
}

/** My gap to the ghost for the HUD: "+4.2 s" behind, "−4.2 s" ahead, minutes from a minute on ("+1:05"). */
export function formatLapGap(gapS) {
  const sign = gapS >= 0.05 ? "+" : gapS <= -0.05 ? "−" : "±";
  const size = Math.abs(gapS);
  return `${sign}${size >= 60 ? formatDuration(size) : `${formatNumber(size, 1)} s`}`;
}

const round = (value, digits) => Math.round(value * 10 ** digits) / 10 ** digits;

/** Laps of my rider on one loop route: a lap runs from one crossing of the line to the next. */
export class LapRun {
  #lastM = null;
  #lastS = null;
  /** The lap being ridden: when it crossed the line (clock s) and its trace points. */
  #lap = null;

  /** @param {{id: string, length: number, loop: boolean, signedGap: Function}} route */
  constructor(route) {
    this.route = route;
  }

  /** True while a lap is being ridden; `startedAtS` is when it crossed the line. */
  get riding() {
    return this.#lap !== null;
  }

  get startedAtS() {
    return this.#lap?.startS ?? null;
  }

  /**
   * My rider's position at clock `clockS` (seconds, pauses excluded).
   * @returns {({type: "start", clockS: number} | {type: "lap", routeId: string, durationS: number, trace: {points: number[]}})[]}
   */
  update({ routeId, routeM, lane, clockS }) {
    const route = this.route;
    if (!route.loop || routeId !== route.id || !Number.isFinite(routeM)) {
      this.#lastM = null;
      this.#lap = null;
      return [];
    }
    const lastM = this.#lastM;
    const lastS = this.#lastS;
    this.#lastM = routeM;
    this.#lastS = clockS;
    if (lastM === null) {
      // A ride that begins at the line starts its first lap there.
      if (routeM > START_LINE_M) return [];
      this.#start(clockS, routeM, lane);
      return [{ type: "start", clockS }];
    }
    const step = route.signedGap(lastM, routeM);
    if (step > GHOST.maxStepM || step < -GHOST.maxBackM) {
      this.#lap = null;
      return [];
    }
    if (!(step > 0 && routeM < lastM)) {
      this.#record(clockS, routeM, lane);
      return [];
    }

    // Over the line, somewhere in this step: when, by the share of the step before it.
    const share = step > 0 ? (route.length - lastM) / step : 1;
    const crossedS = lastS + share * (clockS - lastS);
    const events = [];
    if (this.#lap) {
      const { startS, points } = this.#lap;
      const durationS = crossedS - startS;
      points.push(round(durationS, 2), round(route.length, 1), round(lane, 2));
      events.push({ type: "lap", routeId: route.id, durationS, trace: { points } });
    }
    this.#start(crossedS, 0, lane);
    this.#record(clockS, routeM, lane);
    events.push({ type: "start", clockS: crossedS });
    return events;
  }

  #start(clockS, routeM, lane) {
    this.#lap = { startS: clockS, points: [0, round(routeM, 1), round(lane, 2)] };
  }

  #record(clockS, routeM, lane) {
    if (!this.#lap) return;
    const points = this.#lap.points;
    const t = clockS - this.#lap.startS;
    if (t - points[points.length - STRIDE] < GHOST.everyS) return;
    points.push(round(t, 2), round(routeM, 1), round(lane, 2));
  }
}

/** The best lap per route, kept in the browser (IndexedDB, injected like the ride history). */
export class GhostStore {
  #reported = false;

  /** @param {{store: {get: Function, put: Function, keys: Function}, now?: () => number, log?: (...args: any[]) => void}} options */
  constructor({ store, now = () => Date.now(), log = console.warn }) {
    this.store = store;
    this.now = now;
    this.log = log;
  }

  async #safely(act, fallback) {
    try {
      return await act();
    } catch (error) {
      if (!this.#reported) {
        this.#reported = true;
        this.log("Ghost laps unavailable:", error); // i18n-ok
      }
      return fallback;
    }
  }

  /** The best lap on `routeId`: `{routeId, durationS, recordedAt, trace}`, or null. */
  best(routeId) {
    return this.#safely(async () => (await this.store.get(PREFIX + routeId)) ?? null, null);
  }

  /** The best lap of every route, without traces, by route id. */
  all() {
    return this.#safely(async () => {
      const keys = (await this.store.keys()).filter((key) => key.startsWith(PREFIX)).sort();
      const laps = (await Promise.all(keys.map((key) => this.store.get(key)))).filter(Boolean);
      return laps.map(({ routeId, durationS, recordedAt }) => ({ routeId, durationS, recordedAt }));
    }, []);
  }

  /**
   * Keeps `lap` if it is the first or the fastest on its route.
   * @returns {Promise<{best: boolean, previousS: ?number}>}
   */
  offer(lap) {
    return this.#safely(
      async () => {
        const previous = (await this.store.get(PREFIX + lap.routeId)) ?? null;
        const previousS = previous?.durationS ?? null;
        if (previous && previous.durationS <= lap.durationS) return { best: false, previousS };
        await this.store.put(PREFIX + lap.routeId, { version: 1, routeId: lap.routeId, durationS: lap.durationS, recordedAt: this.now(), trace: lap.trace });
        return { best: true, previousS };
      },
      { best: false, previousS: null },
    );
  }
}
