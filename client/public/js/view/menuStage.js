/**
 * The start menu's stage: the picked route's elevation profile, a top-down
 * map, and behind the menu the 3D island seen from a drone (#4).
 *
 * The menu never waits for it: the map and profile show as soon as the route
 * file is there, the island is built in the background (a worker) and fades
 * in when ready. Picking another route flies the camera down to it and
 * highlights it; the world is rebuilt for that route in the background, so
 * joining can take the finished 3D view over as it is. The workout card
 * circles the outdoor gym of the picked workout's café (#77), or flies close
 * to one of its statues; a café no offered route starts at is shown at the
 * default route's gym, with that workout's statues.
 */
import { RouteGeometry } from "../route/geometry.js";
import { fetchMapNeighbours, fetchMapNetwork } from "../route/worldMap.js";
import { gymOfRoute } from "../workout/gymSpots.js";
import { PRESETS } from "../workout/presets.js";
import { statueRows, venueRoute } from "../workout/venues.js";
import { DEFAULT_BIOME } from "../view3d/biomes/index.js";

/** Routes on one map share a world; a route without a map is a world of its own. */
const mapOf = (route) => route.map?.id ?? `route:${route.id}`;

/** The distinct exercises of a plan in order: what its figure chips count. */
const planFigures = (plan) => [...new Set(plan.blocks.filter((b) => b.kind === "exercise").map((b) => b.exercise))];

