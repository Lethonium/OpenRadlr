/**
 * The ride HUD's numbers and canvases, shared by the ride screen (main.js)
 * and the VR page (vr/main.js): the same markup, filled from a snapshot of
 * the ride. The banner, splits and recorder stay with the tablet.
 */
import { t, tn } from "../i18n/i18n.js";
import { segmentLabel } from "../ride/workout.js";
import { formatDistance, formatDuration, formatGrade, formatLength, formatSpeed, formatWkg } from "../util/format.js";
import { MetricBinder, formatPosition, formatTimeGap, gaugeFraction, nextMarker, powerZone } from "./hud.js";
import { raceCaption, riderName } from "./panels.js";

/** Average speed once there are enough seconds to mean something. */
export const averageSpeed = (metres, seconds) => (seconds >= 5 ? formatSpeed(metres / seconds) : "–");

/** The "Road ahead" line: the next climb, sprint or finish, or what is left of the one I am in. */
export function markerText(marker) {
  if (!marker) return t("ride.roadAhead");
  return marker.inside ? t("ride.markerToGo", { label: marker.label, distance: formatLength(marker.inM) }) : t("ride.markerIn", { label: marker.label, distance: formatLength(marker.inM) });
}

const roundOrDash = (value) => (Number.isFinite(value) ? Math.round(value) : "–");

/**
 * The value of every `data-m` metric the ride HUD shows.
 * @param {{power: number, cadence: ?number, heartRate: ?number, me: ?{distance: number, speed: number}, route: object,
 *   rideDistanceM: number, elapsedS: number, target: ?number, intensity: number, weightKg: number, ftp: number}} snapshot
 */
export function rideHudValues({ power, cadence, heartRate, me, route, rideDistanceM, elapsedS, target, intensity, weightKg, ftp }) {
  return {
    power: Math.round(power || 0),
    wkg: formatWkg(power || 0, weightKg),
    zone: `Z${Math.max(1, powerZone(power || 0, ftp))}`,
    target: target === null ? "–" : target,
    "target-suffix": target === null ? "" : t("hud.target", { watts: target }),
    cadence: roundOrDash(cadence),
    hr: roundOrDash(heartRate),
    speed: formatSpeed(me?.speed ?? 0),
    grade: `${me ? formatGrade(route.gradeAt(me.distance)) : formatGrade(0)} %`,
    distance: formatDistance(rideDistanceM),
    "avg-speed": averageSpeed(rideDistanceM, elapsedS),
    time: formatDuration(elapsedS),
    intensity: `${Math.round(intensity * 100)} %`,
    "next-marker": markerText(me ? nextMarker(route, me.distance, 3000) : null),
  };
}

export class RideHud {
  #root;
  #draw;
  /** The root's metrics; other code may set the metrics this class does not own. */
  metrics;

  /**
   * @param {Element} root holds the `.layout` blocks
   * @param {{drawProfile: Function, drawMinimap: Function, drawUpcoming: Function, drawRaceTimeline: Function, drawWorkout: Function}} draw (canvas, options)
   */
  constructor(root, draw) {
    this.#root = root;
    this.#draw = draw;
    this.metrics = new MetricBinder(root);
  }

