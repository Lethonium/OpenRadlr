/**
 * The own renderer's interface, implemented on Three.js.
 *
 * `View3D` and `StudioView3D` draw through this during the sweep: same methods,
 * same arguments, same passes, so the look stays the baseline's while the old
 * renderer is removed. The scene graph arrives in steps 3 and 4; here each draw
 * is still a mesh with a model matrix, queued into the current pass.
 *
 * Passes: a pass is rendered when the next one starts (`begin`, `beginShadows`,
 * `viewport`) or on `end()`. Inside a pass the sky draws first, then opaque
 * meshes in call order, then transparent ones in call order.
 *
 * An overlay pass (`frame.overlay`) draws on top of what the engine has put in
 * its scene target: no clear, no sky, linear output (the post chain encodes),
 * and the engine's target is bound again afterwards.
 */
import * as THREE from "../three.js";
import { cameraFromMatrices } from "./engine/camera.js";
import { DEPTH_FRAGMENT, DEPTH_VERTEX, MESH_FRAGMENT, MESH_VERTEX, SKY_FRAGMENT, SKY_VERTEX, WEATHER_FRAGMENT, WEATHER_VERTEX } from "./shaders.js";

/** Three prepends the version itself for GLSL3, so the source must not carry it. */
const glsl3 = (source) => source.replace(/^#version 300 es\n/, "");

/** Per-draw values ride on the mesh, so one material can serve every draw. */
function beforeRender(renderer, scene, camera, geometry, object) {
  const uniforms = object.material.uniforms;
  // Three uploads a shared material's uniforms once, when the material changes;
  // without this flag every mesh after the first draws with the first one's values.
  object.material.uniformsNeedUpdate = true;
  uniforms.u_model.value.fromArray(object.userData.model);
  uniforms.u_tint.value.fromArray(object.userData.tint);
  uniforms.u_unlit.value = object.userData.unlit;
  uniforms.u_alpha.value = object.userData.alpha;
  uniforms.u_fogScale.value = object.userData.fogScale;
}

/** The mesh program: same GLSL as the own renderer, opaque or blended. */
function meshMaterial(transparent) {
  const material = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: glsl3(MESH_VERTEX),
    fragmentShader: glsl3(MESH_FRAGMENT),
    uniforms: {
      u_viewProjection: { value: new THREE.Matrix4() },
      u_model: { value: new THREE.Matrix4() },
      u_lightViewProjection: { value: new THREE.Matrix4() },
      u_tint: { value: new THREE.Vector3(1, 1, 1) },
      u_sunDirection: { value: new THREE.Vector3(0, 1, 0) },
      u_sunColor: { value: new THREE.Vector3(1, 1, 1) },
      u_skyColor: { value: new THREE.Vector3() },
      u_groundColor: { value: new THREE.Vector3() },
      u_cameraPosition: { value: new THREE.Vector3() },
      u_fogColor: { value: new THREE.Vector3() },
      u_fogRange: { value: new THREE.Vector2(1, 1e6) },
      u_alpha: { value: 1 },
      u_unlit: { value: 0 },
      u_fogScale: { value: 1 },
      u_linearOut: { value: 0 },
      u_shadowMap: { value: null },
      u_shadowStrength: { value: 0 },
      u_shadowTexel: { value: 0 },
    },
    transparent,
    depthFunc: DEPTH_FUNC,
    depthWrite: !transparent,
    side: THREE.DoubleSide,
    ...(transparent && { blending: THREE.NormalBlending, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }),
  });
  material.onBeforeRender = beforeRender;
  return material;
}

const IDENTITY = new THREE.Matrix4();

/**
 * The sky colour the adapter's meshes take their ambient light from. The zenith alone is a deep blue
 * that turns every wall's shade navy; by day the fill is the bright horizon, whitened (as the world
 * scene's hemisphere light is), and at night it stays the dark zenith.
 * @param {number[]} zenith
 * @param {number[]} horizon
 * @returns {number[]}
 */