/** What a built world is for: one route in one biome. */
const buildKey = (routeId, biome) => `${routeId}\0${biome}`;

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
  #viewBiome = null;
  /** The scene's overview, for per-view lenses. */
  #overview = null;
  /** Lenses by camera view, built once per overview. */
  #lenses = null;
  /** The outdoor gyms of the world on screen. */
  #gyms = [];
  /** The picked workout and the figure whose statue is shown (null: the gym). */
  #workout = null;
  /** The café nodes of each map loaded so far, by map id. */
  #cafes = new Map();
  /** The statue override on screen: `{gym, plan}` or null; undefined before any rows were set. */
  #statuesApplied = undefined;
  #camera = null;
  /** The route whose world is being built. */
  #buildingKey = null;
  #buildTimer = null;
  #frame = null;
  #lastTime = null;
  #stopped = false;
  #paused = false;

  /**
   * @param {object} deps
   * @param {(id: string) => Promise<object>} deps.fetchRouteFile
   * @param {(mapId: string) => Promise<object>} [deps.fetchNetwork] a map's road network file (#26)
   * @param {(file: object, others: object[], options: {network: object | null, biome?: string}) => Promise<object>} [deps.buildScene] without it, no 3D (map only)
   * @param {() => string} [deps.biome] the rider's biome, when the world is built
   * @param {(route: RouteGeometry, scene: object) => object} [deps.createView] a View3D on the menu canvas
   * @param {(viewKind: "island" | "route" | "gym", overview: object) => object} [deps.lensFor] the lens for each camera view (the gym orbit flies low and needs a nearer plane)
   * @param {(overview: object) => object} [deps.createCamera] a MenuCamera
   * @param {(route: RouteGeometry, others: RouteGeometry[]) => object[]} [deps.highlights] bands for `setHighlights`
   * @param {(stage: {route: RouteGeometry | null, routes: RouteGeometry[], network?: object | null}) => void} deps.onRoute map and profile of the pick
   * @param {() => void} [deps.onCafes] café names became known
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
      onCafes: () => {},
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

  /** The biome the next world is built in (the rider's pick). */
  #biome() {
    return this.deps.biome?.() ?? DEFAULT_BIOME;
  }

  /**
   * The rider picked another biome: rebuild the world behind the menu. The one
   * on screen stays until the new one is ready.
   */
  biomeChanged() {
    if (this.#stopped) return Promise.resolve();
    return this.select(this.#routes, this.#selectedId, { force: true });
  }

  /**
   * Shows `selectedId` out of the server's `routes` (from /api/info). Cheap to
   * call on every menu refresh: nothing happens unless the pick changed.
   */
  async select(routes, selectedId, { force = false } = {}) {
    const listed = (routes ?? []).map((r) => r.id).join();
    if (this.#stopped || (!force && selectedId === this.#selectedId && listed === this.#routes.map((r) => r.id).join())) return;
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
        await this.#openWorkout(first.id, token, force);
        return;
      }
      this.#camera?.showIsland();
      // Changing the season rebuilds the world on screen; without one, build the first.
      if (!this.#view && first) await this.#prepare(first.id, token, { highlight: false });
      else if (force) {
        const id = this.#selectedOrFirst();
        if (id) await this.#prepare(id, token, { highlight: false });
      }
      return;
    }
    await this.#prepare(picked.id, token, { highlight: true });
  }

  /**
   * The workout tab is open: circle the gym of the picked workout's café. A world
   * on the same map has it already; any other is built for the route there.
   */
  async #openWorkout(firstId, token, force) {
    try {
      await this.#loadMap(firstId);
    } catch (error) {
      console.warn("Route preview unavailable:", error);
      return;
    }
    if (token !== this.#token || this.#stopped) return;
    // Changing the season rebuilds the world even when the gym is already on screen.
    if (this.#showWorkoutShot() && !force) return;
    await this.#prepare(this.#workoutRouteId(), token, { highlight: false });
  }

  /** Loads the route's file, the routes beside it and its map's network: where the workout venues are. */
  async #loadMap(routeId) {
    const file = await this.#file(routeId);
    const route = this.#geometry(file);
    const [others, network] = await Promise.all([
      fetchMapNeighbours(file, this.#routes, (other) => this.#file(other)),
      fetchMapNetwork(file, this.deps.fetchNetwork && ((mapId) => this.#network(mapId))),
    ]);
    for (const other of others) this.#geometry(other);
    this.#noteCafes(network);
    return { file, route, others, network };
  }

  #noteCafes(network) {
    if (!network || this.#cafes.has(network.id)) return;
    this.#cafes.set(network.id, (network.nodes ?? []).filter((node) => node.kind === "cafe"));
    this.deps.onCafes();
  }

  /** Café names by node id, of the maps loaded so far (empty before). */
  cafeNames() {
    const names = new Map();
    for (const cafes of this.#cafes.values()) for (const cafe of cafes) names.set(cafe.id, cafe.name ?? cafe.id);
    return names;
  }

  /**
   * The offered route that starts at the plan's café, or null when none is known
   * (no such route, or its file or map not loaded yet): the default route is then used.
   */
  workoutRouteId(plan) {
    const offered = this.#routes.filter((r) => r.kind === undefined).map((r) => this.#geometries.get(r.id)).filter(Boolean);
    for (const [mapId, cafes] of this.#cafes) {
      const routes = offered.filter((route) => route.map?.id === mapId).map((route) => ({ id: route.id, start: route.positionAt(0) }));
      const id = venueRoute(plan.venue, routes, cafes);
      if (id) return id;
    }
    return null;
  }

  /** The route whose world the workout tab shows: the picked workout's venue, else the first. */
  #workoutRouteId() {
    return (this.#workout && this.workoutRouteId(this.#workout.plan)) ?? this.#firstRouteId();
  }

  /**
   * The picked workout was changed (or a figure chosen): fly to its gym, or to the
   * statue of figure `figureIndex`. Remembered until the workout tab is shown.
   * @param {object} plan a workout plan with a `venue`
   * @param {number | null} [figureIndex]
   */
  async showWorkout(plan, figureIndex = null) {
    this.#workout = { plan, figure: figureIndex };
    const picked = this.#routes.find((r) => r.id === this.#selectedId);
    const first = this.#firstRouteId();
    if (this.#stopped || picked?.kind !== "workout" || !first) return;
    await this.#openWorkout(first, ++this.#token, false);
  }

  async #prepare(id, token, { highlight }) {
    let file;
    let others;
    let network;
    const biome = this.#biome();
    try {
      file = await this.#file(id);
      [others, network] = await Promise.all([
        fetchMapNeighbours(file, this.#routes, (other) => this.#file(other)),
        fetchMapNetwork(file, this.deps.fetchNetwork && ((mapId) => this.#network(mapId))),
      ]);
      this.#noteCafes(network);
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
    if (!this.uses3d || (this.#viewRouteId === id && this.#viewBiome === biome) || this.#buildingKey === buildKey(id, biome)) return;
    // The first world right away; later ones once the pick has settled and the camera
    // has landed: swapping worlds stalls the main thread, which mid-glide shows as a hitch.
    this.deps.clearTimer(this.#buildTimer);
    const build = () => {
      if (this.#camera?.flying) this.#buildTimer = this.deps.setTimer(build, this.deps.landingCheckMs);
      else this.#build(id, biome, file, others, network);
    };
    if (this.#view || this.#buildingKey) this.#buildTimer = this.deps.setTimer(build, this.deps.rebuildDelayMs);
    else build();
  }

  async #build(id, biome, file, others, network) {
    const key = buildKey(id, biome);
    if (this.#stopped || this.#selectedOrFirst() !== id || this.#biome() !== biome) return;
    this.#buildingKey = key;
    let scene;
    try {
      scene = await this.deps.buildScene(file, others, { network, biome });
    } catch (error) {
      console.warn("Menu world unavailable:", error);
      scene = null;
    }
    if (this.#buildingKey === key) this.#buildingKey = null;
    if (!scene || this.#stopped || this.#selectedOrFirst() !== id || this.#biome() !== biome) return;
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
    this.#viewBiome = biome;
    this.#viewMap = mapOf(route);
    this.#gyms = scene.gyms ?? [];
    this.#overview = scene.overview ?? null;
    this.#lenses = null;
    this.#statuesApplied = undefined;
    const picked = this.#routes.find((r) => r.id === this.#selectedId);
    this.#applyStatues(picked?.kind === "workout" ? this.#workoutPlace().override : null);
    if (picked && picked.kind === undefined) this.#show(route, others.map((f) => this.#geometry(f)));
    else if (picked?.kind === "workout") this.#showWorkoutShot();
    // The studio (or nothing picked): the island orbit, also out of the camera's opening shot.
    else this.#camera.showIsland();
    this.#applyLens();
    this.deps.onWorld(true);
    this.#loop();
  }

  #selectedOrFirst() {
    const picked = this.#routes.find((r) => r.id === this.#selectedId);
    if (picked && picked.kind === undefined) return picked.id;
    if (picked?.kind === "workout") return this.#workoutRouteId();
    return this.#viewRouteId ?? this.#routes.find((r) => r.kind === undefined)?.id ?? null;
  }

  #firstRouteId() {
    return this.#routes.find((r) => r.kind === undefined)?.id ?? null;
  }

  /**
   * The gym of the picked workout in the world on screen, and the statue override
   * that shows the workout's figures there when no route starts at its café.
   */
  #workoutPlace() {
    const plan = this.#workout?.plan ?? null;
    const venueId = plan ? this.workoutRouteId(plan) : null;
    const route = this.#geometries.get(venueId ?? this.#firstRouteId());
    const gym = route && mapOf(route) === this.#viewMap ? gymOfRoute(this.#gyms, route) : null;
    return { gym, override: plan && venueId === null && gym ? { gym, plan } : null };
  }

  /** Sets the statue rows on the view on screen, unless it already shows these. */
  #applyStatues(override) {
    if (!this.#view) return;
    const before = this.#statuesApplied;
    if (before !== undefined && before?.gym === override?.gym && before?.plan === override?.plan) return;
    this.#statuesApplied = override;
    this.#view.setStatues(statueRows(this.#gyms, PRESETS, override));
  }

  /**
   * Circles the picked workout's gym, or looks at its figure's statue, when the
   * world on screen has it (the route's own, or another on its map); else the
   * island. Returns whether it does.
   */
  #showWorkoutShot() {
    if (!this.#view || !this.#camera) return false;
    const { gym, override } = this.#workoutPlace();
    this.#applyStatues(override);
    if (!gym) this.#camera.showIsland();
    else {
      // The chip counts the plan's own figures; the row may hold more (other presets at the café).
      const figure = this.#workout?.figure ?? null;
      const exercise = figure === null ? null : planFigures(this.#workout.plan)[figure];
      const row = statueRows(this.#gyms, PRESETS, override).find((r) => r.gym === gym);
      const index = exercise && row ? row.figures.indexOf(exercise) : -1;
      const target = index < 0 ? undefined : this.#view.statueTargets(gym)[index];
      if (target) this.#camera.showStatue(target);
      else this.#camera.showGym(gym);
    }
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
    this.#applyStatues(null);
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
   * Stops the menu. Returns the 3D view if it was built for `routeId`, or for
   * any route of the map `map` (the world is per map; the ride switches its
   * route), ready for the ride: no highlights, nothing else holds it. Else null.
   */
  takeView(routeId, map = null) {
    this.#stopped = true;
    this.deps.clearTimer(this.#buildTimer);
    if (this.#frame !== null) this.deps.cancelFrame(this.#frame);
    this.#frame = null;
    const view = this.#view;
    this.#view = null;
    if (!view) return null;
    view.setHighlights([]);
    const sameWorld = this.#viewRouteId === routeId || (map !== null && map === this.#viewMap);
    if (sameWorld && this.#viewBiome === this.#biome()) return view;
    view.dispose();
    return null;
  }

  stop() {
    this.takeView(null);
    this.deps.onWorld(false);
  }
}
