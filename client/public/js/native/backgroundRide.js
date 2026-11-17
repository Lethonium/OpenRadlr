/** Android owns live transport and recording; the web client owns presentation. */
export class NativeRide {
  active = false;
  #ready;
  #plugin;
  #sockets = new Map();
  #ble = new Map();
  #makeId;
  #schedule;
  #cancel;
  #timer = null;
  #since = -1;
  #pull = null;
  #stopping = null;
  #finishRequested = false;
  #callbacks = {};
  #onError;

  constructor({ plugin, makeId = () => globalThis.crypto.randomUUID(), schedule = (fn, ms) => globalThis.setInterval(fn, ms), cancel = (id) => globalThis.clearInterval(id), onError = () => {} }) {
    this.#plugin = plugin; this.#makeId = makeId; this.#schedule = schedule; this.#cancel = cancel; this.#onError = (error) => { onError(error); this.#callbacks.onError?.(error); };
    this.#ready = Promise.resolve(plugin.addListener("event", (event) => {
      if (event.type === "ble") {
        for (const listener of this.#ble.get(event.event) ?? []) listener(event.value);
      } else if (event.type === "rideState") {
        if (event.ended && this.active) this.flush().then(() => this.#callbacks.onEnded?.()).catch(this.#onError);
        else if (event.resumed && this.active) {
          this.#callbacks.onResume?.();
          this.flush().catch(this.#onError);
        }
      } else if (event.type === "serviceLost") {
        for (const socket of this.#sockets.values()) socket.dispatch("close");
        this.active = false; this.#cancel(this.#timer);
        this.#onError(new Error("Native ride service stopped")); // i18n-ok (internal bridge error)
      } else this.#sockets.get(event.id)?.dispatch(event.type, event.data);
    }));
    this.#ready.catch(this.#onError);
  }

  createSocket(url) {
    const id = this.#makeId(), listeners = new Map(), owner = this;
    const socket = {
      readyState: 0,
      addEventListener(type, listener) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(listener); },
      dispatch(type, data) {
        if (type === "open") { if (this.readyState !== 0) return; this.readyState = 1; }
        if (type === "close") { if (this.readyState === 3) return; this.readyState = 3; owner.#sockets.delete(id); }
        for (const listener of listeners.get(type) ?? []) listener({ type, data });
      },
      send(data) {
        if (this.readyState !== 1) return;
        owner.#plugin.sendSocket({ id, data }).catch((error) => { this.dispatch("error", error); this.dispatch("close"); });
      },
      close() {
        const wasOpen = this.readyState === 1;
        this.dispatch("close");
        if (wasOpen) owner.#plugin.closeSocket({ id }).catch(owner.#onError);
      },
    };
    this.#sockets.set(id, socket);
    this.#ready.then(async () => {
      if (socket.readyState === 3) return;
      await this.#plugin.openSocket({ id, url });
      if (socket.readyState === 3) await this.#plugin.closeSocket({ id });
    }).catch((error) => { socket.dispatch("error", error); socket.dispatch("close"); });
    return socket;
  }

  bluetooth(plugin) {
    const wrapped = Object.create(plugin);
    wrapped.addListener = async (event, listener) => {
      await this.#ready;
      if (!this.#ble.has(event)) this.#ble.set(event, new Set());
      const listeners = this.#ble.get(event);
      listeners.add(listener);
      try { await this.#plugin.observeEvent({ event }); }
      catch (error) { listeners.delete(listener); throw error; }
      return { remove: async () => listeners.delete(listener) };
    };
    for (const method of ["connect", "getServices", "startNotifications", "write", "writeWithoutResponse"]) {
      wrapped[method] = (options) => this.#plugin.bleOperation({ method, options });
    }
    return wrapped;
  }

  async start(data, callbacks = {}) {
    await this.#ready;
    this.#callbacks = callbacks;
    this.#since = data.snapshot?.recorder?.samples?.at(-1)?.t ?? -1;
    await this.#plugin.startRide(data);
    this.active = true;
    this.#timer = this.#schedule(() => this.flush().catch(this.#onError), 1000);
  }
  flush() {
    if (!this.active) return Promise.resolve();
    this.#pull ??= (async () => {
      let state;
      do {
        state = await this.#plugin.snapshot({ since: this.#since });
        const fresh = (state.samples ?? []).filter((sample) => sample.t > this.#since).sort((a, b) => a.t - b.t);
        if (fresh.length) {
          await this.#callbacks.onSamples?.(fresh);
          this.#since = fresh.at(-1).t;
        }
        await this.#callbacks.onState?.(state);
      } while ((state.samples?.length ?? 0) >= 1000);
    })().finally(() => { this.#pull = null; });
    return this.#pull;
  }
  async update(control, checkpoint) {
    if (this.active) await this.#plugin.updateRide({ control, ...(checkpoint && { checkpoint }) });
  }
  stop(finished = false) {
    if (!this.active) return Promise.resolve();
    this.#finishRequested ||= finished;
    this.#stopping ??= (async () => {
      this.#cancel(this.#timer); this.#timer = null;
      await this.flush();
      const state = await this.#plugin.stopRide({ finished: this.#finishRequested });
      const fresh = (state.samples ?? []).filter((sample) => sample.t > this.#since);
      if (fresh.length) await this.#callbacks.onSamples?.(fresh);
      this.active = false;
    })().finally(() => { this.#stopping = null; this.#finishRequested = false; });
    return this.#stopping;
  }
  async recover(saved, profileId = "main") {
    const { snapshot } = await this.#plugin.recover();
    return mergeNativeRecovery(saved, snapshot, profileId);
  }
  clear() { return this.#plugin.clear(); }
  openSettings(kind) { return this.#plugin.openSettings({ kind }); }
}

/** Prefer the browser's enriched samples, but recover native-only seconds. */
export function mergeNativeRecovery(saved, native, profileId = "main") {
  if (!native?.nativeRideId || !native.recorder) return saved;
  // Unscoped journals predate rider profiles and belong to the original rider.
  if ((native.profileId ?? "main") !== profileId || (saved?.profileId ?? profileId) !== profileId) return saved;
  if (saved && saved.nativeRideId !== native.nativeRideId) return saved;
  if (!saved) return native;
  const samples = new Map((native.recorder.samples ?? []).map((sample) => [sample.t, sample]));
  for (const sample of saved.recorder?.samples ?? []) samples.set(sample.t, sample);
  return { ...saved, ...native, recorder: { ...native.recorder, ...saved.recorder, samples: [...samples.values()].sort((a, b) => a.t - b.t) } };
}

/** A serializable control model, independent of frame rendering. */
export function nativeControl({ profile, training, gearbox, routes = new Map(), studio, physics, paused = false, canControl = false, nowS = 0 }) {
  const player = training?.player;
  const plan = studio?.plan;
  return {
    difficulty: profile.difficulty, ftp: profile.ftp, units: profile.units,
    target: studio ? studio.targetWatts(nowS) : training?.targetWatts() ?? null,
    intensity: studio?.intensity ?? training?.intensity ?? 1,
    erg: studio ? studio.erg : training?.mode === "erg",
    segments: plan ? plan.segments.map((s) => ({ durationS: s.duration_s, from: s.from, to: s.to })) : player?.workout.segments ?? [],
    elapsed: studio ? studio.elapsed(nowS) ?? 0 : player?.elapsedS ?? 0,
    classClock: Boolean(studio),
    classes: studio?.classes ? Object.fromEntries([...studio.classes].map(([id, plan]) => [id, plan.segments.map((s) => ({ durationS: s.duration_s, from: s.from, to: s.to }))])) : {},
    ratio: gearbox?.ratio ?? 0, referenceRatio: profile.chainring / profile.cog,
    mass: physics?.mass_kg ?? profile.weightKg + 9, cda: physics?.cda_m2 ?? .32,
    crr: physics?.crr ?? .004, airDensity: physics?.air_density ?? 1.225,
    routeLengths: Object.fromEntries([...routes].map(([id, route]) => [id, route.length])),
    routeLoops: Object.fromEntries([...routes].map(([id, route]) => [id, Boolean(route.loop)])),
    paused, canControl,
  };
}

/** Adds virtual coordinates when the corresponding route geometry is available. */
export function enrichNativeSample(sample, route, toLatLon) {
  if (!route || !Number.isFinite(sample.routeM)) return sample;
  const position = route.positionAt(sample.routeM);
  return { ...sample, ...toLatLon(position.x, position.y, route.geo), elevation: route.elevationAt(sample.routeM) };
}
