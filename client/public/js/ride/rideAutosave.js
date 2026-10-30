/**
 * Keeps the ride in the browser while it goes on (#73): if the tab crashes or
 * the phone kills the page, the start menu offers to continue or save it.
 * Nothing leaves the browser. One ride at a time: the recorder and summary
 * data under "current", each photo under "photo:<name>".
 */

import { t } from "../i18n/i18n.js";

/** Older rides can still be saved, but not continued. */
export const AUTOSAVE_MAX_AGE_MS = 12 * 3600 * 1000;

const CURRENT = "current";
const PHOTO = "photo:";

/**
 * The store the autosave writes to, on IndexedDB: one object store of keys
 * and values. Every call opens the database again; autosaves are rare.
 * @returns {{get: (key: string) => Promise<any>, put: (key: string, value: any) => Promise<void>, delete: (key: string) => Promise<void>, keys: () => Promise<string[]>}}
 */
export function indexedDbStore(name = "openradlr-autosave") {
  const open = () =>
    new Promise((resolve, reject) => {
      const request = indexedDB.open(name, 1);
      request.onupgradeneeded = () => request.result.createObjectStore("kv");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  const run = async (mode, act) => {
    const db = await open();
    try {
      return await new Promise((resolve, reject) => {
        const request = act(db.transaction("kv", mode).objectStore("kv"));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    } finally {
      db.close();
    }
  };
  return {
    get: (key) => run("readonly", (store) => store.get(key)),
    put: async (key, value) => void (await run("readwrite", (store) => store.put(value, key))),
    delete: async (key) => void (await run("readwrite", (store) => store.delete(key))),
    keys: async () => (await run("readonly", (store) => store.getAllKeys())).map(String),
  };
}

export class RideAutosave {
  #reported = false;

  /** @param {{store: ReturnType<typeof indexedDbStore>, log?: (...args: any[]) => void}} options */
  constructor({ store, log = console.warn }) {
    this.store = store;
    this.log = log;
  }

  /** Runs `act`; a storage error (private mode, quota) is logged once and gives `fallback`. */
  async #safely(act, fallback) {
    try {
      return await act();
    } catch (error) {
      if (!this.#reported) {
        this.#reported = true;
        this.log("Ride autosave unavailable:", error); // i18n-ok
      }
      return fallback;
    }
  }

  /** @param {object} snapshot the ride (see docs/superpowers/specs/2026-10-17-ride-recovery-design.md) */
  save(snapshot) {
    return this.#safely(() => this.store.put(CURRENT, snapshot));
  }

  load() {
    return this.#safely(async () => (await this.store.get(CURRENT)) ?? null, null);
  }

  /** @param {{name: string, blob: Blob, takenAt: number}} photo */
  addPhoto({ name, blob, takenAt }) {
    return this.#safely(() => this.store.put(PHOTO + name, { name, blob, takenAt }));
  }

  /** The saved photos, oldest first. */
  photos() {
    return this.#safely(async () => {
      const keys = (await this.store.keys()).filter((key) => key.startsWith(PHOTO));
      const photos = await Promise.all(keys.map((key) => this.store.get(key)));
      return photos.filter(Boolean).sort((a, b) => a.takenAt - b.takenAt);
    }, []);
  }

  /** Forgets the ride and its photos (saved, uploaded or discarded). */
  clear() {
    return this.#safely(async () => {
      const keys = (await this.store.keys()).filter((key) => key === CURRENT || key.startsWith(PHOTO));
      await Promise.all(keys.map((key) => this.store.delete(key)));
    });
  }
}

/** Whether the saved ride can still be continued: recent, and from this server. */
export function continueAllowed(snapshot, { now, serverUrl }) {
  return now - snapshot.savedAt < AUTOSAVE_MAX_AGE_MS && snapshot.serverUrl === serverUrl;
}

/** "Unfinished ride · Rolling Hills · 23.4 km · 41 min ago" */
export function unfinishedLabel(snapshot, { now, formatDistance }) {
  const minutes = Math.max(0, Math.round((now - snapshot.savedAt) / 60000));
  const age = minutes < 60 ? t("unfinished.ageMin", { n: minutes }) : t("unfinished.ageHour", { n: Math.round(minutes / 60) });
  return t("unfinished.label", { route: snapshot.routeName, distance: formatDistance(snapshot.distance), age });
}
