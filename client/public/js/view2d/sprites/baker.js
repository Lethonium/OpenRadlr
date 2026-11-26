/**
 * Renders the real 3D assets once into canvases, the sprites the 2D views draw. The only module of view2d
 * that uses Three.js. The camera is orthographic: from the right of the road and slightly above for the
 * side view (no ground shadow, it reads as a slab edge-on), straight down for the top view (world x to
 * the right, z down, with the asset's real shadow on a catcher ground, so the map draws it unrotated).
 * `createRenderer` and `createCanvas` are injected so tests run without WebGL.
 */
import * as THREE from "../../three.js";
import { qualitySettings } from "../../view3d/quality.js";
import { createWorldScene } from "../../view3d/scene/worldScene.js";
import { createTracker } from "../../view3d/scene/tracker.js";
import { environmentAt, resolvePreset } from "../../world/daylight.js";
import { WORKBENCH_ASSETS, groundAsset } from "../../workbenchState.js";

/** The longest side of a baked frame, in pixels. */
const MAX_PIXELS = 512;
/** Side view: how far the camera stands from the asset (m) and how far above the road it looks (rad). */
const SIDE_DISTANCE = 400;
const SIDE_PITCH = 0.16;
/** Top view: how far above the asset's top the camera hangs (m). */
const TOP_HEIGHT = 50;
/** The shadow catcher's side as a multiple of the asset's reach, its darkness, the sun's shadow box as a multiple of it. */
const CATCHER_REACH = 2.6;
const CATCHER_OPACITY = 0.32;
const SHADOW_BOX_REACH = 1.5;

/** The baker could not start: no renderer (no WebGL2, context lost). The views then fall back to the old map. */
export class SpriteBakerUnavailable extends Error {
  constructor(cause) {
    super(`sprite baker unavailable: ${cause?.message ?? cause}`); // i18n-ok: developer error
    this.name = "SpriteBakerUnavailable";
    this.cause = cause;
  }
}

const defaultCanvas = () => document.createElement("canvas");

function defaultRenderer(canvas) {
  return new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
}

/**
 * @param {{season: string, createRenderer?: (canvas: object) => object, createCanvas?: () => object}} options
 * @returns {{bake: (job: import("./catalog.js").SpriteJob) => {frames: object[], ox: number, oy: number, ppm: number, bytes: number}, liveResources: () => number, dispose: () => void}}
 */