export function ambientSky(zenith, horizon) {
  const luma = 0.299 * horizon[0] + 0.587 * horizon[1] + 0.114 * horizon[2];
  const day = Math.min(1, Math.max(0, (luma - 0.15) / 0.35));
  return zenith.map((z, i) => z + (horizon[i] + (1 - horizon[i]) * 0.4 - z) * day);
}

/**
 * The own renderer left WebGL's default depth test, LESS; Three's is LESS_EQUAL.
 * It matters for the sky, which is drawn at the far plane (depth exactly 1):
 * with LESS it never shows, and the ride's sky is the flat horizon colour the
 * baseline shots record. Every material keeps LESS so the look stays the same.
 */
const DEPTH_FUNC = THREE.LessDepth;

export class ThreeRenderer {
  #pool = [];
  #used = 0;

  /**
   * @param {HTMLCanvasElement | null} canvas
   * @param {{createRenderer?: (canvas: HTMLCanvasElement | null) => object, renderer?: object}} [deps]
   *   `renderer` is a shared renderer (the engine's); the adapter never disposes it
   */
  constructor(canvas, { createRenderer = (canvas) => new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" }), renderer } = {}) {
    this.canvas = canvas;
    this.ownsRenderer = !renderer;
    this.renderer = renderer ?? createRenderer(canvas);
    this.renderer.autoClear = false;
    // Callers pass device pixels (the old renderer drew straight into them).
    this.renderer.setPixelRatio(1);
    this.size = { width: canvas?.width ?? 1, height: canvas?.height ?? 1 };

    this.camera = new THREE.Camera();

    this.meshMaterial = meshMaterial(false);
    this.transparentMaterial = meshMaterial(true);
    this.skyMaterial = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: glsl3(SKY_VERTEX),
      fragmentShader: glsl3(SKY_FRAGMENT),
      uniforms: {
        u_inverseViewProjection: { value: new THREE.Matrix4() },
        u_cameraPosition: { value: new THREE.Vector3() },
        u_sunDirection: { value: new THREE.Vector3(0, 1, 0) },
        u_zenithColor: { value: new THREE.Vector3() },
        u_horizonColor: { value: new THREE.Vector3() },
        u_sunColor: { value: new THREE.Vector3(1, 1, 1) },
      },
      depthFunc: DEPTH_FUNC,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    const skyGeometry = new THREE.BufferGeometry();
    skyGeometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(9), 3));
    skyGeometry.setDrawRange(0, 3);
    this.sky = new THREE.Mesh(skyGeometry, this.skyMaterial);
    this.sky.name = "sky";
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -1;

    this.scene = new THREE.Scene();
    this.viewportRect = null;
    this.pending = null;
    this.clearColor = new THREE.Color();

