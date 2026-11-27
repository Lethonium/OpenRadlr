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
import { createBoardLayer } from "./boardLayer.js";
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
 * @property {{position: number[], yaw: number, slot: 0|1}[]} [goalBoards] the goal boards out, at most two, `position` the base of the board (none when missing)
 * @property {{floors: number, open: number}} [studio] the spin studio's storeys and how many are lit (none when missing: the building stays as it was)
 * @property {{gym: object, index: number} | null} [statueGlow] the statue plinth to light (none when missing)
 */

/**
 * Builds the scene for a built world.
 * @param {{ground?: {near: object, far: object}, roads?: object, rivers?: object, plan?: import("../../world/plan/index.js").WorldPlan, season?: string}} world the scene object from `buildScene`
 * @param {{settings: import("../quality.js").QualitySettings, track: import("./tracker.js").Tracker["track"]}} options
 */
export function createWorldScene(world, { settings, track }) {
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
  /** The last board posters (`{atlas, slotOf, slotCount}`) and goal canvas, sent again to a rebuilt layer. */
  let boardPosters = null;
  let goalPosters = null;
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
    boards: () => createBoardLayer(world, plants()),
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
  layers.push(makers.arches(), makers.furniture(), makers.boards(), makers.venues(), ...(world.studio ? [makers.studio()] : []), makers.riders(), makers.athletes(), makers.statues(), makers.crowd(), makers.lemons(), makers.highlight(), makers.clouds(), makers.weather(), makers.nightLights());
  for (const layer of layers) scene.add(layer.object);

  /** Replaces the named layers with new ones built from the current settings, season and plan. */
  const rebuild = (...names) => {
    for (const name of names) {
      const at = layers.findIndex((layer) => layer.object.name === name);
      if (at < 0) continue;
      scene.remove(layers[at].object);
      layers[at].dispose();
      layers[at] = makers[name]();
      if (name === "statues" && statueRows.length) layers[at].setRows(statueRows);
      if (name === "highlight" && highlightBands.length) layers[at].setBands(highlightBands);
      if (name === "boards") {
        if (boardPosters) layers[at].setPosters(boardPosters.atlas, boardPosters.slotOf, boardPosters.slotCount);
        if (goalPosters) layers[at].setGoalPosters(goalPosters);
      }
      scene.add(layers[at].object);
      if (environment) layers[at].setEnvironment(environment);
    }
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
    rebuild("islands", "forest", "crops", "roadside", "landRows", "scrub", "fieldEdges", "grass", "settlements", "farms", "landmarks", "fauna", "arches", "furniture", "boards", "venues", "studio", "riders", "athletes", "statues", "crowd", "lemons", "highlight", "clouds", "weather", "nightLights");
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
    /** The poster atlas canvas and, per board of `world.boards`, its slot in it. */
    setBoardPosters(atlas, slotOf, slotCount) {
      boardPosters = { atlas, slotOf, slotCount };
      named("boards").setPosters(atlas, slotOf, slotCount);
    },
    /** The canvas with the two goal posters side by side (slot 0 left, slot 1 right). */
    setGoalPosters(canvas) {
      goalPosters = canvas;
      named("boards").setGoalPosters(canvas);
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
      for (const layer of layers) layer.dispose();
      scene.clear();
      disposeAll();
    },
  };
}
