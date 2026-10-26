/**
 * A summary of every finished ride, kept in the browser (IndexedDB, injected
 * like the autosave) as the base for fitness, FTP and level work (#48). One
 * record per ride under "ride:<id>"; saving the same ride twice replaces it.
 * Later versions add fields without a migration: readers treat missing
 * fields as unknown. See docs/superpowers/specs/2026-10-18-splits-laps-ride-history-design.md.
 */

import { bestEfforts, rideLoad, weightedPower } from "./powerAnalysis.js";

const PREFIX = "ride:";

/**
 * The record of a ride.
 * @param {{recorder: import("./rideRecorder.js").RideRecorder, splits: object[], splitMode: string, routeId: ?string, measured: boolean, profile: {ftp?: number, weightKg?: number}, test?: ?string}} ride
 */
export function rideRecord({ recorder, splits, splitMode, routeId, measured, profile, test = null }) {
  const first = recorder.samples[0];
  const last = recorder.samples.at(-1);
  const summary = recorder.summary();
  const weighted = weightedPower(recorder.samples, recorder.pauses);
  return {
    version: 2,
    id: String(first.t),
    startedAt: first.t,
    endedAt: last.t,
    routeId: routeId ?? null,
    measured: Boolean(measured),
    ftp: profile.ftp ?? null,
    weightKg: profile.weightKg ?? null,
    ...summary,
    curve: bestEfforts(recorder.samples, recorder.pauses),
    weightedPower: weighted,
    load: rideLoad({ weightedPower: weighted, durationS: summary.durationS, ftp: profile.ftp }),
    test,
    splitMode,
    splits,
  };
}

export class RideHistory {
  #reported = false;

  /** @param {{store: {get: Function, put: Function, keys: Function}, log?: (...args: any[]) => void}} options */
  constructor({ store, log = console.warn }) {
    this.store = store;
    this.log = log;
  }

  async #safely(act, fallback) {
    try {
      return await act();
    } catch (error) {
      if (!this.#reported) {
        this.#reported = true;
        this.log("Ride history unavailable:", error);
      }
      return fallback;
    }
  }

  /** Stores the record; a storage error is logged once and swallowed. */
  save(record) {
    return this.#safely(() => this.store.put(PREFIX + record.id, record));
  }

  /** All records, newest first. */
  list() {
    return this.#safely(async () => {
      const keys = (await this.store.keys()).filter((key) => key.startsWith(PREFIX));
      const records = (await Promise.all(keys.map((key) => this.store.get(key)))).filter(Boolean);
      return records.sort((a, b) => b.startedAt - a.startedAt);
    }, []);
  }
}
