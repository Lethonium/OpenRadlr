/**
 * The sea: one wave-displaced plane that follows the camera, shaded by the
 * reference's ocean shader (depth colour, fresnel sky, sun glints, shore foam,
 * white caps). Shore depth comes from two height textures made from the
 * ground grids: the fine near grid and the coarse far one.
 */
import * as THREE from "../../three.js";
import { NOISE_GLSL } from "./noiseGlsl.js";
import { createOwner } from "./tracker.js";

/** Plane size and subdivisions (a vertex every ~73 m, finer than the shortest wave) and the depth the texture covers. */
export const SEA = Object.freeze({ size: 16000, segments: 220, depthRange: 72 });
const CELL = SEA.size / SEA.segments;

/**
 * How many times the plane is stretched (in whole steps, so the snapping below stays on the
 * same lattice) for its half edge to reach `far`, the lens' far plane: past the plane's edge
 * the sky would show through as flat wedges.
 * @param {number} far
 * @returns {number}
 */
export function seaScale(far) {
  return Math.max(1, Math.ceil((far * 1.05) / (SEA.size / 2)));
}
const SHALLOW = "#4fe0cf";
const DEEP = "#0d4f86";

/**
 * How bright the water is: the sun's elevation lifts it from a dark night
 * level to full day (the reference's `U.light`).
 * @param {{sun: ArrayLike<number>, night: number}} env
 * @returns {number}
 */
export function seaLight(env) {
  if (env.night) return 0.18;
  const t = Math.min(1, Math.max(0, env.sun[1] / 0.3));
  return 0.18 + 0.82 * t * t * (3 - 2 * t);
}

/** Metres from a depth grid's border over which the water deepens to the full depth: outside the grid the sea is deep, a shelf that ends at the border would show as a straight line. */
const EDGE_FADE = 64;

/** Water depth below the sea level as RGBA bytes: red is depth over `SEA.depthRange`, clamped, and full at the grid's border. */
export function seaDepthData(grid) {
  const data = new Uint8Array(grid.columns * grid.rows * 4);
  for (let j = 0; j < grid.rows; j += 1) {
    for (let i = 0; i < grid.columns; i += 1) {
      const k = j * grid.columns + i;
      const t = Math.min(1, (Math.min(i, j, grid.columns - 1 - i, grid.rows - 1 - j) * grid.cell) / EDGE_FADE);
      const deepen = 1 - t * t * (3 - 2 * t);
      const depth = Math.min(1, Math.max(0, (grid.water - grid.heights[k]) / SEA.depthRange));
      data[k * 4] = Math.round((depth + (1 - depth) * deepen) * 255);
      data[k * 4 + 3] = 255;
    }
  }
  return data;
}

