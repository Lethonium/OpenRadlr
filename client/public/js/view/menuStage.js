/**
 * The start menu's stage: the picked route's elevation profile, a top-down
 * map, and behind the menu the 3D island seen from a drone (#4).
 *
 * The menu never waits for it: the map and profile show as soon as the route
 * file is there, the island is built in the background (a worker) and fades
 * in when ready. Picking another route flies the camera down to it and
 * highlights it; the world is rebuilt for that route in the background, so
 * joining can take the finished 3D view over as it is. The workout card
 * circles the outdoor gym at the default route's start (#77).
 */
import { RouteGeometry } from "../route/geometry.js";
import { fetchMapNeighbours, fetchMapNetwork } from "../route/worldMap.js";
import { gymOfRoute } from "../workout/gymSpots.js";

/** Routes on one map share a world; a route without a map is a world of its own. */
const mapOf = (route) => route.map?.id ?? `route:${route.id}`;

export class MenuStage {
  #routes = [];
  #selectedId = undefined;
  #token = 0;
  #files = new Map();
  #networks = new Map();
  #geometries = new Map();
  /** The view on screen and the route it was built for. */
  #view = null;
  #viewRouteId = null;
  #viewMap = null;
  /** The scene's overview, for per-view lenses. */
  #overview = null;
  /** Lenses by camera view, built once per overview. */
  #lenses = null;
  /** The outdoor gyms of the world on screen. */
  #gyms = [];
  #camera = null;
  /** The route whose world is being built. */
  #buildingId = null;
  #buildTimer = null;
  #frame = null;
  #lastTime = null;
  #stopped = false;
  #paused = false;

  /**
   * @param {object} deps
   * @param {(id: string) => Promise<object>} deps.fetchRouteFile
   * @param {(mapId: string) => Promise<object>} [deps.fetchNetwork] a map's road network file (#26)
   * @param {(file: object, others: object[], options: {network: object | null}) => Promise<object>} [deps.buildScene] without it, no 3D (map only)
   * @param {(route: RouteGeometry, scene: object) => object} [deps.createView] a View3D on the menu canvas
   * @param {(viewKind: "island" | "route" | "gym", overview: object) => object} [deps.lensFor] the lens for each camera view (the gym orbit flies low and needs a nearer plane)
   * @param {(overview: object) => object} [deps.createCamera] a MenuCamera
   * @param {(route: RouteGeometry, others: RouteGeometry[]) => object[]} [deps.highlights] bands for `setHighlights`
   * @param {(stage: {route: RouteGeometry | null, routes: RouteGeometry[], network?: object | null}) => void} deps.onRoute map and profile of the pick
   * @param {(ready: boolean) => void} [deps.onWorld] the island is (no longer) on screen
   * @param {(view: object, dt: number, timeS: number) => void} [deps.render] draws one frame
   * @param {number} [deps.rebuildDelayMs] waits for the pick to settle before rebuilding
   * @param {number} [deps.landingCheckMs] then how often it looks whether the camera has landed
   */
  constructor(deps) {
    this.deps = {
      rebuildDelayMs: 900,
      landingCheckMs: 250,
      requestFrame: (callback) => globalThis.requestAnimationFrame(callback),
      cancelFrame: (handle) => globalThis.cancelAnimationFrame(handle),
      setTimer: (callback, ms) => setTimeout(callback, ms),
      clearTimer: (handle) => clearTimeout(handle),
      onWorld: () => {},
      ...deps,
    };
  }

  get uses3d() {
    return Boolean(this.deps.buildScene && this.deps.createView);
  }

  /** The route the 3D view on screen was built for (null while building). */
  get viewRouteId() {
    return this.#viewRouteId;
  }