    this.depthMaterial = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: glsl3(DEPTH_VERTEX),
      fragmentShader: glsl3(DEPTH_FRAGMENT),
      colorWrite: false,
      depthFunc: DEPTH_FUNC,
      uniforms: {
        u_lightViewProjection: { value: new THREE.Matrix4() },
        u_model: { value: new THREE.Matrix4() },
      },
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: 1.5,
      polygonOffsetUnits: 3,
    });
    this.depthMaterial.onBeforeRender = (renderer, scene, camera, geometry, object) => {
      object.material.uniformsNeedUpdate = true;
      object.material.uniforms.u_model.value.fromArray(object.userData.model);
    };
    this.shadowScene = new THREE.Scene();
    this.shadowCamera = new THREE.Camera();
    // A sampler2DShadow cannot be bound to an ordinary empty texture, so a tiny
    // depth target stands in until the app asks for a real shadow map.
    this.shadow = this.#shadowTarget(1);

    this.weatherMaterial = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: glsl3(WEATHER_VERTEX),
      fragmentShader: glsl3(WEATHER_FRAGMENT),
      uniforms: {
        u_viewProjection: { value: new THREE.Matrix4() },
        u_cameraPosition: { value: new THREE.Vector3() },
        u_cameraRight: { value: new THREE.Vector3() },
        u_cameraUp: { value: new THREE.Vector3() },
        u_box: { value: new THREE.Vector3() },
        u_fall: { value: new THREE.Vector2() },
        u_drift: { value: new THREE.Vector2() },
        u_size: { value: new THREE.Vector2() },
        u_time: { value: 0 },
        u_color: { value: new THREE.Vector4() },
        u_linearOut: { value: 0 },
      },
      transparent: true,
      depthFunc: DEPTH_FUNC,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.weatherMaterial.onBeforeRender = (renderer, scene, camera, geometry, object) => {
      object.material.uniformsNeedUpdate = true;
      const uniforms = object.material.uniforms;
      const draw = object.userData;
      uniforms.u_viewProjection.value.fromArray(draw.viewProjection);
      uniforms.u_cameraPosition.value.fromArray(draw.camera);
      uniforms.u_cameraRight.value.fromArray(draw.right);
      uniforms.u_cameraUp.value.fromArray(draw.up);
      uniforms.u_box.value.fromArray(draw.style.box);
      uniforms.u_fall.value.fromArray(draw.style.fall);
      uniforms.u_drift.value.fromArray(draw.style.drift);
      uniforms.u_size.value.fromArray(draw.style.size);
      uniforms.u_time.value = draw.timeS;
      uniforms.u_color.value.fromArray(draw.style.color);
    };
  }

  /** Uploads a mesh from MeshBuilder.build() and returns a handle. */
  upload(mesh) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("a_position", new THREE.BufferAttribute(mesh.positions, 3));
    geometry.setAttribute("a_normal", new THREE.BufferAttribute(mesh.normals, 3));
    geometry.setAttribute("a_color", new THREE.BufferAttribute(mesh.colors, 4));
    // Three takes the draw count from `position`; our attributes are named a_*.
    geometry.setDrawRange(0, mesh.vertexCount);
    return { geometry, count: mesh.vertexCount, name: mesh.name };
  }

  dispose(handle) {
    handle.geometry.dispose();
  }

  /** Releases the adapter's own GPU objects; a shared renderer is left to its engine. */
  destroy() {
    this.shadow?.target.dispose();
    this.shadow = null;
    for (const material of [this.meshMaterial, this.transparentMaterial, this.skyMaterial, this.depthMaterial, this.weatherMaterial]) material.dispose();
    this.sky.geometry.dispose();
    if (this.ownsRenderer) this.renderer.dispose();
  }

  /** Creates the sun's depth texture. Returns false if the device cannot render depth. */
  createShadowMap(size = 2048) {
    this.shadow?.target.dispose();
    this.shadow = this.#shadowTarget(size);
    return true;
  }

  /** A depth render target for shadows, cleared once so its texture can be sampled. */
  #shadowTarget(size) {
    const depthTexture = new THREE.DepthTexture(size, size);
    depthTexture.type = THREE.UnsignedIntType;
    depthTexture.minFilter = THREE.LinearFilter;
    depthTexture.magFilter = THREE.LinearFilter;
    depthTexture.compareFunction = THREE.LessEqualCompare;
    const target = new THREE.WebGLRenderTarget(size, size, { depthTexture, depthBuffer: true });
    const restore = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(target);
    this.renderer.setScissorTest(false);
    this.renderer.setViewport(0, 0, size, size);
    this.renderer.clear(true, true, false);
    this.renderer.setRenderTarget(restore);
    return { target, depthTexture, size, lightViewProjection: null, drawn: false, casters: null };
  }

  /** Starts rendering shadow casters into the shadow map. */
  beginShadows(lightViewProjection) {
    if (!this.shadow) return false;
    this.flush();
    this.shadow.lightViewProjection = lightViewProjection;
    this.shadow.drawn = false;
    this.shadow.casters = [];
    this.depthMaterial.uniforms.u_lightViewProjection.value.fromArray(lightViewProjection);
    return true;
  }

  drawShadowCaster(handle, model) {
    this.shadow?.casters?.push({ handle, data: { model } });
  }

  endShadows() {
    const shadow = this.shadow;
    const casters = shadow?.casters;
    if (!shadow || !casters) return;
    shadow.casters = null;
    this.#used = 0;
    const restore = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(shadow.target);
    this.renderer.setScissorTest(false);
    this.renderer.setViewport(0, 0, shadow.size, shadow.size);
    this.clearColor.setRGB(0, 0, 0, THREE.SRGBColorSpace);
    this.renderer.setClearColor(this.clearColor, 1);
    this.renderer.clear(true, true, false);
    this.shadowScene.clear();
    for (const draw of casters) this.shadowScene.add(this.#meshFor(draw, this.depthMaterial, 0));
    this.renderer.render(this.shadowScene, this.shadowCamera);
    this.renderer.setRenderTarget(restore);
    shadow.drawn = true;
  }

  /** Uploads camera-local weather particles: six vertices per flake, six floats each. */
  uploadWeather(data) {
    const geometry = new THREE.BufferGeometry();
    const buffer = new THREE.InterleavedBuffer(data, 6);
    geometry.setAttribute("a_corner", new THREE.InterleavedBufferAttribute(buffer, 2, 0));
    geometry.setAttribute("a_seed", new THREE.InterleavedBufferAttribute(buffer, 4, 2));
    const count = data.length / 6;
    geometry.setDrawRange(0, count);
    return { geometry, count, name: "weather" };
  }

  /** Draws the weather field around the camera; `style` is the biome's weather data. */
  drawWeather(handle, draw) {
    if (!this.pending) return;
    this.pending.weather.push({ handle, data: draw });
  }

  resize(width, height) {
    this.size = { width, height };
    this.renderer.setSize(width, height, false);
  }

  /**
   * Draws the following passes into `rect` of the canvas (device pixels, from
   * the bottom left) and clears only there; null goes back to the whole canvas.
   * @param {{x: number, y: number, width: number, height: number} | null} rect
   */
  viewport(rect) {
    this.flush();
    this.viewportRect = rect;
  }

  /**
   * Starts a pass: clears, draws the sky and sets the frame's uniforms.
   * @param {{view: Float32Array, projection: Float32Array, inverseViewProjection: Float32Array,
   *          camera: number[], zenith: number[], horizon: number[], ground: number[],
   *          sun: number[], sunColor: number[], fog: number[], shadowStrength?: number,
   *          overlay?: boolean}} frame
   */
  begin(frame) {
    this.flush();
    cameraFromMatrices(this.camera, frame.view, frame.projection);
    this.#setFrameUniforms(frame);
    this.pending = { overlay: frame.overlay === true, viewport: this.viewportRect, horizon: frame.horizon, opaque: [], transparent: [], weather: [] };
  }

  end() {
    this.flush();
  }

  draw(handle, model, tint = [1, 1, 1]) {
    this.#enqueue(false, handle, { model, tint, unlit: 0, alpha: 1, fogScale: 1 });
  }

  /** Draws with partial self-illumination (signage that should read in shade). */
  drawBright(handle, model, unlit = 0.45) {
    this.#enqueue(false, handle, { model, tint: [1, 1, 1], unlit, alpha: 1, fogScale: 1 });
  }

  /** Clouds: bright, softly lit and only lightly fogged so they stay visible far away. */
  drawCloudLayer(handle, model, tint = [1, 1, 1]) {
    this.#enqueue(false, handle, { model, tint, unlit: 0.8, alpha: 1, fogScale: 0.35 });
  }

  /**
   * Draws a blended mesh (shadows, water). Call after all opaque meshes.
   * `unlit` = 1 uses the vertex colour as is (shadows), 0 applies lighting.
   */
  drawTransparent(handle, model, { alpha, unlit = 0, tint = [1, 1, 1] }) {
    this.#enqueue(true, handle, { model, tint, unlit, alpha, fogScale: 1 });
  }

  /** Renders whatever pass is pending. */
  flush() {
    const pass = this.pending;
    if (!pass) return;
    this.pending = null;
    this.#used = 0;

    const rect = pass.viewport;
    if (rect) {
      this.renderer.setScissorTest(true);
      this.renderer.setScissor(rect.x, rect.y, rect.width, rect.height);
      this.renderer.setViewport(rect.x, rect.y, rect.width, rect.height);
    } else {
      this.renderer.setScissorTest(false);
      this.renderer.setViewport(0, 0, this.size.width, this.size.height);
    }
    if (!pass.overlay) {
      // Three treats a Color as linear and encodes it for the screen on clear; the
      // colours here are already display values, so say so and they come out unchanged.
      this.clearColor.setRGB(pass.horizon[0], pass.horizon[1], pass.horizon[2], THREE.SRGBColorSpace);
      this.renderer.setClearColor(this.clearColor, 1);
      this.renderer.clear(true, true, false);
    }

    this.scene.clear();
    if (!pass.overlay) this.scene.add(this.sky);
    pass.opaque.forEach((draw, index) => this.scene.add(this.#meshFor(draw, this.meshMaterial, index)));
    pass.transparent.forEach((draw, index) => this.scene.add(this.#meshFor(draw, this.transparentMaterial, 1000 + index)));
    pass.weather.forEach((draw) => this.scene.add(this.#meshFor(draw, this.weatherMaterial, 10000)));
    this.renderer.render(this.scene, this.camera);
  }

  #enqueue(transparent, handle, data) {
    if (!this.pending) return;
    (transparent ? this.pending.transparent : this.pending.opaque).push({ handle, data });
  }

  #meshFor({ handle, data }, material, renderOrder) {
    let mesh = this.#pool[this.#used];
    if (!mesh) {
      mesh = new THREE.Mesh();
      mesh.frustumCulled = false;
      this.#pool.push(mesh);
    }
    this.#used += 1;
    mesh.geometry = handle.geometry;
    mesh.material = material;
    mesh.name = handle.name ?? "";
    mesh.renderOrder = renderOrder;
    mesh.userData = data;
    return mesh;
  }

  #setFrameUniforms(frame) {
    const shadow = this.shadow;
    const shadowStrength = shadow?.drawn ? (frame.shadowStrength ?? 0.6) : 0;
    for (const material of [this.meshMaterial, this.transparentMaterial]) {
      const u = material.uniforms;
      u.u_viewProjection.value.fromArray(frame.viewProjection);
      u.u_cameraPosition.value.fromArray(frame.camera);
      u.u_sunDirection.value.fromArray(frame.sun);
      u.u_sunColor.value.fromArray(frame.sunColor);
      u.u_skyColor.value.fromArray(ambientSky(frame.zenith, frame.horizon));
      u.u_groundColor.value.fromArray(frame.ground);
      u.u_fogColor.value.fromArray(frame.horizon);
      u.u_fogRange.value.fromArray(frame.fog);
      u.u_alpha.value = 1;
      u.u_unlit.value = 0;
      u.u_fogScale.value = 1;
      u.u_linearOut.value = frame.overlay ? 1 : 0;
      u.u_shadowMap.value = shadow?.depthTexture ?? null;
      u.u_shadowStrength.value = shadowStrength;
      u.u_shadowTexel.value = shadow ? 1 / shadow.size : 0;
      u.u_lightViewProjection.value.copy(IDENTITY);
      if (shadow?.lightViewProjection) u.u_lightViewProjection.value.fromArray(shadow.lightViewProjection);
    }
    this.weatherMaterial.uniforms.u_linearOut.value = frame.overlay ? 1 : 0;
    const s = this.skyMaterial.uniforms;
    s.u_inverseViewProjection.value.fromArray(frame.inverseViewProjection);
    s.u_cameraPosition.value.fromArray(frame.camera);
    s.u_sunDirection.value.fromArray(frame.sun);
    s.u_zenithColor.value.fromArray(frame.zenith);
    s.u_horizonColor.value.fromArray(frame.horizon);
    s.u_sunColor.value.fromArray(frame.sunColor);
  }
}
