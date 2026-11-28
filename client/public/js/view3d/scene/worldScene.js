/**
 * The world as one Three.js scene: terrain, sea and sky layers, a hemisphere
 * light and the sun (or, at night, the moon) with a shadow box that follows
 * the camera's focus. It owns no look of its own: colours and directions
 * arrive through `setEnvironment`, positions through `update`.
 */
import * as THREE from "../../three.js";
import { createGrainTexture, createSharedUniforms } from "../assets/materials.js";
import { createSea } from "./sea.js";
import { NATURE } from "../assets/nature/index.js";
import { createCloudLayer } from "./cloudLayer.js";
import { createCropLayer } from "./cropLayer.js";
import { createForestLayer } from "./forestLayer.js";
import { createFaunaLayer } from "./faunaLayer.js";
import { resolveBiome } from "../biomes/index.js";
import { createArchLayer } from "./archLayer.js";
import { createCrowdLayer } from "./crowdLayer.js";
import { createFurnitureLayer } from "./furnitureLayer.js";
import { createAthleteLayer } from "./athleteLayer.js";
import { createLemonLayer } from "./lemonLayer.js";
import { createVenueLayer } from "./venueLayer.js";
import { createStudioBuildingLayer } from "./studioBuildingLayer.js";
import { createHighlightLayer } from "./highlightLayer.js";
import { createStatueLayer } from "./statueLayer.js";
import { createRiderLayer } from "./riderLayer.js";
import { createFarmLayer } from "./farmLayer.js";
import { createGrassLayer } from "./grassLayer.js";
import { createIslandLayer } from "./islandLayer.js";
import { createNightLights } from "./nightLights.js";
import { createLandmarkLayer } from "./landmarkLayer.js";
import { createRiverLayer } from "./riverLayer.js";
import { createRoadLayer } from "./roadLayer.js";
import { createFieldEdgeLayer } from "./fieldEdgeLayer.js";
import { createLandRowLayer } from "./landRowLayer.js";
import { createScrubLayer } from "./scrubLayer.js";
import { createRoadsideLayer } from "./roadsideLayer.js";
import { createSettlementLayer } from "./settlementLayer.js";
import { createSky } from "./sky.js";
import { createTerrainLayer } from "./terrainLayer.js";
import { createWeatherLayer } from "./weatherLayer.js";
import { createOwner } from "./tracker.js";

/** Sun placement and shadow box, in metres. */
export const SUN = Object.freeze({ distance: 1800, shadowHalf: 130, near: 10, far: 4000, bias: -0.00025, normalBias: 0.35 });
/**
 * Layers whose objects stay where they were built (their updates only show and hide chunks): their world matrices are
 * worked out once, and Three's walk over every object each frame skips them (the forest alone has thousands).
 */
const STATIC_LAYERS = new Set(["forest", "roadside", "scrub", "landRows", "fieldEdges"]);
/** Fixes a static layer's world matrices where it was built; any other layer is left as it is. */
const settle = (layer) => {
  if (!STATIC_LAYERS.has(layer.object.name)) return layer;
  layer.object.updateMatrixWorld(true);
  layer.object.matrixWorldAutoUpdate = false;
  return layer;
};
/** The layers the workout's side view keeps: backdrop, ground and my athlete. */
const SIDE_VIEW_LAYERS = new Set(["sky", "sea", "terrain", "athletes"]);
/** How much of the sun's colour shows through thin leaves and blades. */
const SUN_THROUGH = 0.55;
/** Strength of the drifting cloud shadows by day. */
const CLOUD_SHADOW = 0.24;
/** How much a lightning bolt adds to the hemisphere's light at its peak. */
const LIGHTNING = 3;

