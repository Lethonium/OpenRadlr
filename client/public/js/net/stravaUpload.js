/** A ride's Strava submission and its resumable processing receipt. No DOM or timers. */
export const uploadKey = (athleteId, firstSampleTime) => `${athleteId}:${firstSampleTime}`;
const PREFIX = "openradlr.strava-upload.";
const initial = () => ({ phase: "idle", uploadId: null, activityId: null, error: null, code: null });
const positiveId = (id) => Number.isSafeInteger(id) && id > 0;

/** Small receipts only; files and tokens never go into localStorage. */
export class UploadReceipts {
  #memory = new Map();
  available = true;

  constructor({ storage = {
    getItem: (key) => globalThis.localStorage.getItem(key),
    setItem: (key, value) => globalThis.localStorage.setItem(key, value),
  } } = {}) {
    this.storage = storage;
  }

  load(key) {
    if (this.#memory.has(key)) return this.#memory.get(key);
    let stored;
    try {
      stored = this.storage.getItem(PREFIX + key);
    } catch {
      // Only storage that can't be read is unavailable.
      this.available = false;
      return null;
    }
    let value;
    try {
      value = JSON.parse(stored);
    } catch {
      return null; // A corrupt receipt is ignored; the storage itself works.
    }
    if (!value || !["uploading", "processing", "pending", "check-failed", "uncertain", "success", "rejected", "failed"].includes(value.phase)) return null;
    if (value.uploadId !== null && !positiveId(value.uploadId)) return null;
    if (value.activityId !== null && !positiveId(value.activityId)) return null;
    if (value.phase === "success" && !positiveId(value.activityId)) return null;
    return value;
  }

  save(key, value) {
    this.#memory.set(key, value);
    try {
      this.storage.setItem(PREFIX + key, JSON.stringify(value));
    } catch {
      this.available = false;
    }
  }
}

export class StravaUpload {
  #listeners = new Set();
  #active = true;
  #running = null;
  #state;

  constructor({ client, receipts, key }) {
    this.client = client;
    this.receipts = receipts;
    this.key = key;
    this.#state = { ...initial(), ...receipts.load(key) };
    // A newly mounted screen has just read its account; old auth errors can be retried.
    this.#state.code = null;
    if (this.#state.phase === "uploading") this.#state.phase = "uncertain";
    if (this.#state.phase === "processing") this.#state.phase = "pending";
  }

  get state() { return { ...this.#state, persisted: this.receipts.available }; }

  subscribe(listener) {
    this.#listeners.add(listener);
    listener(this.state);
    return () => this.#listeners.delete(listener);
  }

  #set(patch) {
    this.#state = { ...this.#state, ...patch };
    this.receipts.save(this.key, this.#state);
    if (this.#active) for (const listener of this.#listeners) listener(this.state);
  }

  /** Explicit user action only; a known upload is checked instead of submitted. */
  run(makeFile, name, { resubmit = false } = {}) {
    if (this.#running) return this.#running;
    if (!this.#active) return Promise.resolve();
    // The previous screen may have received its POST response after this one opened.
    this.#state = { ...initial(), ...this.receipts.load(this.key) };
    if (this.#state.phase === "uploading") this.#state.phase = "uncertain";
    if (this.#state.phase === "processing") this.#state.phase = "pending";
    if (this.#state.phase === "success" || this.#state.phase === "rejected") {
      for (const listener of this.#listeners) listener(this.state);
      return Promise.resolve();
    }
    if (this.#state.phase === "uncertain" && !resubmit) return Promise.resolve();
    this.#running = this.#execute(makeFile, name).finally(() => { this.#running = null; });
    return this.#running;
  }

  async #execute(makeFile, name) {
    let receipt = { id: this.#state.uploadId };
    if (!receipt.id) {
      let file;
      try {
        file = makeFile();
      } catch (error) {
        this.#set({ phase: "failed", error: error.message });
        return;
      }
      this.#set({ phase: "uploading", error: null, code: null });
      try {
        receipt = await this.client.upload(file, name);
      } catch (error) {
        // A lost POST response can mean Strava accepted it. Never auto-repost.
        const refused = error.status >= 400 && error.status < 500;
        this.#set({ phase: refused ? "failed" : "uncertain", error: error.message, code: error.code ?? null });
        return;
      }
    }
    if (this.#accept(receipt) || !this.#active) return;
    try {
      const done = await this.client.waitForActivity(receipt, { shouldContinue: () => this.#active });
      if (!this.#accept(done)) this.#set({ phase: "pending" });
    } catch (error) {
      this.#set({ phase: "check-failed", error: error.message, code: error.code ?? null });
    }
  }

  #accept(receipt) {
    if (receipt.error) {
      this.#set({ phase: "rejected", uploadId: receipt.id ?? this.#state.uploadId, error: receipt.error });
      return true;
    }
    if (positiveId(receipt.activity_id)) {
      this.#set({ phase: "success", uploadId: receipt.id ?? this.#state.uploadId, activityId: receipt.activity_id, error: null, code: null });
      return true;
    }
    if (!positiveId(receipt.id)) {
      this.#set({ phase: "uncertain" });
      return true;
    }
    this.#set({ phase: "processing", uploadId: receipt.id, error: null, code: null });
    return false;
  }

  /** A detached screen cannot mark another ride as saved or keep polling. */
  dispose() {
    this.#active = false;
    this.#listeners.clear();
  }
}
