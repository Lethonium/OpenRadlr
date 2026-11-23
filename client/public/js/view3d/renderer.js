/**
 * Tiny WebGL 2 renderer for flat-shaded, vertex-coloured meshes.
 *
 * The GLSL lives in `shaders.js` (shared with the Three.js adapter); this file
 * only compiles programs, uploads buffers and draws them.
 */
import {
  DEPTH_FRAGMENT,
  DEPTH_VERTEX,
  MESH_FRAGMENT,
  MESH_VERTEX,
  SKY_FRAGMENT,
  SKY_VERTEX,
  WEATHER_FRAGMENT,
  WEATHER_VERTEX,
} from "./shaders.js";

export function createContext(canvas) {
  return canvas.getContext("webgl2", { antialias: true, alpha: false, powerPreference: "high-performance" });
}

export class Renderer {
  /** Occlusion queries by key: `{query, pending, seen}`. */
  #queries = new Map();

  /** @param {WebGL2RenderingContext} gl */
  constructor(gl) {
    this.gl = gl;
    this.program = link(gl, compile(gl, gl.VERTEX_SHADER, MESH_VERTEX), compile(gl, gl.FRAGMENT_SHADER, MESH_FRAGMENT), {
      a_position: 0,
      a_normal: 1,
      a_color: 2,
    });
    this.skyProgram = link(gl, compile(gl, gl.VERTEX_SHADER, SKY_VERTEX), compile(gl, gl.FRAGMENT_SHADER, SKY_FRAGMENT));
    this.weatherProgram = link(gl, compile(gl, gl.VERTEX_SHADER, WEATHER_VERTEX), compile(gl, gl.FRAGMENT_SHADER, WEATHER_FRAGMENT), {
      a_corner: 0,
      a_seed: 1,
    });
    // The depth program shares attribute 0 for positions with the mesh program.
    this.depthProgram = link(gl, compile(gl, gl.VERTEX_SHADER, DEPTH_VERTEX), compile(gl, gl.FRAGMENT_SHADER, DEPTH_FRAGMENT), {
      a_position: 0,
    });
    this.attributes = {
      position: gl.getAttribLocation(this.program, "a_position"),
      normal: gl.getAttribLocation(this.program, "a_normal"),
      color: gl.getAttribLocation(this.program, "a_color"),
    };
    this.uniforms = uniforms(gl, this.program, [
      "u_viewProjection",
      "u_model",
      "u_tint",
      "u_sunDirection",
      "u_sunColor",
      "u_skyColor",
      "u_groundColor",
      "u_cameraPosition",
      "u_fogColor",
      "u_fogRange",
      "u_alpha",
      "u_unlit",
      "u_fogScale",
      "u_lightViewProjection",
      "u_shadowMap",
      "u_shadowStrength",
      "u_shadowTexel",
    ]);
    this.depthUniforms = uniforms(gl, this.depthProgram, ["u_lightViewProjection", "u_model"]);
    this.weatherAttributes = {
      corner: gl.getAttribLocation(this.weatherProgram, "a_corner"),
      seed: gl.getAttribLocation(this.weatherProgram, "a_seed"),
    };
    this.weatherUniforms = uniforms(gl, this.weatherProgram, [
      "u_viewProjection",
      "u_cameraPosition",
      "u_cameraRight",
      "u_cameraUp",
      "u_box",
      "u_fall",
      "u_drift",
      "u_size",
      "u_time",
      "u_color",
    ]);
    this.shadow = null;
    this.skyUniforms = uniforms(gl, this.skyProgram, [
      "u_inverseViewProjection",
      "u_cameraPosition",
      "u_sunDirection",
      "u_zenithColor",
      "u_horizonColor",
      "u_sunColor",
    ]);
    this.emptyVao = gl.createVertexArray();
    gl.enable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  }

