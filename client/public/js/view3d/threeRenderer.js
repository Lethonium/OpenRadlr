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
 */
import * as THREE from "../three.js";
import { MESH_FRAGMENT, MESH_VERTEX, SKY_FRAGMENT, SKY_VERTEX } from "./shaders.js";

/** Three prepends the version itself for GLSL3, so the source must not carry it. */
const glsl3 = (source) => source.replace(/^#version 300 es\n/, "");

/** Per-draw values ride on the mesh, so one material can serve every draw. */
function beforeRender(renderer, scene, camera, geometry, object) {
  const uniforms = object.material.uniforms;
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
      u_shadowMap: { value: null },
      u_shadowStrength: { value: 0 },
      u_shadowTexel: { value: 0 },
    },
    transparent,
    depthWrite: !transparent,
    side: THREE.DoubleSide,
    ...(transparent && { blending: THREE.NormalBlending, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }),
  });
  material.onBeforeRender = beforeRender;
  return material;
}

export class ThreeRenderer {
  #pool = [];
  #used = 0;

  /**
   * @param {HTMLCanvasElement | null} canvas
   * @param {{createRenderer?: (canvas: HTMLCanvasElement | null) => object}} [deps]
   */
  constructor(canvas, { createRenderer = (canvas) => new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" }) } = {}) {
    this.canvas = canvas;
    this.renderer = createRenderer(canvas);
    this.renderer.autoClear = false;
    // Callers pass device pixels (the old renderer drew straight into them).
    this.renderer.setPixelRatio(1);
    this.size = { width: canvas?.width ?? 1, height: canvas?.height ?? 1 };

    this.camera = new THREE.Camera();
    this.camera.matrixAutoUpdate = false;
    this.camera.matrixWorldAutoUpdate = false;

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
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    const skyGeometry = new THREE.BufferGeometry();
    skyGeometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(9), 3));
    this.sky = new THREE.Mesh(skyGeometry, this.skyMaterial);
    this.sky.name = "sky";
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -1;

    this.scene = new THREE.Scene();
    this.viewportRect = null;
    this.pending = null;
    this.clearColor = new THREE.Color();
  }

  /** Uploads a mesh from MeshBuilder.build() and returns a handle. */
  upload(mesh) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("a_position", new THREE.BufferAttribute(mesh.positions, 3));
    geometry.setAttribute("a_normal", new THREE.BufferAttribute(mesh.normals, 3));
    geometry.setAttribute("a_color", new THREE.BufferAttribute(mesh.colors, 4));
    return { geometry, count: mesh.vertexCount, name: mesh.name };
  }

  dispose(handle) {
    handle.geometry.dispose();
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
   *          sun: number[], sunColor: number[], fog: number[], shadowStrength?: number}} frame
   */
  begin(frame) {
    this.flush();
    this.#setCamera(frame);
    this.#setFrameUniforms(frame);
    this.pending = { viewport: this.viewportRect, horizon: frame.horizon, opaque: [], transparent: [] };
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
    this.clearColor.setRGB(pass.horizon[0], pass.horizon[1], pass.horizon[2]);
    this.renderer.setClearColor(this.clearColor, 1);
    this.renderer.clear(true, true, false);

    this.scene.clear();
    this.scene.add(this.sky);
    for (const draw of pass.opaque) this.scene.add(this.#meshFor(draw, this.meshMaterial));
    for (const draw of pass.transparent) this.scene.add(this.#meshFor(draw, this.transparentMaterial));
    this.renderer.render(this.scene, this.camera);
  }

  #enqueue(transparent, handle, data) {
    if (!this.pending) return;
    (transparent ? this.pending.transparent : this.pending.opaque).push({ handle, data });
  }

  #meshFor({ handle, data }, material) {
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
    mesh.userData = data;
    return mesh;
  }

  #setCamera({ view, projection }) {
    this.camera.matrixWorldInverse.fromArray(view);
    this.camera.matrixWorld.copy(this.camera.matrixWorldInverse).invert();
    this.camera.projectionMatrix.fromArray(projection);
    this.camera.projectionMatrixInverse.copy(this.camera.projectionMatrix).invert();
  }

  #setFrameUniforms(frame) {
    for (const material of [this.meshMaterial, this.transparentMaterial]) {
      const u = material.uniforms;
      u.u_viewProjection.value.fromArray(frame.viewProjection);
      u.u_cameraPosition.value.fromArray(frame.camera);
      u.u_sunDirection.value.fromArray(frame.sun);
      u.u_sunColor.value.fromArray(frame.sunColor);
      u.u_skyColor.value.fromArray(frame.zenith);
      u.u_groundColor.value.fromArray(frame.ground);
      u.u_fogColor.value.fromArray(frame.horizon);
      u.u_fogRange.value.fromArray(frame.fog);
      u.u_alpha.value = 1;
      u.u_unlit.value = 0;
      u.u_fogScale.value = 1;
      u.u_shadowStrength.value = 0;
      u.u_shadowTexel.value = 0;
    }
    const s = this.skyMaterial.uniforms;
    s.u_inverseViewProjection.value.fromArray(frame.inverseViewProjection);
    s.u_cameraPosition.value.fromArray(frame.camera);
    s.u_sunDirection.value.fromArray(frame.sun);
    s.u_zenithColor.value.fromArray(frame.zenith);
    s.u_horizonColor.value.fromArray(frame.horizon);
    s.u_sunColor.value.fromArray(frame.sunColor);
  }
}