/**
 * @typedef {object} Frame
 * @property {number} dt seconds since the last frame
 * @property {number} t seconds on the scene's clock
 * @property {number} [utcSeconds] wall-clock seconds, passed in by the view (nothing here reads a clock)
 * @property {import("../../three.js").Camera} camera
 * @property {number[]} focus world point the shadow box is centred on
 * @property {number[]} [heading] the rider's unit forward on the ground, [x, z] (the headlight aims along it)
 * @property {number} [shadowHalf] half the shadow box's edge, metres
 * @property {boolean} [shadows] false switches the sun's shadow off for this frame (the drone)
 * @property {import("./riderLayer.js").RiderEntry[]} [riders] the road riders to draw (none when missing)
 * @property {import("./athleteLayer.js").AthleteEntry[]} [athletes] the gym athletes to draw (none when missing)
 * @property {import("./riderLayer.js").VehicleEntry[]} [vehicles] the shared vehicles with their seated riders (none when missing)
 * @property {{index: number, yaw: number, lift: number, pose: boolean, flagSwing: number}[]} [crowd] the spectators out, `index` into `world.crowd.people` (none when missing)
 * @property {{position: number[], yaw: number}[]} [lemons] the golden lemons to draw, `position` their centre (none when missing)
 * @property {{floors: number, open: number}} [studio] the spin studio's storeys and how many are lit (none when missing: the building stays as it was)
 * @property {{gym: object, index: number} | null} [statueGlow] the statue plinth to light (none when missing)
 */

/**
 * Builds the scene for a built world.
 * @param {{ground?: {near: object, far: object}, roads?: object, rivers?: object, plan?: import("../../world/plan/index.js").WorldPlan, season?: string}} world the scene object from `buildScene`
 * @param {{settings: import("../quality.js").QualitySettings, track: import("./tracker.js").Tracker["track"],
 *   stage?: boolean | {budgetMs?: number, now?: () => number}}} options `stage` rebuilds a new level's or season's layers
 *   over several frames (`budgetMs` of building per frame, at least one layer; `now` the clock in ms) while the old ones
 *   are still drawn, then swaps them in together, once `setWarm`'s compile has their shaders ready; without it a
 *   rebuild happens in the call
 */