export function createSpriteBaker({ season, createRenderer = defaultRenderer, createCanvas = defaultCanvas }) {
  const canvas = createCanvas();
  let renderer;
  try {
    renderer = createRenderer(canvas);
  } catch (error) {
    throw new SpriteBakerUnavailable(error);
  }
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setClearColor(0x000000, 0);

  const tracker = createTracker();
  const world = createWorldScene({ season }, { settings: qualitySettings("high"), track: tracker.track });
  for (const child of world.scene.children) if (["sky", "clouds", "weather"].includes(child.name)) child.visible = false;
  const fog = world.scene.fog; // the world's environment sets its colour; sprites are drawn without it
  world.scene.fog = null;
  const catcher = new THREE.Mesh(tracker.track(new THREE.PlaneGeometry(1, 1)), tracker.track(new THREE.ShadowMaterial({ opacity: CATCHER_OPACITY })));
  catcher.name = "shadowCatcher";
  catcher.rotation.x = -Math.PI / 2;
  catcher.receiveShadow = true;
  world.scene.add(catcher);
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 2000);

  let lit = null;
  /**
   * Lights the scene; only changes when the job's time differs from the last one. A night sprite is lit as by day
   * with the night's lamps on (windows glow, the moon is not blue): the map and side view darken it with the
   * shared night tint, as they do the ground, so the two do not stack.
   */
  function light(night) {
    if (lit === night) return;
    lit = night;
    const day = environmentAt(resolvePreset("day"), season);
    const environment = night ? { ...day, night: 1, moon: day.sun } : day;
    world.scene.fog = fog;
    world.setEnvironment(environment);
    world.scene.fog = null;
    renderer.toneMappingExposure = environment.exposure;
  }

  /** Aims the camera at `box` and returns the frustum in camera space, padded for the shadow. */
  function frame(job, box, size, center, reach) {
    if (job.view === "top") {
      camera.position.set(center.x, box.max.y + TOP_HEIGHT, center.z);
      camera.up.set(0, 0, -1);
      camera.lookAt(center.x, 0, center.z);
    } else {
      camera.position.set(center.x, center.y + Math.sin(SIDE_PITCH) * SIDE_DISTANCE, center.z + Math.cos(SIDE_PITCH) * SIDE_DISTANCE);
      camera.up.set(0, 1, 0);
      camera.lookAt(center);
    }
    camera.updateMatrixWorld(true);
    const pad = job.view === "top" ? Math.min(size.y * 0.9, reach * 0.3) : size.y * 0.05;
    let [x0, x1, y0, y1] = [Infinity, -Infinity, Infinity, -Infinity];
    for (const x of [box.min.x - pad, box.max.x + pad]) {
      for (const y of [0, box.max.y]) {
        for (const z of [box.min.z - pad, box.max.z + pad]) {
          const p = new THREE.Vector3(x, y, z).applyMatrix4(camera.matrixWorldInverse);
          [x0, x1, y0, y1] = [Math.min(x0, p.x), Math.max(x1, p.x), Math.min(y0, p.y), Math.max(y1, p.y)];
        }
      }
    }
    return { x0, x1, y0, y1 };
  }

  return {
    /** Renders one job. A failing job throws (the caller skips and logs it); the asset is disposed either way. */
    bake(job) {
      const entry = WORKBENCH_ASSETS[job.id];
      if (!entry) throw new Error(`no asset ${job.id}`);
      light(job.night);
      const asset = entry.create({ ...job.options, season, track: tracker.track, uniforms: world.uniforms });
      const object = asset.object;
      try {
        groundAsset(object);
        object.rotation.y = job.yaw;
        object.updateMatrixWorld(true);
        world.scene.add(object);
        object.traverse((child) => {
          if (child.isMesh) child.castShadow = true;
        });
        const box = new THREE.Box3().setFromObject(object);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());
        const reach = Math.max(size.x, size.y, size.z);
        catcher.scale.setScalar(reach * CATCHER_REACH);
        catcher.visible = job.view === "top";
        const { x0, x1, y0, y1 } = frame(job, box, size, center, reach);
        let scale = job.ppm;
        const longest = Math.max((x1 - x0) * scale, (y1 - y0) * scale);
        if (longest > MAX_PIXELS) scale *= MAX_PIXELS / longest;
        const width = Math.max(2, Math.ceil((x1 - x0) * scale));
        const height = Math.max(2, Math.ceil((y1 - y0) * scale));
        Object.assign(camera, { left: x0, right: x1, top: y1, bottom: y0 });
        camera.updateProjectionMatrix();
        renderer.setSize(width, height, false);
        const origin = new THREE.Vector3(0, 0, 0).applyMatrix4(camera.matrixWorldInverse);
        const frames = [];
        for (let f = 0; f < job.frames; f += 1) {
          if (f > 0) asset.update?.(job.dt, f * job.dt);
          world.update({ dt: 0, t: 0, camera, focus: center.toArray(), shadowHalf: reach * SHADOW_BOX_REACH });
          renderer.render(world.scene, camera);
          const copy = createCanvas();
          copy.width = width;
          copy.height = height;
          copy.getContext("2d").drawImage(canvas, 0, 0);
          frames.push(copy);
        }
        return { frames, ox: (origin.x - x0) * scale, oy: (y1 - origin.y) * scale, ppm: scale, bytes: width * height * 4 * frames.length };
      } finally {
        world.scene.remove(object);
        asset.dispose();
      }
    },
    /** Tracked Three.js resources not disposed yet: unchanged by a bake, 0 after `dispose`. */
    liveResources: () => tracker.live(),
    dispose() {
      world.dispose();
      tracker.disposeAll();
      renderer.dispose();
      // A disposed renderer keeps its WebGL context until the garbage collector runs; browsers allow only a few.
      renderer.forceContextLoss?.();
    },
  };
}
