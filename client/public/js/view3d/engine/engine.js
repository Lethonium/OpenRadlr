/**
 * One engine per canvas. It owns the `WebGLRenderer`, the scene target the
 * scene draws into, and the post chain that
 * presents it. Views on the same canvas (menu, ride, studio, gym) share it;
 * a view never disposes it.
 */
import * as THREE from "../../three.js";
import { qualitySettings } from "../quality.js";
import { createPost } from "./post.js";

const engines = new WeakMap();

const defaultRenderer = (canvas) => new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });

/** The scene target: half-float HDR with a depth texture the post chain reads. */
function sceneTarget(width, height, samples) {
  const depthTexture = new THREE.DepthTexture(width, height);
  return new THREE.WebGLRenderTarget(width, height, { type: THREE.HalfFloatType, samples, depthTexture });
}

export class Engine {
  #createPost;
  #onDispose;
  #post = null;
  #disposed = false;

  /**
   * @param {HTMLCanvasElement | null} canvas
   * @param {{createRenderer?: (canvas: HTMLCanvasElement | null) => object,
   *   createPost?: typeof createPost}} [deps]
   * @param {() => void} [onDispose]
   */
  constructor(canvas, { createRenderer = defaultRenderer, createPost: makePost = createPost } = {}, onDispose = () => {}) {
    this.canvas = canvas;
    this.#createPost = makePost;
    this.#onDispose = onDispose;
    this.renderer = createRenderer(canvas);
    this.renderer.autoClear = false;
    // A frame is several render calls: `info` counts from `beginFrame` on, so `frameStats` sees the whole frame.
    if (this.renderer.info) this.renderer.info.autoReset = false;
    // The world's sun casts soft shadows; a level without a shadow map just leaves `castShadow` off.
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // Sizes are CSS pixels; the ratio scales the drawing buffer.
    this.renderer.setPixelRatio(1);
    this.settings = qualitySettings("high");
    this.size = { width: Math.max(1, canvas?.width ?? 1), height: Math.max(1, canvas?.height ?? 1) };
    this.target = sceneTarget(this.size.width, this.size.height, this.settings.msaa);
    this.#post = this.#createPost(this.renderer, this.target, this.settings);
    this.clearColor = new THREE.Color(0, 0, 0);
  }

  /**
   * Sizes the canvas, the scene target and the chain in device pixels.
   * @param {number} width CSS pixels
   * @param {number} height CSS pixels
   * @param {number} [pixelRatio]
   */
  resize(width, height, pixelRatio = 1) {
    const deviceWidth = Math.max(1, Math.round(width * pixelRatio));
    const deviceHeight = Math.max(1, Math.round(height * pixelRatio));
    if (deviceWidth === this.size.width && deviceHeight === this.size.height) return;
    this.size = { width: deviceWidth, height: deviceHeight };
    this.renderer.setSize(deviceWidth, deviceHeight, false);
    this.target.setSize(deviceWidth, deviceHeight);
    this.#post?.setSize(deviceWidth, deviceHeight);
  }

  /**
   * Applies a quality level: the target's samples and the chain are rebuilt.
   * @param {import("../quality.js").QualitySettings} settings
   */
  setQuality(settings) {
    if (settings === this.settings) return;
    this.settings = settings;
    this.#post?.dispose();
    this.target.samples = settings.msaa;
    this.target.dispose();
    this.#post = this.#createPost(this.renderer, this.target, settings);
    this.#post?.setSize(this.size.width, this.size.height);
  }

  /** Binds the scene target and clears it; the scene is then drawn into it. */
  beginFrame() {
    const { renderer, target } = this;
    renderer.setRenderTarget(target);
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, this.size.width, this.size.height);
    renderer.setClearColor(this.clearColor, 1);
    renderer.clear(true, true, true);
    renderer.info?.reset();
  }

  /** Draw calls and triangles since the last `beginFrame` (the dev `?stats` readout). */
  frameStats() {
    const render = this.renderer.info?.render;
    return { calls: render?.calls ?? 0, triangles: render?.triangles ?? 0 };
  }

  /**
   * Renders a scene into the scene target, optionally only inside `rect`
   * (device pixels from the bottom left), which is cleared first.
   * @param {import("../../three.js").Scene} scene
   * @param {import("../../three.js").Camera} camera
   * @param {{x: number, y: number, width: number, height: number}} [rect]
   */
  renderScene(scene, camera, rect) {
    const { renderer, target, size } = this;
    // The target's own viewport and scissor, not the renderer's: a shadow pass inside `render` hands the target back
    // with `setRenderTarget(target)`, which restores these and would draw a rectangle over the whole frame.
    const area = rect ?? { x: 0, y: 0, width: size.width, height: size.height };
    target.viewport.set(area.x, area.y, area.width, area.height);
    target.scissor.set(area.x, area.y, area.width, area.height);
    target.scissorTest = Boolean(rect);
    renderer.setRenderTarget(target);
    if (rect) {
      renderer.setScissorTest(true);
      renderer.setScissor(rect.x, rect.y, rect.width, rect.height);
      renderer.setViewport(rect.x, rect.y, rect.width, rect.height);
      // The rectangle replaces what was drawn there (a workout's inset over the main view).
      renderer.clear(true, true, true);
    } else {
      renderer.setScissorTest(false);
      renderer.setViewport(0, 0, size.width, size.height);
    }
    renderer.render(scene, camera);
    renderer.setScissorTest(false);
    target.viewport.set(0, 0, size.width, size.height);
    target.scissor.set(0, 0, size.width, size.height);
    target.scissorTest = false;
  }

  /**
   * Runs the post chain to the screen: tone mapping and grade use the environment's exposure.
   * @param {import("../../three.js").PerspectiveCamera} camera
   * @param {{exposure: number}} env
   * @param {{ride?: boolean, height?: number}} [view] `height` is the camera's height above the rider, metres
   */
  present(camera, env, view = {}) {
    const { renderer } = this;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = env.exposure;
    renderer.setRenderTarget(null);
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, this.size.width, this.size.height);
    this.#post?.render(camera, env, view);
  }

  /** Releases the chain, the target and the renderer. Safe to call twice. */
  dispose() {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#post?.dispose();
    this.#post = null;
    this.target.dispose();
    this.renderer.dispose();
    this.#onDispose();
  }
}

/**
 * The engine of a canvas, made on first use.
 * @param {HTMLCanvasElement} canvas
 * @param {ConstructorParameters<typeof Engine>[1]} [deps] only used when the engine is made
 * @returns {Engine}
 */
export function engineFor(canvas, deps) {
  let engine = engines.get(canvas);
  if (!engine) {
    engine = new Engine(canvas, deps, () => engines.delete(canvas));
    engines.set(canvas, engine);
  }
  return engine;
}