/** Water depth below the sea level as a texture (see `seaDepthData`). */
function depthTexture(grid) {
  const data = seaDepthData(grid);
  const texture = new THREE.DataTexture(data, grid.columns, grid.rows, THREE.RGBAFormat);
  texture.magFilter = texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

/** Where a grid sits, for the shader: x0, z0, cell, columns (vec4) and rows. */
const placement = (grid) => new THREE.Vector4(grid.x0, grid.z0, grid.cell, grid.columns);

const VERTEX = `uniform float uTime; varying vec3 vW;
  void main(){ vec4 wp = modelMatrix*vec4(position,1.);
    wp.y += sin(wp.x*0.021+uTime*0.9)*0.32 + sin(wp.z*0.027+uTime*1.1)*0.28 + sin((wp.x+wp.z)*0.05+uTime*1.7)*0.1;
    vW = wp.xyz; gl_Position = projectionMatrix*viewMatrix*wp; }`; // i18n-ok

const FRAGMENT = `uniform float uTime, uFogDensity, uFar, uNight, uLight, uWinter, uDepthRange, uNearRows, uFarRows;
  uniform vec3 uSunDir, uSunColor, uHorizon, uSkyTop, uFogColor, uShallow, uDeep;
  uniform vec4 uNear, uFarGrid; uniform sampler2D uNearDepth, uFarDepth; varying vec3 vW;
  ${NOISE_GLSL}
  // Depth in metres below the sea at p: the fine grid where it covers p, else the coarse one, else deep water.
  float seaDepth(vec2 p){
    vec2 nu = (p - uNear.xy) / uNear.z; vec2 ns = vec2(uNear.w, uNearRows);
    if (nu.x >= 0.0 && nu.y >= 0.0 && nu.x <= ns.x - 1.0 && nu.y <= ns.y - 1.0) return texture2D(uNearDepth, (nu + 0.5) / ns).r * uDepthRange;
    vec2 fu = (p - uFarGrid.xy) / uFarGrid.z; vec2 fs = vec2(uFarGrid.w, uFarRows);
    if (fu.x >= 0.0 && fu.y >= 0.0 && fu.x <= fs.x - 1.0 && fu.y <= fs.y - 1.0) return texture2D(uFarDepth, (fu + 0.5) / fs).r * uDepthRange;
    return uDepthRange;
  }
  void main(){
    vec2 p = vW.xz; float t = uTime;
    vec2 g = vec2(cos(p.x*0.021+t*0.9)*0.32*0.021 + cos((p.x+p.y)*0.05+t*1.7)*0.1*0.05,
                  cos(p.y*0.027+t*1.1)*0.28*0.027 + cos((p.x+p.y)*0.05+t*1.7)*0.1*0.05);
    vec2 q = p*0.18; vec2 o1 = vec2(t*0.35,t*0.22), o2 = vec2(-t*0.27,t*0.31);
    float a0=vnoise(q+o1), ax=vnoise(q+o1+vec2(.3,0.)), az=vnoise(q+o1+vec2(0.,.3));
    float b0=vnoise(q*2.7+o2), bx=vnoise(q*2.7+o2+vec2(.3,0.)), bz=vnoise(q*2.7+o2+vec2(0.,.3));
    g += vec2(ax-a0, az-a0)*0.55 + vec2(bx-b0,bz-b0)*0.3;
    vec3 N = normalize(vec3(-g.x, 1.0, -g.y));
    vec3 V = normalize(cameraPosition - vW);
    float depth = seaDepth(p);
    vec3 water = mix(uShallow, uDeep, smoothstep(0.0, 26.0, depth));
    water = mix(water, water*vec3(0.7,0.85,1.0)+vec3(0.0,0.02,0.05), uWinter*0.7);
    float diff = max(dot(N, uSunDir), 0.0)*0.45 + 0.55;
    vec3 col = water * diff * uLight;
    vec3 R = reflect(-V, N);
    float rv = clamp(R.y, 0.0, 1.0);
    vec3 skyR = mix(uHorizon, uSkyTop, pow(rv, 0.55));
    float frs = 0.02 + 0.98*pow(1.0 - max(dot(N, V), 0.0), 5.0);
    col = mix(col, skyR, clamp(frs*1.1, 0.0, 0.85));
    float sp = pow(max(dot(R, uSunDir), 0.0), 260.0) + pow(max(dot(R, uSunDir), 0.0), 18.0)*0.04;
    col += uSunColor * sp * 4.0;
    float n = vnoise(p*0.25 + vec2(t*0.2, 0.0));
    float shore = 1.0 - smoothstep(0.0, 2.6, depth);
    float band = sin(depth*3.2 - t*2.0 + n*5.0)*0.5+0.5;
    float foam = shore*smoothstep(0.6, 0.95, band + shore*0.35) + (1.0 - smoothstep(0.0, 0.55, depth));
    foam = clamp(foam * (0.7+0.5*n), 0.0, 1.0);
    float dc = length(cameraPosition - vW); // whitecaps fade in with distance: close up they read as hard paper blobs, so they thin out and soften there
    float caps = smoothstep(0.7, 1.0, vnoise(p*0.06+vec2(t*0.1,-t*0.07))*vnoise(p*0.3-o1)*1.6) * smoothstep(10.,30.,depth) * smoothstep(80.0, 500.0, dc) * (1.0 - smoothstep(250.0, 1500.0, dc)); // far white caps are sub-pixel and only speckle
    col = mix(col, vec3(0.95,0.98,1.0)*uLight, max(foam*0.85, caps*0.4));
    float dist = length(cameraPosition - vW);
    float fog = 1.0 - exp(-uFogDensity*uFogDensity*dist*dist);
    fog = max(fog, smoothstep(0.7*uFar, 0.95*uFar, dist)); // the far plane cuts the sea: end in the fog colour, not in a ragged edge
    gl_FragColor = vec4(mix(col, uFogColor, fog), 1.0);
  }`; // i18n-ok

/**
 * The sea layer at the grid's water level.
 * @param {{near: import("../../world/groundGrid.js").GroundGrid, far: import("../../world/groundGrid.js").GroundGrid}} ground
 * @param {{uniforms: {time: {value: number}}, track: import("./tracker.js").Tracker["track"]}} options
 */
export function createSea(ground, { uniforms, track }) {
  const { own, disposeAll } = createOwner(track);
  const { near, far } = ground;
  const shader = {
    uTime: uniforms.time,
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uSunColor: { value: new THREE.Color() },
    uHorizon: { value: new THREE.Color() },
    uSkyTop: { value: new THREE.Color() },
    uFogColor: { value: new THREE.Color() },
    uFogDensity: { value: 0.0002 },
    uNight: { value: 0 },
    uLight: { value: 1 },
    uWinter: { value: 0 },
    uShallow: { value: new THREE.Color(SHALLOW) },
    uDeep: { value: new THREE.Color(DEEP) },
    uDepthRange: { value: SEA.depthRange },
    uNear: { value: placement(near) },
    uNearRows: { value: near.rows },
    uNearDepth: { value: own(depthTexture(near)) },
    uFarGrid: { value: placement(far ?? near) },
    uFar: { value: 9000 },
    uFarRows: { value: (far ?? near).rows },
    uFarDepth: { value: own(depthTexture(far ?? near)) },
  };
  const geometry = own(new THREE.PlaneGeometry(SEA.size, SEA.size, SEA.segments, SEA.segments));
  geometry.rotateX(-Math.PI / 2);
  const material = own(new THREE.ShaderMaterial({ uniforms: shader, vertexShader: VERTEX, fragmentShader: FRAGMENT }));
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "sea";
  mesh.frustumCulled = false;
  mesh.position.y = near.water;
  const eye = new THREE.Vector3();

  return {
    object: mesh,
    /** Follows the camera in whole vertex steps, so the waves (a function of world position) never swim. */
    update({ camera }) {
      camera.getWorldPosition(eye);
      const scale = seaScale(camera.far);
      shader.uFar.value = camera.far;
      mesh.scale.set(scale, 1, scale);
      mesh.position.x = Math.round(eye.x / (CELL * scale)) * CELL * scale;
      mesh.position.z = Math.round(eye.z / (CELL * scale)) * CELL * scale;
    },
    setEnvironment(env) {
      const moonlit = env.night > 0;
      shader.uSunDir.value.fromArray(moonlit ? env.moon : env.sun);
      shader.uSunColor.value.setRGB(...env.sunColor).multiplyScalar(moonlit ? 0.3 : 1);
      shader.uHorizon.value.setRGB(...env.skyHorizon);
      shader.uSkyTop.value.setRGB(...env.skyTop);
      shader.uFogColor.value.setRGB(...env.fogColor);
      shader.uFogDensity.value = env.fogDensity;
      shader.uNight.value = env.night;
      shader.uLight.value = seaLight(env);
      shader.uWinter.value = env.snow;
    },
    dispose() {
      disposeAll();
    },
  };
}
