/**
 * Ride HUD logic: which layout to show and the numbers the layouts need.
 * Everything here is pure (no DOM, no clock) so it can be unit-tested; the
 * only DOM helper, `MetricBinder`, takes its root element as a parameter.
 *
 * Layouts (see docs/architecture.md, "Ride screen"):
 * - cockpit   — free ride, minimal: power gauge in the centre
 * - broadcast — everything at a glance, TV style
 * - training  — workout chart and targets
 * - race      — position, gaps and race timeline
 */
import { zoneFor } from "../ride/workout.js";
import { formatDistanceWithUnit, formatDuration, formatSpeed, speedUnit } from "../util/format.js";

export const LAYOUTS = Object.freeze(["cockpit", "broadcast", "training", "race"]);
export const LAYOUT_CHOICES = Object.freeze(["auto", ...LAYOUTS]);
export const LAYOUT_LABELS = Object.freeze({
  auto: "Auto",
  cockpit: "Cockpit",
  broadcast: "Broadcast",
  training: "Training",
  race: "Race",
});

/**
 * The layout to show. A fixed choice always wins; "auto" follows the ride:
 * a race I take part in (entered during the countdown, or racing) beats a
 * running workout, which beats free riding. Races are opt-in, so a race
 * others started never takes over my screen.
 */
export function chooseLayout({ choice = "auto", workoutRunning = false, racePhase = null, inRace = false } = {}) {
  if (LAYOUTS.includes(choice)) return choice;
  if ((racePhase === "countdown" || racePhase === "running") && inRace) return "race";
  if (workoutRunning) return "training";
  return "cockpit";
}

/** Next entry of LAYOUT_CHOICES, wrapping around (unknown values restart at "auto"). */
export function nextLayoutChoice(choice) {
  const index = LAYOUT_CHOICES.indexOf(choice);
  return LAYOUT_CHOICES[(index + 1) % LAYOUT_CHOICES.length];
}

/** Power zone 1–6 relative to FTP (0 when FTP is unknown). */
export function powerZone(watts, ftp) {
  if (!(ftp > 0) || !Number.isFinite(watts)) return 0;
  return zoneFor(watts / ftp);
}

/** How full the power gauge is: 0 … 1, where 1 is 160 % of FTP. */
export function gaugeFraction(watts, ftp) {
  if (!(ftp > 0) || !Number.isFinite(watts)) return 0;
  return Math.min(1, Math.max(0, watts / (ftp * 1.6)));
}

const MARKER_LABELS = { climb: "KOM", sprint: "Sprint", start_finish: "Finish line" };

/**
 * The next climb, sprint or start/finish line ahead of `distance` on the loop,
 * within `lookahead` metres. If I'm inside a climb or sprint, that one is
 * reported with `inside: true` and the metres left to its end.
 * @returns {{type: string, label: string, inM: number, inside: boolean} | null}
 */
export function nextMarker(route, distance, lookahead = Infinity) {
  let best = null;
  for (const marker of route.markers) {
    const base = MARKER_LABELS[marker.type];
    if (!base) continue;
    const label = typeof marker.name === "string" && marker.name ? `${base} · ${marker.name}` : base;
    const ahead = route.wrap(marker.distance - distance);
    const length = marker.length ?? 0;
    // Inside a segment: the start lies behind me but the end is still ahead.
    const sinceStart = route.wrap(distance - marker.distance);
    if (length > 0 && sinceStart < length) {
      return { type: marker.type, label, inM: length - sinceStart, inside: true };
    }
    if (ahead <= lookahead && (!best || ahead < best.inM)) {
      best = { type: marker.type, label, inM: ahead, inside: false };
    }
  }
  return best;
}

/** Race progress in metres: completed laps plus the position on the current one. */
export function raceProgress(rider, routeLength) {
  return (Math.max(1, rider.lap) - 1) * routeLength + rider.distance;
}

/**
 * Everything the race layout shows, or null if I'm not racing.
 * Finished riders (in `race.results`) rank ahead of everyone still riding.
 * Groups: riders closer than `groupGapM` to the one in front ride together.
 * Time gaps divide the distance by my speed (at least `minSpeed` m/s).
 */