  /** Creates the sun's depth texture. Returns false if the device cannot render depth. */
  createShadowMap(size = 2048) {
    const gl = this.gl;
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.DEPTH_COMPONENT24, size, size);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
    const framebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, texture, 0);
    const complete = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (!complete) {
      gl.deleteFramebuffer(framebuffer);
      gl.deleteTexture(texture);
      return false;
    }
    this.shadow = { texture, framebuffer, size, lightViewProjection: null, strength: 0 };
    return true;
  }

  /** Starts rendering shadow casters into the shadow map. */
  beginShadows(lightViewProjection) {
    const gl = this.gl;
    if (!this.shadow) return false;
    this.shadow.lightViewProjection = lightViewProjection;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadow.framebuffer);
    gl.viewport(0, 0, this.shadow.size, this.shadow.size);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.depthProgram);
    gl.uniformMatrix4fv(this.depthUniforms.u_lightViewProjection, false, lightViewProjection);
    gl.enable(gl.POLYGON_OFFSET_FILL);
    gl.polygonOffset(1.5, 3);
    return true;
  }

  drawShadowCaster(handle, model) {
    const gl = this.gl;
    gl.uniformMatrix4fv(this.depthUniforms.u_model, false, model);
    gl.bindVertexArray(handle.vao);
    gl.drawArrays(gl.TRIANGLES, 0, handle.count);
  }

  endShadows() {
    const gl = this.gl;
    gl.disable(gl.POLYGON_OFFSET_FILL);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
  }

  /** Uploads a mesh from MeshBuilder.build() and returns a handle. */
  upload(mesh) {
    const gl = this.gl;
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const buffers = [];
    const attribute = (location, data, size) => {
      const buffer = gl.createBuffer();
      buffers.push(buffer);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0);
    };
    attribute(this.attributes.position, mesh.positions, 3);
    attribute(this.attributes.normal, mesh.normals, 3);
    attribute(this.attributes.color, mesh.colors, 4);
    gl.bindVertexArray(null);
    return { vao, buffers, count: mesh.vertexCount };
  }

  /** Uploads camera-local weather particles: six vertices per flake, six floats each. */
  uploadWeather(data) {
    const gl = this.gl;
    const vao = gl.createVertexArray();
    const buffer = gl.createBuffer();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    const stride = 6 * 4;
    gl.enableVertexAttribArray(this.weatherAttributes.corner);
    gl.vertexAttribPointer(this.weatherAttributes.corner, 2, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(this.weatherAttributes.seed);
    gl.vertexAttribPointer(this.weatherAttributes.seed, 4, gl.FLOAT, false, stride, 2 * 4);
    gl.bindVertexArray(null);
    return { vao, buffers: [buffer], count: data.length / 6 };
  }

  /** Draws the weather field around the camera; `style` is the biome's weather data. */
  drawWeather(handle, { viewProjection, camera, right, up, timeS, style }) {
    const gl = this.gl;
    gl.useProgram(this.weatherProgram);
    const u = this.weatherUniforms;
    gl.uniformMatrix4fv(u.u_viewProjection, false, viewProjection);
    gl.uniform3fv(u.u_cameraPosition, camera);
    gl.uniform3fv(u.u_cameraRight, right);
    gl.uniform3fv(u.u_cameraUp, up);
    gl.uniform3fv(u.u_box, style.box);
    gl.uniform2fv(u.u_fall, style.fall);
    gl.uniform2fv(u.u_drift, style.drift);
    gl.uniform2fv(u.u_size, style.size);
    gl.uniform1f(u.u_time, timeS);
    gl.uniform4fv(u.u_color, style.color);
    gl.enable(gl.BLEND);
    gl.depthMask(false);
    gl.bindVertexArray(handle.vao);
    gl.drawArrays(gl.TRIANGLES, 0, handle.count);
    gl.bindVertexArray(null);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.useProgram(this.program);
  }

  dispose(handle) {
    this.gl.deleteVertexArray(handle.vao);
    handle.buffers.forEach((buffer) => this.gl.deleteBuffer(buffer));
  }

  resize(width, height) {
    const canvas = this.gl.canvas;
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    this.gl.viewport(0, 0, width, height);
  }

  /**
   * Draws the following passes into `rect` of the canvas (device pixels, from
   * the bottom left) and clears only there; null goes back to the whole canvas.
   * @param {{x: number, y: number, width: number, height: number} | null} rect
   */
  viewport(rect) {
    const gl = this.gl;
    if (rect) {
      gl.enable(gl.SCISSOR_TEST);
      gl.scissor(rect.x, rect.y, rect.width, rect.height);
      gl.viewport(rect.x, rect.y, rect.width, rect.height);
    } else {
      gl.disable(gl.SCISSOR_TEST);
      gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
    }
  }

  /**
   * Starts a frame: clears, draws the sky and sets the shared uniforms.
   * @param {{viewProjection: Float32Array, inverseViewProjection: Float32Array, camera: number[],
   *          zenith: number[], horizon: number[], ground: number[], sun: number[], sunColor: number[], fog: number[],
   *          shadowStrength?: number}} frame
   */
  begin({ viewProjection, inverseViewProjection, camera, zenith, horizon, ground, sun, sunColor, fog, shadowStrength = 0.6 }) {
    const gl = this.gl;
    gl.clearColor(horizon[0], horizon[1], horizon[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    gl.useProgram(this.skyProgram);
    const s = this.skyUniforms;
    gl.uniformMatrix4fv(s.u_inverseViewProjection, false, inverseViewProjection);
    gl.uniform3fv(s.u_cameraPosition, camera);
    gl.uniform3fv(s.u_sunDirection, sun);
    gl.uniform3fv(s.u_zenithColor, zenith);
    gl.uniform3fv(s.u_horizonColor, horizon);
    gl.uniform3fv(s.u_sunColor, sunColor);
    gl.depthMask(false);
    gl.bindVertexArray(this.emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.depthMask(true);

    gl.useProgram(this.program);
    const u = this.uniforms;
    gl.uniformMatrix4fv(u.u_viewProjection, false, viewProjection);
    gl.uniform3fv(u.u_cameraPosition, camera);
    gl.uniform3fv(u.u_sunDirection, sun);
    gl.uniform3fv(u.u_sunColor, sunColor);
    gl.uniform3fv(u.u_skyColor, zenith);
    gl.uniform3fv(u.u_groundColor, ground);
    gl.uniform3fv(u.u_fogColor, horizon);
    gl.uniform2fv(u.u_fogRange, fog);
    gl.uniform1f(u.u_alpha, 1);
    gl.uniform1f(u.u_unlit, 0);
    gl.uniform1f(u.u_fogScale, 1);
    const shadow = this.shadow;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, shadow?.texture ?? null);
    gl.uniform1i(u.u_shadowMap, 0);
    gl.uniform1f(u.u_shadowStrength, shadow?.lightViewProjection ? shadowStrength : 0);
    gl.uniform1f(u.u_shadowTexel, shadow ? 1 / shadow.size : 0);
    gl.uniformMatrix4fv(u.u_lightViewProjection, false, shadow?.lightViewProjection ?? IDENTITY);
  }

  /** Draws with partial self-illumination (signage that should read in shade). */
  drawBright(handle, model, unlit = 0.45) {
    this.gl.uniform1f(this.uniforms.u_unlit, unlit);
    this.draw(handle, model);
    this.gl.uniform1f(this.uniforms.u_unlit, 0);
  }

  draw(handle, model, tint = [1, 1, 1]) {
    const gl = this.gl;
    gl.uniformMatrix4fv(this.uniforms.u_model, false, model);
    gl.uniform3fv(this.uniforms.u_tint, tint);
    gl.bindVertexArray(handle.vao);
    gl.drawArrays(gl.TRIANGLES, 0, handle.count);
  }

  /** Clouds: bright, softly lit and only lightly fogged so they stay visible far away. */
  drawCloudLayer(handle, model, tint = [1, 1, 1]) {
    const gl = this.gl;
    gl.uniform1f(this.uniforms.u_fogScale, 0.35);
    gl.uniform1f(this.uniforms.u_unlit, 0.8);
    this.draw(handle, model, tint);
    gl.uniform1f(this.uniforms.u_fogScale, 1);
    gl.uniform1f(this.uniforms.u_unlit, 0);
  }

  /**
   * Asks the GPU whether any of `handle` at `model` is in sight, against the
   * depth drawn so far (call after the opaque meshes). Nothing is drawn. The
   * answer comes a frame or two later through `occlusion(key)`; one query
   * per key is in flight at a time, so this is cheap to call every frame.
   */
  queryOcclusion(key, handle, model) {
    const gl = this.gl;
    let entry = this.#queries.get(key);
    if (!entry) {
      entry = { query: gl.createQuery(), pending: false, seen: undefined };
      this.#queries.set(key, entry);
    }
    if (entry.pending) {
      // Never block on the GPU: read only what is ready.
      if (!gl.getQueryParameter(entry.query, gl.QUERY_RESULT_AVAILABLE)) return;
      entry.seen = gl.getQueryParameter(entry.query, gl.QUERY_RESULT) > 0;
      entry.pending = false;
    }
    gl.colorMask(false, false, false, false);
    gl.depthMask(false);
    gl.beginQuery(gl.ANY_SAMPLES_PASSED_CONSERVATIVE, entry.query);
    this.draw(handle, model);
    gl.endQuery(gl.ANY_SAMPLES_PASSED_CONSERVATIVE);
    gl.depthMask(true);
    gl.colorMask(true, true, true, true);
    entry.pending = true;
  }

  /** The latest answer for `key`: true (partly in sight), false (hidden) or undefined (none yet). */
  occlusion(key) {
    return this.#queries.get(key)?.seen;
  }

  /** Drops the queries of keys not in `keys`. */
  keepOcclusion(keys) {
    for (const [key, entry] of this.#queries) {
      if (keys.has(key)) continue;
      this.gl.deleteQuery(entry.query);
      this.#queries.delete(key);
    }
  }

  /**
   * Draws a blended mesh (shadows, water). Call after all opaque meshes.
   * `unlit` = 1 uses the vertex colour as is (shadows), 0 applies lighting.
   */
  drawTransparent(handle, model, { alpha, unlit = 0, tint = [1, 1, 1] }) {
    const gl = this.gl;
    gl.enable(gl.BLEND);
    gl.depthMask(false);
    gl.enable(gl.POLYGON_OFFSET_FILL);
    gl.polygonOffset(-1, -2);
    gl.uniform1f(this.uniforms.u_alpha, alpha);
    gl.uniform1f(this.uniforms.u_unlit, unlit);
    this.draw(handle, model, tint);
    gl.uniform1f(this.uniforms.u_alpha, 1);
    gl.uniform1f(this.uniforms.u_unlit, 0);
    gl.disable(gl.POLYGON_OFFSET_FILL);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }
}

function uniforms(gl, program, names) {
  return Object.fromEntries(names.map((name) => [name, gl.getUniformLocation(program, name)]));
}

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(`Shader error: ${gl.getShaderInfoLog(shader)}`);
  return shader;
}

const IDENTITY = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

function link(gl, vertex, fragment, bindings = {}) {
  const program = gl.createProgram();
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  for (const [name, location] of Object.entries(bindings)) gl.bindAttribLocation(program, location, name);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(`Program error: ${gl.getProgramInfoLog(program)}`);
  return program;
}