export function createWorldScene(world, { settings, track, stage = false }) {
  const { own, disposeAll } = createOwner(track);
  const uniforms = createSharedUniforms();
  const grain = own(createGrainTexture());
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0xffffff, 0.0002);

  let current = settings;
  let season = world.season ?? "summer";
  let plan = world.plan;
  let environment = null;
  let flash = 0;
  /** The last statue rows, sent again to a rebuilt layer. */
  let statueRows = [];
  /** The last highlight bands, sent again to a rebuilt layer. */
  let highlightBands = [];
  const plants = () => ({ settings: current, season, uniforms, track });
  /** How each rebuildable layer is made, by the name of its object. */
  const makers = {
    terrain: () => createTerrainLayer(world.ground, { uniforms, settings: current, track, grain, plan }),
    forest: () => createForestLayer(plan, { ...plants(), assets: NATURE }),
    crops: () => createCropLayer(plan, { ...plants(), ground: world.ground }),
    roadside: () => createRoadsideLayer(plan, { ...plants(), assets: NATURE }),
    fieldEdges: () => createFieldEdgeLayer(plan, { ...plants(), assets: NATURE }),
    landRows: () => createLandRowLayer(plan, { ...plants(), assets: NATURE }),
    scrub: () => createScrubLayer(plan, { ...plants(), assets: NATURE }),
    grass: () => createGrassLayer(world.ground, plan, plants()),
    settlements: () => createSettlementLayer(plan, { ...plants(), grain, ground: world.ground }),
    farms: () => createFarmLayer(plan, { ...plants(), grain, ground: world.ground }),
    landmarks: () => createLandmarkLayer(plan, { ...plants(), grain }),
    islands: () => createIslandLayer(plan, plants()),
    fauna: () => createFaunaLayer(plan, { ...plants(), ground: world.ground }),
    arches: () => createArchLayer(world, { ...plants(), biome: resolveBiome(world.biome) }),
    furniture: () => createFurnitureLayer(world, { ...plants(), biome: resolveBiome(world.biome) }),
    venues: () => createVenueLayer(world, { ...plants(), biome: resolveBiome(world.biome) }),
    studio: () => createStudioBuildingLayer(world.studio, plants()),
    riders: () => createRiderLayer(plants()),
    athletes: () => createAthleteLayer(plants()),
    statues: () => createStatueLayer(plants()),
    crowd: () => createCrowdLayer(world, plants()),
    lemons: () => createLemonLayer(plants()),
    highlight: () => createHighlightLayer(plants()),
    clouds: () => createCloudLayer(world.clouds, plants()),
    weather: () => createWeatherLayer(plants()),
    nightLights: () => createNightLights(plan, { ...plants(), ground: world.ground }),
  };
  const layers = [createSky({ uniforms, track })];
  if (world.ground) {
    uniforms.fogBase.value = world.ground.near.water;
    layers.push(createSea(world.ground, { uniforms, track }), makers.terrain());
    if (plan) layers.push(makers.islands(), makers.forest(), makers.crops(), makers.roadside(), makers.landRows(), makers.scrub(), makers.fieldEdges(), makers.grass(), makers.settlements(), makers.farms(), makers.landmarks(), makers.fauna());
  }
  if (world.roads) layers.push(createRoadLayer(world.roads, { uniforms, track }));
  if (world.rivers) layers.push(createRiverLayer(world.rivers, { uniforms, track }));
  layers.push(makers.arches(), makers.furniture(), makers.venues(), ...(world.studio ? [makers.studio()] : []), makers.riders(), makers.athletes(), makers.statues(), makers.crowd(), makers.lemons(), makers.highlight(), makers.clouds(), makers.weather(), makers.nightLights());
  for (const layer of layers) scene.add(settle(layer).object);

  /** A new layer `name` from the current settings, season and plan, given the rows, bands and light of now. */
  const make = (name) => {
    const layer = settle(makers[name]());
    if (name === "statues" && statueRows.length) layer.setRows(statueRows);
    if (name === "highlight" && highlightBands.length) layer.setBands(highlightBands);
    if (environment) layer.setEnvironment(environment);
    return layer;
  };
  /** Puts `layer` in the place of the layer of the same name, freeing the old one. */
  const replace = (name, layer) => {
    const at = layers.findIndex((entry) => entry.object.name === name);
    if (at < 0) return layer.dispose();
    scene.remove(layers[at].object);
    layers[at].dispose();
    layers[at] = layer;
    scene.add(layer.object);
    // Rows, bands or light may have changed since it was built.
    if (name === "statues" && statueRows.length) layer.setRows(statueRows);
    if (name === "highlight" && highlightBands.length) layer.setBands(highlightBands);
    if (environment) layer.setEnvironment(environment);
  };
  const staging = stage ? { budgetMs: stage.budgetMs ?? 6, now: stage.now ?? (() => globalThis.performance.now()) } : null;
  /** A staged rebuild under way: the layers still to build, those built, and the shaders' warm-up once all are. */
  let pending = null;
  /** Compiles a root's shaders ahead (`setWarm`); null swaps a staged rebuild in as soon as it is built. */
  let warmRoot = null;

  /** Replaces the named layers with new ones built from the current settings, season and plan. */
  const rebuild = (...names) => {
    const present = names.filter((name) => layers.some((layer) => layer.object.name === name));
    if (!staging) {
      for (const name of present) replace(name, make(name));
      return;
    }
    // What a rebuild under way has built used the settings before this change: it starts over, with every name.
    // The night lights go first, so every layer after them is warmed lit as it will be.
    const all = [...new Set([...(pending?.names ?? []), ...present])].sort((a, b) => (b === "nightLights") - (a === "nightLights"));
    if (pending) for (const layer of pending.built.values()) layer.dispose();
    pending = all.length ? { names: all, queue: [...all], built: new Map(), warming: [] } : null;
  };

  /**
   * Builds the next layers of a staged rebuild within the frame's budget, each warmed as soon as it is built (so the
   * compiling is spread over the frames too); swaps them all in once every one is built and warm.
   */
  const buildStaged = () => {
    if (!pending || pending.queue.length === 0) return;
    const start = staging.now();
    do {
      const name = pending.queue.shift();
      const layer = make(name);
      pending.built.set(name, layer);
      if (warmRoot) {
        const lights = pending.built.get("nightLights") ?? named("nightLights");
        const outgoing = pending.built.has("nightLights") ? named("nightLights")?.object : null;
        pending.warming.push(warmLit(warmRoot, layer.object, lights, outgoing).catch(() => {}));
      }
    } while (pending.queue.length && staging.now() - start < staging.budgetMs);
    if (pending.queue.length) return;
    const done = pending;
    const swap = () => {
      if (pending !== done || disposed) return;
      pending = null;
      for (const [name, layer] of done.built) replace(name, layer);
    };
    if (!warmRoot) return swap();
    Promise.all(done.warming).then(swap);
  };

  const hemisphere = new THREE.HemisphereLight();
  hemisphere.name = "hemisphere";
  scene.add(hemisphere);
  const sun = own(new THREE.DirectionalLight(0xffffff, 3));
  sun.name = "sun";
  sun.shadow.bias = SUN.bias;
  sun.shadow.normalBias = SUN.normalBias;
  sun.shadow.camera.near = SUN.near;
  sun.shadow.camera.far = SUN.far;
  scene.add(sun, sun.target);

  const named = (name) => layers.find((layer) => layer.object.name === name);
  const weather = () => layers.find((layer) => layer.object.name === "weather");
  const keyDirection = new THREE.Vector3(0, 1, 0);
  let shadowSize = 0;
  let shadowsOn = true;
  let disposed = false;
  /** The layer objects the side view hid, with what they showed before; null outside the side view. */
  let hidden = null;

  /** Applies the quality's shadow map: its size, or none. */
  const setQuality = (next) => {
    const changed = next !== current;
    current = next;
    const size = next.shadowMapSize;
    if (size !== shadowSize) {
      shadowSize = size;
      sun.shadow.mapSize.set(Math.max(1, size), Math.max(1, size));
      sun.shadow.map?.dispose();
      sun.shadow.map = null;
    }
    sun.castShadow = size > 0 && shadowsOn;
    if (!changed) return;
    for (const layer of layers) layer.setQuality?.(next);
    rebuild("islands", "forest", "crops", "roadside", "landRows", "scrub", "fieldEdges", "grass", "settlements", "farms", "landmarks", "fauna", "arches", "furniture", "venues", "studio", "riders", "athletes", "statues", "crowd", "lemons", "highlight", "clouds", "weather", "nightLights");
  };
  setQuality(settings);

  /** Puts the sun on its ray from `focus`, the shadow box snapped to shadow texels so it does not shimmer. */
  const placeSun = (focus, half) => {
    const texel = shadowSize > 0 ? (2 * half) / shadowSize : 0;
    const snap = (v) => (texel > 0 ? Math.round(v / texel) * texel : v);
    sun.target.position.set(snap(focus[0]), focus[1], snap(focus[2]));
    sun.position.copy(sun.target.position).addScaledVector(keyDirection, SUN.distance);
    sun.target.updateMatrixWorld();
  };
  const lastFocus = [0, 0, 0];
  placeSun(lastFocus, SUN.shadowHalf);

  /**
   * Warms `root`'s shaders as lit now, resolving once those are ready, then, in the background, as lit in the other
   * half of the day (night by day, day by night), so dusk and dawn do not stall on the lamps' and headlight's shaders.
   * `lights` is the night-lights layer in effect for them; `outgoing`, when set, the old one it replaces (left out).
   * `warm` collects the lights while it is called, so every light is back as it was before anything is drawn.
   */
  const warmLit = async (warm, root, lights, outgoing = null) => {
    const pass = (flip) => {
      const was = outgoing?.visible;
      if (outgoing) outgoing.visible = false;
      const restore = flip && lights?.showNightState ? lights.showNightState(!lights.atNight()) : () => {};
      const compiled = warm(root);
      restore();
      if (outgoing) outgoing.visible = was;
      return compiled;
    };
    await pass(false);
    if (disposed || !lights?.showNightState) return;
    pass(true).catch(() => {});
  };

  return {
    scene,
    sun,
    /** The shared shader uniforms, for assets made outside the layers (the workbench's). */
    uniforms,
    setQuality,
    /** @param {Frame} frame */
    update(frame) {
      uniforms.time.value += frame.dt;
      shadowsOn = frame.shadows !== false;
      sun.castShadow = shadowSize > 0 && shadowsOn;
      const half = frame.shadowHalf ?? SUN.shadowHalf;
      const box = sun.shadow.camera;
      if (Math.abs(box.right - half) > 1) {
        box.left = -half;
        box.right = half;
        box.top = half;
        box.bottom = -half;
        box.updateProjectionMatrix();
      }
      uniforms.sunDirV.value.copy(keyDirection).transformDirection(frame.camera.matrixWorldInverse);
      lastFocus[0] = frame.focus[0];
      lastFocus[1] = frame.focus[1];
      lastFocus[2] = frame.focus[2];
      placeSun(lastFocus, half);
      for (const layer of layers) layer.update(frame);
      if (staging) buildStaged();
      const bolt = weather().flash ?? 0;
      if (bolt !== flash) {
        flash = bolt;
        hemisphere.intensity = (environment?.hemiIntensity ?? 1) + LIGHTNING * flash;
      }
    },
    /**
     * Rebuilds what the season colours (woods, fields, verges, towns, farms, landmarks, animals and far islands) from `plan`, freeing the old.
     * The ground's own colours were baked into the world for the season it was built in.
     */
    setSeason(next, nextPlan = plan) {
      season = next;
      plan = nextPlan;
      if (plan) rebuild("islands", "forest", "crops", "roadside", "landRows", "scrub", "fieldEdges", "settlements", "farms", "landmarks", "fauna", "venues");
    },
    /** Replaces the gyms' statue rows (`{gym, figures, material, figure}`). */
    setStatues(rows) {
      statueRows = rows;
      layers.find((layer) => layer.object.name === "statues").setRows(rows);
    },
    /** Replaces the menu's glowing route bands (`{band, glow}`, band from `buildHighlight`). */
    setHighlights(bands) {
      highlightBands = bands;
      layers.find((layer) => layer.object.name === "highlight").setBands(bands);
    },
    /** World points above each seated rider's head after the last update, for the view's name labels. */
    seatHeads: () => named("riders").seatHeads(),
    /** How far ahead of its spot the gym athlete `id`'s body lies on average (metres), 0 when not drawn. */
    athleteAhead: (id) => named("athletes").aheadOf(id),
    /**
     * Draws only gym athlete `id` over the sky and ground until called with `null` (the workout's side view shows my
     * rider alone: no plants, towns, other riders or weather between the camera and the body). `null` puts every
     * layer back exactly as it was, including those the quality had hidden.
     */
    isolateAthlete(id) {
      if (id !== null && !hidden) {
        hidden = layers.filter((layer) => !SIDE_VIEW_LAYERS.has(layer.object.name)).map((layer) => [layer.object, layer.object.visible]);
        for (const [object] of hidden) object.visible = false;
      } else if (id === null && hidden) {
        for (const [object, visible] of hidden) object.visible = visible;
        hidden = null;
      }
      named("athletes").isolate(id);
    },
    /**
     * Compiles the scene's shaders ahead with `warm` (the engine's): first as it is lit now, resolving once those are
     * ready; then, in the background, as lit in the other half of the day.
     * @param {(root: import("../../three.js").Object3D) => Promise<void>} warm
     * @returns {Promise<void>}
     */
    prepare(warm) {
      return warmLit(warm, scene, named("nightLights"));
    },
    /** How a staged rebuild compiles its new layers' shaders before they are swapped in (the engine's warm, lit by this scene). */
    setWarm(warm) {
      warmRoot = warm;
    },
    setEnvironment(env) {
      environment = env;
      uniforms.sunCol.value.setRGB(...env.sunColor).multiplyScalar((1 - env.night) * SUN_THROUGH * (env.sunShare ?? 1));
      const key = env.night ? env.moon : env.sun;
      keyDirection.fromArray(key);
      sun.color.setRGB(...env.sunColor);
      sun.intensity = env.sunIntensity;
      hemisphere.color.setRGB(...env.hemiSky);
      hemisphere.groundColor.setRGB(...env.hemiGround);
      hemisphere.intensity = env.hemiIntensity + LIGHTNING * flash;
      scene.fog.color.setRGB(...env.fogColor);
      scene.fog.density = env.fogDensity;
      uniforms.cloudShadow.value = (1 - env.night) * CLOUD_SHADOW;
      placeSun(lastFocus, sun.shadow.camera.right);
      for (const layer of layers) layer.setEnvironment(env);
    },
    dispose() {
      disposed = true;
      if (pending) for (const layer of pending.built.values()) layer.dispose();
      pending = null;
      for (const layer of layers) layer.dispose();
      scene.clear();
      disposeAll();
    },
  };
}