export function raceStanding(race, riders, myId, routeLength, { groupGapM = 15, minSpeed = 5, around = 2 } = {}) {
  if (!race || (race.phase !== "running" && race.phase !== "countdown")) return null;
  const me = riders.find((rider) => rider.id === myId);
  if (!me || me.lap === null || me.lap === undefined) return null;

  const finished = race.results?.length ?? 0;
  const racing = riders
    .filter((rider) => rider.lap !== null && rider.lap !== undefined)
    .map((rider) => ({ rider, progress: raceProgress(rider, routeLength) }))
    .sort((a, b) => b.progress - a.progress);
  const myIndex = racing.findIndex((entry) => entry.rider.id === myId);
  const myProgress = racing[myIndex].progress;
  const speed = Math.max(minSpeed, me.speed ?? 0);
  const seconds = (metres) => metres / speed;
  const totalM = race.laps * routeLength;

  const groups = [];
  racing.forEach((entry, index) => {
    const startsGroup = index === 0 || racing[index - 1].progress - entry.progress > groupGapM;
    if (startsGroup) groups.push({ members: [], leadProgress: entry.progress });
    groups[groups.length - 1].members.push(entry);
  });
  const myGroup = groups.findIndex((group) => group.members.some((entry) => entry.rider.id === myId));

  return {
    position: finished + myIndex + 1,
    total: finished + racing.length,
    lap: Math.min(race.laps, Math.max(1, me.lap)),
    laps: race.laps,
    fraction: Math.min(1, Math.max(0, myProgress / totalM)),
    toGoM: Math.max(0, totalM - myProgress),
    others: racing.filter((entry) => entry.rider.id !== myId).map((entry) => ({ rider: entry.rider, fraction: Math.min(1, entry.progress / totalM) })),
    groups: groups.map((group, index) => ({
      label: index === myGroup ? "Your group" : index === 0 ? "Leaders" : index < myGroup ? "Chase" : "Behind",
      size: group.members.length,
      mine: index === myGroup,
      gapS: index === myGroup ? 0 : seconds(group.leadProgress - groups[myGroup].leadProgress),
    })),
    around: racing.slice(Math.max(0, myIndex - around), myIndex + around + 1).map((entry) => ({
      rider: entry.rider,
      position: finished + racing.indexOf(entry) + 1,
      gapS: seconds(entry.progress - myProgress),
      mine: entry.rider.id === myId,
    })),
  };
}

/** "+0:14", "−1.2 s", "—" for a time gap in seconds (positive = ahead of me). */
export function formatTimeGap(seconds, { mine = false } = {}) {
  if (mine) return "—";
  const sign = seconds >= 0 ? "+" : "−";
  const abs = Math.abs(seconds);
  if (abs < 10) return `${sign}${abs.toFixed(1)} s`;
  const whole = Math.round(abs);
  return `${sign}${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/** Ordinal-free position text: "4/18". */
export const formatPosition = (position, total) => `${position}/${total}`;

/**
 * Writes values into every element marked `data-m="<name>"` below `root`.
 * Each layout has its own copy of a metric, so one `set` updates them all;
 * unchanged values are skipped to keep the DOM quiet at 60 fps.
 */
export class MetricBinder {
  #elements = new Map();
  #values = new Map();

  /** @param {{querySelectorAll: (selector: string) => Iterable<{dataset: object, textContent: string}>}} root */
  constructor(root) {
    for (const element of root.querySelectorAll("[data-m]")) {
      const name = element.dataset.m;
      if (!this.#elements.has(name)) this.#elements.set(name, []);
      this.#elements.get(name).push(element);
    }
  }

  set(name, value) {
    const text = String(value);
    if (this.#values.get(name) === text) return;
    this.#values.set(name, text);
    for (const element of this.#elements.get(name) ?? []) element.textContent = text;
  }

  get names() {
    return [...this.#elements.keys()];
  }
}

/** "Lap 3", "Km 10" / "Mi 5" (the kilometre or mile it ended at) or "6.2 km" for a free or partial split. */
export function splitLabel(split, unitM = 1000) {
  if (split.kind === "lap") return `Lap ${split.lap}`;
  if (split.kind === "distance" && !split.partial) return `${unitM === 1000 ? "Km" : "Mi"} ${Math.round(split.toM / unitM)}`;
  return formatDistanceWithUnit(split.distanceM, 1);
}

/** "Lap 3 · 12:41 · 36.8 km/h · 224 W" */
export function splitLine(split, unitM = 1000) {
  return `${splitLabel(split, unitM)} · ${formatDuration(split.durationS)} · ${formatSpeed(split.avgSpeed)} ${speedUnit()} · ${Math.round(split.avgPower)} W`;
}
