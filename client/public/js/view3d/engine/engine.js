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

/** Whether the renderer checks each shader for errors (`?shaders`, for shader work); see the constructor. */
const SHADER_CHECKS = /[?&]shaders(?:[=&]|$)/.test(globalThis.location?.search ?? "");

/** Shaders put to first use per frame after a warm-up (each first use asks the driver and waits for its answer). */
const FIRST_USES_PER_FRAME = 3;

/** How long `warm` waits for the driver at most (ms): a stuck compile must not stop the drawing for good. */
const WARM_TIMEOUT_MS = 8000;

const defaultRenderer = (canvas) => new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });

/** The scene target: half-float HDR with a depth texture the post chain reads. */
function sceneTarget(width, height, samples) {
  const depthTexture = new THREE.DepthTexture(width, height);
  return new THREE.WebGLRenderTarget(width, height, { type: THREE.HalfFloatType, samples, depthTexture });
}

export class Engine {
  #createPost;
  #setTimeout;
  #onDispose;
  #post = null;
  #disposed = false;
  /** Compiled shaders not yet put to first use, a few per frame (see `warm`). */
  #unused = [];

  /**
   * @param {HTMLCanvasElement | null} canvas
   * @param {{createRenderer?: (canvas: HTMLCanvasElement | null) => object,
   *   createPost?: typeof createPost, settings?: import("../quality.js").QualitySettings, setTimeout?: typeof globalThis.setTimeout,
   *   checkShaderErrors?: boolean}} [deps] `settings` the level the target and chain are first built at;
   *   `checkShaderErrors` asks the driver about every new shader on its first use (each answer stalls the frame); off
   *   unless the page's address has `?shaders` (an invalid shader is still reported by the browser)
   * @param {() => void} [onDispose]
   */
  constructor(canvas, { createRenderer = defaultRenderer, createPost: makePost = createPost, settings = qualitySettings("high"), setTimeout = globalThis.setTimeout, checkShaderErrors = SHADER_CHECKS } = {}, onDispose = () => {}) {
    this.canvas = canvas;
    this.#createPost = makePost;
    // Called as a plain function: a browser's own `setTimeout` throws when called as a method of something else.
    this.#setTimeout = (fn, ms) => setTimeout(fn, ms);
    this.#onDispose = onDispose;
    this.renderer = createRenderer(canvas);
    if (this.renderer.debug) this.renderer.debug.checkShaderErrors = checkShaderErrors;
    this.renderer.autoClear = false;
    // A frame is several render calls: `info` counts from `beginFrame` on, so `frameStats` sees the whole frame.
    if (this.renderer.info) this.renderer.info.autoReset = false;
    // The world's sun casts soft shadows; a level without a shadow map just leaves `castShadow` off.
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // Sizes are CSS pixels; the ratio scales the drawing buffer.
    this.renderer.setPixelRatio(1);
    this.settings = settings;
    /** The scene's size in device pixels as drawn: the canvas's, times the resolution scale. */
    this.size = { width: Math.max(1, canvas?.width ?? 1), height: Math.max(1, canvas?.height ?? 1) };
    /** The canvas's drawing buffer in device pixels. */
    this.canvasSize = { ...this.size };
    this.target = null;
    this.#configureTarget();
    this.clearColor = new THREE.Color(0, 0, 0);
  }

  /**
   * Sizes the canvas in device pixels, and the scene target and the chain at `scale` of that: the scene is drawn
   * smaller and the chain's last pass stretches it over the canvas. Only the canvas is resized when the window is:
   * a canvas's size change waits for the GPU to finish its queued frames, the targets' does not.
   * @param {number} width CSS pixels
   * @param {number} height CSS pixels
   * @param {number} [pixelRatio]
   * @param {number} [scale] the share of the canvas's resolution the scene is drawn at (dynamic resolution)
   */
  resize(width, height, pixelRatio = 1, scale = 1) {
    const fullWidth = Math.max(1, Math.round(width * pixelRatio));
    const fullHeight = Math.max(1, Math.round(height * pixelRatio));
    const deviceWidth = Math.max(1, Math.round(fullWidth * scale));
    const deviceHeight = Math.max(1, Math.round(fullHeight * scale));
    // Low has no target and draws straight to the canvas: there the canvas itself is drawn smaller (the page stretches it).
    const canvasWidth = this.target ? fullWidth : deviceWidth;
    const canvasHeight = this.target ? fullHeight : deviceHeight;
    if (canvasWidth !== this.canvasSize.width || canvasHeight !== this.canvasSize.height) {
      this.canvasSize = { width: canvasWidth, height: canvasHeight };
      this.renderer.setSize(canvasWidth, canvasHeight, false);
    }
    if (deviceWidth === this.size.width && deviceHeight === this.size.height) return;
    this.size = { width: deviceWidth, height: deviceHeight };
    this.target?.setSize(deviceWidth, deviceHeight);
    this.#post?.setSize(deviceWidth, deviceHeight);
  }