  /**
   * Shows `selectedId` out of the server's `routes` (from /api/info). Cheap to
   * call on every menu refresh: nothing happens unless the pick changed.
   */
  async select(routes, selectedId) {
    const listed = (routes ?? []).map((r) => r.id).join();
    if (this.#stopped || (selectedId === this.#selectedId && listed === this.#routes.map((r) => r.id).join())) return;
    this.#routes = routes ?? [];
    this.#selectedId = selectedId;
    const token = ++this.#token;
    const picked = this.#routes.find((r) => r.id === selectedId);

    if (!picked || picked.kind !== undefined) {
      this.#view?.setHighlights([]);
      this.deps.onRoute({ route: null, routes: [...this.#geometries.values()] });
      // The island still shows behind the menu: build it for the first route.
      const first = this.#routes.find((r) => r.kind === undefined);
      if (picked?.kind === "workout" && first) {
        // The workout is at the default route's café: circle its gym. A world
        // on the same map has it already; any other is built for that route.
        try {
          this.#geometry(await this.#file(first.id));
        } catch (error) {
          console.warn("Route preview unavailable:", error);
          return;
        }
        if (token !== this.#token || this.#stopped || this.#showGym()) return;
        await this.#prepare(first.id, token, { highlight: false });
        return;
      }
      this.#camera?.showIsland();
      if (!this.#view && first) this.#prepare(first.id, token, { highlight: false });
      return;
    }
    await this.#prepare(picked.id, token, { highlight: true });
  }

  async #prepare(id, token, { highlight }) {
    let file;
    let others;
    let network;
    try {
      file = await this.#file(id);
      [others, network] = await Promise.all([
        fetchMapNeighbours(file, this.#routes, (other) => this.#file(other)),
        fetchMapNetwork(file, this.deps.fetchNetwork && ((mapId) => this.#network(mapId))),
      ]);
    } catch (error) {
      console.warn("Route preview unavailable:", error);
      return;
    }
    if (token !== this.#token || this.#stopped) return;
    const route = this.#geometry(file);
    const neighbours = others.map((f) => this.#geometry(f));
    if (highlight) {
      this.deps.onRoute({ route, routes: [route, ...neighbours], network });
      this.#show(route, neighbours);
    }
    if (!this.uses3d || this.#viewRouteId === id || this.#buildingId === id) return;
    // The first world right away; later ones once the pick has settled and the camera
    // has landed: swapping worlds stalls the main thread, which mid-glide shows as a hitch.
    this.deps.clearTimer(this.#buildTimer);
    const build = () => {
      if (this.#camera?.flying) this.#buildTimer = this.deps.setTimer(build, this.deps.landingCheckMs);
      else this.#build(id, file, others, network);
    };
    if (this.#view || this.#buildingId) this.#buildTimer = this.deps.setTimer(build, this.deps.rebuildDelayMs);
    else build();
  }

  async #build(id, file, others, network) {
    if (this.#stopped || this.#selectedOrFirst() !== id) return;
    this.#buildingId = id;
    let scene;
    try {
      scene = await this.deps.buildScene(file, others, { network });
    } catch (error) {
      console.warn("Menu world unavailable:", error);
      scene = null;
    }
    if (this.#buildingId === id) this.#buildingId = null;
    if (!scene || this.#stopped || this.#selectedOrFirst() !== id) return;
    const route = this.#geometry(file);
    let view;
    try {
      this.#view?.dispose();
      this.#view = null;
      view = this.deps.createView(route, scene);
    } catch (error) {
      console.warn("Menu world unavailable:", error);
      this.deps.onWorld(false);
      return;
    }
    this.#camera ??= this.deps.createCamera(scene.overview);
    view.camera = this.#camera;
    this.#view = view;
    this.#viewRouteId = id;
    this.#viewMap = mapOf(route);
    this.#gyms = scene.gyms ?? [];
    this.#overview = scene.overview ?? null;
    this.#lenses = null;
    const picked = this.#routes.find((r) => r.id === this.#selectedId);
    if (picked && picked.kind === undefined) this.#show(route, others.map((f) => this.#geometry(f)));
    else if (picked?.kind === "workout") this.#showGym();
    // The studio (or nothing picked): the island orbit, also out of the camera's opening shot.
    else this.#camera.showIsland();
    this.#applyLens();
    this.deps.onWorld(true);
    this.#loop();
  }

  #selectedOrFirst() {
    const picked = this.#routes.find((r) => r.id === this.#selectedId);
    if (picked && picked.kind === undefined) return picked.id;
    if (picked?.kind === "workout") return this.#firstRouteId();
    return this.#viewRouteId ?? this.#routes.find((r) => r.kind === undefined)?.id ?? null;
  }

  #firstRouteId() {
    return this.#routes.find((r) => r.kind === undefined)?.id ?? null;
  }

  /**
   * Circles the gym at the default route's start when the world on screen
   * has it (the route's own, or another on its map); else the island.
   * Returns whether it does.
   */
  #showGym() {
    if (!this.#view || !this.#camera) return false;
    const route = this.#geometries.get(this.#firstRouteId());
    const gym = route && mapOf(route) === this.#viewMap ? gymOfRoute(this.#gyms, route) : null;
    if (gym) this.#camera.showGym(gym);
    else this.#camera.showIsland();
    return Boolean(gym);
  }

  #show(route, neighbours) {
    if (!this.#view) return;
    // A route on another map only shows once its own world is built.
    if (mapOf(route) !== this.#viewMap) {
      this.#view.setHighlights([]);
      this.#camera.showIsland();
      return;
    }
    this.#view.setHighlights(this.deps.highlights?.(route, neighbours) ?? []);
    this.#camera.showRoute(route);
  }

  /** Holds the picture still (e.g. while joining), so the menu frees the main thread. */
  pause() {
    this.#paused = true;
    if (this.#frame !== null) this.deps.cancelFrame(this.#frame);
    this.#frame = null;
  }

  resume() {
    this.#paused = false;
    this.#lastTime = null;
    this.#loop();
  }

  /** Uses the lens for the camera's current view (the gym orbit flies low). */
  #applyLens() {
    if (!this.#view || !this.#overview || !this.deps.lensFor) return;
    const kind = this.#camera?.view ?? "island";
    this.#lenses ??= new Map();
    if (!this.#lenses.has(kind)) this.#lenses.set(kind, this.deps.lensFor(kind, this.#overview));
    const lens = this.#lenses.get(kind);
    if (lens && lens !== this.#view.lens) this.#view.lens = lens;
  }

  #loop() {
    if (this.#frame !== null || this.#stopped || this.#paused || !this.#view) return;
    const tick = (ms) => {
      this.#frame = null;
      if (this.#stopped || this.#paused || !this.#view) return;
      const timeS = ms / 1000;
      const dt = this.#lastTime === null ? 0 : timeS - this.#lastTime;
      this.#lastTime = timeS;
      this.#camera.update(dt);
      this.#applyLens();
      this.deps.render?.(this.#view, dt, timeS);
      this.#frame = this.deps.requestFrame(tick);
    };
    this.#frame = this.deps.requestFrame(tick);
  }

  #file(id) {
    if (!this.#files.has(id)) {
      const promise = this.deps.fetchRouteFile(id);
      promise.catch(() => this.#files.delete(id));
      this.#files.set(id, promise);
    }
    return this.#files.get(id);
  }

  #network(mapId) {
    if (!this.#networks.has(mapId)) {
      const promise = this.deps.fetchNetwork(mapId);
      promise.catch(() => this.#networks.delete(mapId));
      this.#networks.set(mapId, promise);
    }
    return this.#networks.get(mapId);
  }

  #geometry(file) {
    if (!this.#geometries.has(file.id)) this.#geometries.set(file.id, new RouteGeometry(file));
    return this.#geometries.get(file.id);
  }

  /**
   * Stops the menu. Returns the 3D view if it was built for `routeId` (ready
   * for the ride: no highlights, nothing else holds it), else null.
   */
  takeView(routeId) {
    this.#stopped = true;
    this.deps.clearTimer(this.#buildTimer);
    if (this.#frame !== null) this.deps.cancelFrame(this.#frame);
    this.#frame = null;
    const view = this.#view;
    this.#view = null;
    if (!view) return null;
    view.setHighlights([]);
    if (this.#viewRouteId === routeId) return view;
    view.dispose();
    return null;
  }

  stop() {
    this.takeView(null);
    this.deps.onWorld(false);
  }
}
