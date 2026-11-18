import assert from "node:assert/strict";
import test from "node:test";
import { Renderer } from "../public/js/view3d/renderer.js";

function fakeGl() {
  const state = { programs: [], buffers: [], bufferData: [], divisors: [], instancedDraws: [], deleted: [], active: null };
  let nextId = 0;
  const object = () => ({ id: ++nextId });
  const gl = {
    state,
    canvas: { width: 320, height: 200 },
    VERTEX_SHADER: 1,
    FRAGMENT_SHADER: 2,
    COMPILE_STATUS: 3,
    LINK_STATUS: 4,
    FLOAT: 5,
    TRIANGLES: 6,
    STATIC_DRAW: 7,
    ARRAY_BUFFER: 8,
    DEPTH_TEST: 9,
    CULL_FACE: 10,
    BLEND: 11,
    SRC_ALPHA: 12,
    ONE_MINUS_SRC_ALPHA: 13,
    DEPTH_BUFFER_BIT: 14,
    COLOR_BUFFER_BIT: 15,
    TEXTURE0: 16,
    TEXTURE_2D: 17,
    createShader: object,
    shaderSource() {},
    compileShader() {},
    getShaderParameter: () => true,
    getShaderInfoLog: () => "",
    createProgram() {
      const program = object();
      state.programs.push(program);
      return program;
    },
    attachShader() {},
    bindAttribLocation() {},
    linkProgram() {},
    getProgramParameter: () => true,
    getProgramInfoLog: () => "",
    getAttribLocation: (_program, name) => ({ a_position: 0, a_normal: 1, a_color: 2, a_corner: 0, a_seed: 1 })[name] ?? -1,
    getUniformLocation: (_program, name) => name,
    useProgram(program) { state.active = program; },
    createVertexArray: object,
    bindVertexArray() {},
    createBuffer: object,
    bindBuffer(_target, buffer) { state.boundBuffer = buffer; },
    bufferData(_target, data) { state.bufferData.push({ buffer: state.boundBuffer, bytes: data.byteLength ?? data }); },
    enableVertexAttribArray() {},
    vertexAttribPointer() {},
    vertexAttribDivisor(location, divisor) { state.divisors.push({ location, divisor }); },
    drawArrays() {},
    drawArraysInstanced(_mode, _first, count, instances) { state.instancedDraws.push({ program: state.active, count, instances }); },
    deleteVertexArray(handle) { state.deleted.push(handle.id); },
    deleteBuffer(buffer) { state.deleted.push(buffer.id); },
    enable() {},
    disable() {},
    blendFunc() {},
    uniformMatrix4fv() {},
    uniform1f() {},
    uniform1i() {},
    uniform2fv() {},
    uniform3fv() {},
    clearColor() {},
    clear() {},
    depthMask() {},
    polygonOffset() {},
    uniform4fv() {},
    activeTexture() {},
    bindTexture() {},
  };
  return gl;
}

const triangle = () => ({
  positions: new Float32Array(9),
  normals: new Float32Array(9),
  colors: new Float32Array(12),
  vertexCount: 3,
});
const identity = () => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

test("an instance batch shares model buffers, draws repeatedly and owns only its transform buffer", () => {
  const gl = fakeGl();
  const renderer = new Renderer(gl);
  const model = renderer.upload(triangle());
  const programs = gl.state.programs.length;
  const matrices = new Float32Array([...identity(), ...identity()]);
  const batch = renderer.uploadInstances(model, matrices);

  assert.equal(gl.state.programs.length, programs + 2, "colour and depth variants compile lazily");
  assert.deepEqual(gl.state.divisors, [3, 4, 5, 6].map((location) => ({ location, divisor: 1 })));
  assert.equal(gl.state.bufferData.length, 4, "three shared model buffers plus one transform buffer");
  assert.equal(gl.state.bufferData.at(-1).bytes, 128);

  renderer.drawInstanced(batch, identity());
  renderer.drawShadowCasterInstanced(batch, identity());
  assert.equal(gl.state.instancedDraws.length, 2);
  assert.deepEqual(gl.state.instancedDraws.map(({ count, instances }) => ({ count, instances })), [{ count: 3, instances: 2 }, { count: 3, instances: 2 }]);
  assert.notEqual(gl.state.instancedDraws[0].program, gl.state.instancedDraws[1].program, "opaque and shadow use their own shaders");

  renderer.dispose(batch);
  assert.equal(gl.state.deleted.includes(batch.buffers[0].id), true);
  assert.equal(gl.state.deleted.includes(model.buffers[0].id), false, "the shared model survives its batches");
  renderer.dispose(model);
  assert.equal(gl.state.deleted.includes(model.buffers[0].id), true);
});

test("scenery without instances compiles only the ordinary programs", () => {
  const gl = fakeGl();
  const renderer = new Renderer(gl);
  const programs = gl.state.programs.length;
  renderer.upload(triangle());
  assert.equal(gl.state.programs.length, programs);
  assert.equal(gl.state.instancedDraws.length, 0);
});

const frame = (extra = {}) => ({
  viewProjection: identity(),
  inverseViewProjection: identity(),
  camera: [0, 0, 0],
  zenith: [0.3, 0.5, 0.8],
  horizon: [0.8, 0.8, 0.8],
  ground: [0.4, 0.4, 0.3],
  sun: [0, 1, 0],
  sunColor: [1, 1, 1],
  fog: [100, 1000],
  ...extra,
});

/** The fake gl, recording every `uniform1f` as {name, value}. */
function recordingGl() {
  const gl = fakeGl();
  gl.state.floats = [];
  gl.uniform1f = (name, value) => gl.state.floats.push({ name, value });
  return gl;
}
const lastFloat = (gl, name) => gl.state.floats.findLast((entry) => entry.name === name)?.value;

test("begin hands the frame's sun scatter and saturation to the opaque shader", () => {
  const gl = recordingGl();
  new Renderer(gl).begin(frame({ sunScatter: 0.4, saturation: 1.1 }));
  assert.equal(lastFloat(gl, "u_sunScatter"), 0.4);
  assert.equal(lastFloat(gl, "u_saturation"), 1.1);
});

test("begin without sun scatter or saturation renders as before", () => {
  const gl = recordingGl();
  new Renderer(gl).begin(frame());
  assert.equal(lastFloat(gl, "u_sunScatter"), 0);
  assert.equal(lastFloat(gl, "u_saturation"), 1);
  assert.equal(lastFloat(gl, "u_specular"), 0);
});

test("a transparent draw sets its specular glint and resets it afterwards", () => {
  const gl = recordingGl();
  const renderer = new Renderer(gl);
  const handle = renderer.upload(triangle());
  renderer.drawTransparent(handle, identity(), { alpha: 0.8, specular: 0.6 });
  const values = gl.state.floats.filter((entry) => entry.name === "u_specular").map((entry) => entry.value);
  assert.deepEqual(values, [0.6, 0]);
});
