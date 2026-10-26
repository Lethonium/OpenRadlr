/**
 * Tiny WebGL 2 renderer for flat-shaded, vertex-coloured meshes.
 *
 * Passes per frame:
 * 0. shadow — depth of the shadow casters as seen from the sun (shadow map)
 * 1. sky    — full-screen gradient with sun glow (no geometry)
 * 2. opaque — sun (shadowed, PCF-filtered) + sky/ground hemisphere light,
 *             rim light, distance and height fog, tone mapping
 * 3. blended — water and contact shadows, depth-tested but not written
 */

const MESH_VERTEX = `#version 300 es
in vec3 a_position;
in vec3 a_normal;
in vec4 a_color;
uniform mat4 u_viewProjection;
uniform mat4 u_model;
uniform mat4 u_lightViewProjection;
uniform vec3 u_tint;
out vec3 v_normal;
out vec3 v_color;
out vec3 v_world;
out vec4 v_shadow;
void main() {
  vec4 world = u_model * vec4(a_position, 1.0);
  v_world = world.xyz;
  v_normal = mat3(u_model) * a_normal;
  v_color = mix(a_color.rgb, u_tint, a_color.a);
  // Normal offset against shadow acne on slopes.
  v_shadow = u_lightViewProjection * vec4(world.xyz + normalize(v_normal) * 0.06, 1.0);
  gl_Position = u_viewProjection * world;
}`;

const MESH_FRAGMENT = `#version 300 es
precision highp float;
precision highp sampler2DShadow;
in vec3 v_normal;
in vec3 v_color;
in vec3 v_world;
in vec4 v_shadow;
uniform sampler2DShadow u_shadowMap;
uniform float u_shadowStrength;
uniform float u_shadowTexel;
uniform vec3 u_sunDirection;
uniform vec3 u_sunColor;
uniform vec3 u_skyColor;
uniform vec3 u_groundColor;
uniform vec3 u_cameraPosition;
uniform vec3 u_fogColor;
uniform vec2 u_fogRange;
uniform float u_alpha;
uniform float u_unlit;
uniform float u_fogScale;
out vec4 outColor;

vec3 toneMap(vec3 c) {
  // Gentle exposure + roll-off: whites stay white, highlights never clip harshly.
  c *= 1.2;
  c = c / (1.0 + c * 0.22);
  return pow(c, vec3(0.95));
}

float sunVisibility() {
  vec3 p = v_shadow.xyz / v_shadow.w * 0.5 + 0.5;
  if (u_shadowStrength <= 0.0 || p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0 || p.z > 1.0) return 1.0;
  // 3×3 percentage-closer filtering on top of the hardware 2×2 comparison.
  float lit = 0.0;
  for (int x = -1; x <= 1; x++) {
    for (int y = -1; y <= 1; y++) {
      lit += texture(u_shadowMap, vec3(p.xy + vec2(x, y) * u_shadowTexel, p.z - 0.0008));
    }
  }
  lit /= 9.0;
  // Fade out towards the edge of the shadow box so there is no hard border.
  float edge = smoothstep(0.0, 0.08, min(min(p.x, 1.0 - p.x), min(p.y, 1.0 - p.y)));
  return mix(1.0, mix(1.0 - u_shadowStrength, 1.0, lit), edge);
}

void main() {
  vec3 n = normalize(v_normal);
  if (!gl_FrontFacing) n = -n;
  float sun = max(dot(n, u_sunDirection), 0.0) * sunVisibility();
  vec3 ambient = mix(u_groundColor, u_skyColor, n.y * 0.5 + 0.5);
  vec3 toCamera = normalize(u_cameraPosition - v_world);
  // Soft rim light keeps silhouettes readable against the terrain.
  float rim = pow(1.0 - max(dot(n, toCamera), 0.0), 3.0) * 0.18;
  vec3 lit = v_color * (ambient * 0.62 + u_sunColor * sun * 0.85) + rim * u_skyColor;
  lit = mix(lit, v_color, u_unlit);
  float distance = length(v_world - u_cameraPosition);
  float fog = smoothstep(u_fogRange.x, u_fogRange.y, distance);
  // Height fog: distant valleys get hazier than mountain tops.
  fog = clamp(fog * (1.15 - 0.3 * smoothstep(0.0, 250.0, v_world.y - u_cameraPosition.y)), 0.0, 1.0) * u_fogScale;
  outColor = vec4(mix(toneMap(lit), u_fogColor, fog), u_alpha);
}`;

const DEPTH_VERTEX = `#version 300 es
in vec3 a_position;
uniform mat4 u_lightViewProjection;
uniform mat4 u_model;
void main() {
  gl_Position = u_lightViewProjection * u_model * vec4(a_position, 1.0);
}`;

const DEPTH_FRAGMENT = `#version 300 es
precision mediump float;
void main() {}`;

const SKY_VERTEX = `#version 300 es
const vec2 corners[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
out vec2 v_ndc;
void main() {
  v_ndc = corners[gl_VertexID];
  gl_Position = vec4(v_ndc, 1.0, 1.0);
}`;

const SKY_FRAGMENT = `#version 300 es
precision highp float;
in vec2 v_ndc;
uniform mat4 u_inverseViewProjection;
uniform vec3 u_cameraPosition;
uniform vec3 u_sunDirection;
uniform vec3 u_zenithColor;
uniform vec3 u_horizonColor;
uniform vec3 u_sunColor;
out vec4 outColor;
void main() {
  vec4 far = u_inverseViewProjection * vec4(v_ndc, 1.0, 1.0);
  vec3 direction = normalize(far.xyz / far.w - u_cameraPosition);
  float height = clamp(direction.y, -0.1, 1.0);
  vec3 sky = mix(u_horizonColor, u_zenithColor, pow(max(height, 0.0), 0.55));
  float sunAmount = max(dot(direction, u_sunDirection), 0.0);
  sky += u_sunColor * (pow(sunAmount, 900.0) * 1.4 + pow(sunAmount, 12.0) * 0.18);
  outColor = vec4(sky, 1.0);
}`;

export function createContext(canvas) {
  return canvas.getContext("webgl2", { antialias: true, alpha: false, powerPreference: "high-performance" });
}

export class Renderer {
  /** @param {WebGL2RenderingContext} gl */
  constructor(gl) {
    this.gl = gl;
    this.program = link(gl, compile(gl, gl.VERTEX_SHADER, MESH_VERTEX), compile(gl, gl.FRAGMENT_SHADER, MESH_FRAGMENT), {
      a_position: 0,
      a_normal: 1,
      a_color: 2,
    });
    this.skyProgram = link(gl, compile(gl, gl.VERTEX_SHADER, SKY_VERTEX), compile(gl, gl.FRAGMENT_SHADER, SKY_FRAGMENT));
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