  #el(id) {
    return this.#root.querySelector(`#${id}`);
  }

  /**
   * @param {object} snapshot see rideHudValues
   * @param {{layout: string, riders: object[], myId: ?number, standing: ?object, colors: object}} view
   */
  render(snapshot, { layout, riders, myId, standing, colors }) {
    const { route, me, power, target, ftp } = snapshot;
    // Only the canvases of the visible layout are drawn.
    if (layout === "broadcast") {
      this.#draw.drawProfile(this.#el("profile"), { route, riders, myId, colors });
      this.#draw.drawMinimap(this.#el("minimap"), { route, riders, myId, colors });
    } else if (layout === "cockpit" && me) {
      this.#draw.drawUpcoming(this.#el("upcoming"), { route, distance: me.distance, ahead: 2000, colors });
    } else if (layout === "race" && standing) {
      this.#draw.drawRaceTimeline(this.#el("race-timeline"), { standing, myId, colors });
    }

    for (const [name, value] of Object.entries(rideHudValues(snapshot))) this.metrics.set(name, value);
    if (layout === "cockpit") this.#renderGauge(power || 0, target, ftp);
    const watts = Math.round(power || 0);
    const trainingPower = this.#el("training-power");
    const onTarget = target !== null && Math.abs(watts - target) <= Math.max(10, target * 0.05);
    trainingPower.classList.toggle("on-target", onTarget);
    trainingPower.classList.toggle("off-target", target !== null && !onTarget);
  }

  /**
   * The training layout's workout part: chart, block, next block, times, average and progress.
   * @param {{workout: object, state: object, ftp: number, intensity: number, avgW: ?number, paused: boolean, layout: string, colors: object}} input
   *   `state` is a running workout's position (`TrainingControl#workoutState`); `avgW` the average power so far, if any
   */
  renderWorkout({ workout, state, ftp, intensity, avgW, paused, layout, colors }) {
    if (layout === "training") this.#draw.drawWorkout(this.#el("workout-chart"), { workout, elapsedS: state.elapsedS, colors });
    const total = state.elapsedS + state.remainingS;
    const next = workout.segments[state.index + 1];
    const nextWatts = next ? Math.round(((next.from + next.to) / 2) * ftp * intensity) : 0;
    // A plan relayed to a screen has no block labels.
    const label = segmentLabel(state.segment.label);
    const nextLabel = next ? segmentLabel(next.label) : "";
    this.#el("workout-block").textContent = t(label ? "training.block" : "training.blockPlain", { n: state.index + 1, total: workout.segments.length, label }) + (paused ? t("training.paused") : "");
    this.#el("workout-next").textContent = next ? t(nextLabel ? "training.next" : "training.nextPlain", { label: nextLabel, time: formatDuration(next.durationS), watts: nextWatts }) : t("training.lastBlock");
    this.#el("workout-block-time").textContent = formatDuration(state.segmentRemainingS);
    this.#el("workout-elapsed").textContent = formatDuration(state.elapsedS);
    this.#el("workout-remaining").textContent = formatDuration(state.remainingS);
    this.#el("workout-avg").textContent = avgW === null ? "– W" : `${Math.round(avgW)} W`;
    this.#el("workout-progress").style.width = `${total > 0 ? ((state.elapsedS / total) * 100).toFixed(1) : 0}%`;
  }

  /**
   * The race layout's text and lists: lap line, position, lap, distance to go, caption, the progress bar's visibility and the groups.
   * @param {{race: ?object, standing: ?object, status: string}} input `standing` is mine, if I race; `status` is `raceStatus()`
   */
  renderRace({ race, standing, status }) {
    const toGo = standing ? formatLength(standing.toGoM) : "–";
    this.metrics.set("lap-info", status);
    this.metrics.set("position", standing ? formatPosition(standing.position, standing.total) : "–");
    this.metrics.set("lap", standing ? `${standing.lap}/${standing.laps}` : "–");
    this.metrics.set("to-go", toGo);
    this.metrics.set("race-caption", raceCaption(race, standing, status, toGo));
    // The progress bar only while I race; otherwise the caption alone, centred in its box.
    this.#el("race-timeline").hidden = !standing;
    this.#el("race-groups-panel").hidden = !standing;
    this.#renderRaceLists(standing);
  }

  #renderRaceLists(standing) {
    const groups = this.#el("race-groups");
    const around = this.#el("race-around");
    if (!standing) {
      groups.replaceChildren();
      around.replaceChildren();
      return;
    }
    const document = this.#root.ownerDocument;
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
          [t("race.group", { label: group.label, riders: tn("menu.riders", group.size) })],
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

  /** Gauge arc and target tick for the cockpit. */
  #renderGauge(power, target, ftp) {
    this.#el("gauge-fill").style.strokeDashoffset = String(100 - gaugeFraction(power, ftp) * 100);
    const tick = this.#el("gauge-target");
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
}
