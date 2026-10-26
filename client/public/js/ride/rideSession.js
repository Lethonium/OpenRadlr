import { applyDifficulty } from "./difficulty.js";

/**
 * Glue between devices and the server for one ride:
 * - collects the latest power, cadence and heart rate from the devices,
 * - sends telemetry to the server at a fixed rate,
 * - controls the trainer via a resistance model, which returns either
 *   `{ grade, cw? }` (simulation mode: difficulty, virtual shifting; `cw` the
 *   trainer's own air drag) or `{ power }` (ERG mode: manual target or
 *   workout). A plain number is a grade.
 * - eases the road's grade from the server into the trainer over a few
 *   seconds, so a change of grade comes as a ramp, not a jolt; gear and
 *   difficulty changes still apply at once.
 *
 * Heart rate is shown locally only and never sent to the server.
 */
export class RideSession {
  latest = { power: 0, cadence: null, heartRate: null };
  serverGrade = 0;
  /** The grade the trainer gets: eased towards `serverGrade`, null before the first. */
  roadGrade = null;
  lastSent = null;
  #unsubscribe = [];
  #offResistance = null;
  #timer = null;

  /**
   * @param {{
   *   connection: {sendTelemetry: Function, on: Function},
   *   trainer: {on: Function, setGrade: (grade: number) => Promise<void>},
   *   heartRateMonitor?: {on: Function} | null,
   *   getDifficulty?: () => number,
   *   resistanceModel?: (serverGrade: number, latest: object) => number | {grade: number} | {power: number},
   *   setInterval?: Function, clearInterval?: Function, periodMs?: number,
   *   minGradeChange?: number, minPowerChange?: number,
   *   easeTimeS?: number, maxEasePerS?: number, flat?: boolean,
   *   onError?: (error: Error) => void,
   * }} deps `easeTimeS`: time constant of the easing; `maxEasePerS`: the
   *   fastest the eased grade moves (percent per second); `flat`: no grades
   *   arrive (the studio), so the road is flat from the start
   */
  constructor({
    connection,
    trainer,
    heartRateMonitor = null,
    getDifficulty = () => 1,
    resistanceModel = (grade) => applyDifficulty(grade, getDifficulty()),
    setInterval: schedule = (fn, ms) => globalThis.setInterval(fn, ms),
    clearInterval: cancel = (id) => globalThis.clearInterval(id),
    periodMs = 250,
    minGradeChange = 0.1,
    minPowerChange = 1,
    easeTimeS = 1.5,
    maxEasePerS = 1.5,
    flat = false,
    onError = () => {},
  }) {
    Object.assign(this, {
      connection,
      trainer,
      heartRateMonitor,
      resistanceModel,
      schedule,
      cancel,
      periodMs,
      minGradeChange,
      minPowerChange,
      easeTimeS,
      maxEasePerS,
      flat,
      onError,
    });
  }

  start() {
    this.#unsubscribe.push(
      this.trainer.on("data", ({ power, cadence, heartRate }) => {
        if (Number.isFinite(power)) this.latest.power = power;
        if (Number.isFinite(cadence)) this.latest.cadence = cadence;
        if (Number.isFinite(heartRate) && !this.heartRateMonitor) this.latest.heartRate = heartRate;
      }),
    );
    if (this.heartRateMonitor) {
      this.#unsubscribe.push(
        this.heartRateMonitor.on("data", ({ heartRate }) => {
          if (Number.isFinite(heartRate)) this.latest.heartRate = heartRate;
        }),
      );
    }
    this.#listenToServer();
    this.#timer = this.schedule(() => {
      this.connection.sendTelemetry({ power: this.latest.power, cadence: this.latest.cadence });
      const arrived = this.#ease(this.periodMs / 1000);
      // Virtual shifting depends on speed, so resistance may change between server updates.
      this.updateResistance({ force: arrived });
    }, this.periodMs);
    // Without grades from the server nothing else would send the first command (#41).
    if (this.flat) {
      this.roadGrade = 0;
      this.refreshResistance();
    }
  }

  #listenToServer() {
    this.#offResistance = this.connection.on("resistance", ({ grade_percent: grade }) => {
      this.serverGrade = grade;
      // The first grade of a ride applies at once; later ones are eased in.
      if (this.roadGrade === null) {
        this.roadGrade = grade;
        this.refreshResistance();
      }
    });
  }

  /** Rides on over `connection` after a reconnect (#73): telemetry goes there, grades come from there. */
  setConnection(connection) {
    this.#offResistance?.();
    this.connection = connection;
    this.#listenToServer();
  }

  /**
   * Moves the road grade `dt` seconds' worth towards the server's.
   * @returns {boolean} true when it just arrived there, so the last bit is sent too
   */
  #ease(dt) {
    if (this.roadGrade === null || this.roadGrade === this.serverGrade) return false;
    const gap = this.serverGrade - this.roadGrade;
    const step = gap * (1 - Math.exp(-dt / this.easeTimeS));
    const most = this.maxEasePerS * dt;
    this.roadGrade += Math.min(most, Math.max(-most, step));
    if (Math.abs(this.serverGrade - this.roadGrade) >= 0.05) return false;
    this.roadGrade = this.serverGrade;
    return true;
  }

  /** Sends resistance now, e.g. after the difficulty or gear changed. */
  refreshResistance() {
    this.updateResistance({ force: true });
  }

  /** Sends resistance if it changed noticeably since the last write. */
  updateResistance({ force = false } = {}) {
    const raw = this.resistanceModel(this.roadGrade ?? this.serverGrade, this.latest);
    const command = typeof raw === "number" ? { grade: raw } : raw;
    const last = this.lastSent;
    if (!force) {
      if (last === null) return;
      const sameKind = ("power" in command) === ("power" in last);
      if (sameKind && "power" in command && Math.abs(command.power - last.power) < this.minPowerChange) return;
      if (sameKind && "grade" in command && Math.abs(command.grade - last.grade) < this.minGradeChange) return;
    }
    this.lastSent = command;
    const write =
      "power" in command ? this.trainer.setTargetPower?.(command.power) : this.trainer.setGrade(command.grade, "cw" in command ? { cw: command.cw } : {});
    Promise.resolve(write).catch(this.onError);
  }

  /** Last command sent to the trainer (`{grade}` or `{power}`), for display. */
  get lastSentGrade() {
    return this.lastSent && "grade" in this.lastSent ? this.lastSent.grade : null;
  }

  stop() {
    this.cancel(this.#timer);
    this.#unsubscribe.forEach((off) => off());
    this.#unsubscribe = [];
    this.#offResistance?.();
    this.#offResistance = null;
  }
}