  /**
   * Applies a quality level: the target's samples and the chain are rebuilt.
   * @param {import("../quality.js").QualitySettings} settings
   */
  setQuality(settings) {
    if (settings === this.settings) return;
    this.settings = settings;
    this.#configureTarget();
  }

  #configureTarget() {
    this.#post?.dispose();
    this.target?.dispose();
    this.#post = null;
    this.target = null;
    if (this.settings === qualitySettings("low")) return;
    const { width, height } = this.size;
    this.target = sceneTarget(width, height, this.settings.msaa);
    this.#post = this.#createPost(this.renderer, this.target, this.settings);
  }

  /**
   * Compiles the shaders a scene needs (every material in it, hidden ones too, lit by its lights as they are now)
   * without drawing it. Where the browser compiles in parallel (KHR_parallel_shader_compile) this leaves the main
   * thread free, so the page keeps running instead of freezing on the first frame that would have compiled them.
   * Resolves when they are ready, or after a while in any case.
   * @param {import("../../three.js").Object3D} scene the scene, or new objects about to join `targetScene`
   * @param {import("../../three.js").Camera} camera
   * @param {import("../../three.js").Scene | null} [targetScene] the scene whose lights light `scene`'s objects
   * @returns {Promise<void>}
   */
  warm(scene, camera, targetScene = null) {
    const { renderer } = this;
    if (typeof renderer.compileAsync !== "function") return Promise.resolve();
    // Three picks a shader's tone mapping and output colours by the bound target: bind the one the frames draw into.
    const bound = renderer.getRenderTarget();
    renderer.setRenderTarget(this.target);
    const compiled = renderer.compileAsync(scene, camera, targetScene);
    renderer.setRenderTarget(bound);
    const timeout = new Promise((resolve) => this.#setTimeout(resolve, WARM_TIMEOUT_MS));
    return Promise.race([compiled, timeout]).then(() => {
      // Compiled is not used: Three asks each shader for its uniforms on first use, and every answer waits for the
      // driver. Done a few per frame from here, so the frame that first needs them (dusk, say) does not do it all.
      for (const program of renderer.info?.programs ?? []) if (!this.#unused.includes(program)) this.#unused.push(program);
    });
  }

  /** Binds and clears the frame's destination. Low draws directly to the canvas. */
  beginFrame(env) {
    const { renderer, target } = this;
    // A used shader's uniforms are known already: asking again costs nothing.
    if (this.#unused.length) {
      // Only shaders still alive: one freed meanwhile (its material disposed) has nothing left to ask.
      const live = renderer.info?.programs ?? [];
      for (const program of this.#unused.splice(0, FIRST_USES_PER_FRAME)) {
        if (!live.includes(program)) continue;
        program.getUniforms?.();
        program.getAttributes?.();
      }
    }
    renderer.setRenderTarget(target);
    if (!target) {
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = env?.exposure ?? 1;
    }
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
    if (target) {
      target.viewport.set(area.x, area.y, area.width, area.height);
      target.scissor.set(area.x, area.y, area.width, area.height);
      target.scissorTest = Boolean(rect);
    }
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
    if (target) {
      target.viewport.set(0, 0, size.width, size.height);
      target.scissor.set(0, 0, size.width, size.height);
      target.scissorTest = false;
    }
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
    renderer.setViewport(0, 0, this.canvasSize.width, this.canvasSize.height);
    this.#post?.render(camera, env, view);
  }

  /** Releases the chain, the target and the renderer. Safe to call twice. */
  dispose() {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#post?.dispose();
    this.#post = null;
    this.target?.dispose();
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
