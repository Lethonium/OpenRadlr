/**
 * Rivers and their bridges. The water is the reference's river shader on the
 * ribbons from the worker: flowing ripples that speed up and whiten where the
 * water falls, a pale edge, a sky sheen, sun glints and fog; blended, after
 * everything opaque. A frozen river (winter) is opaque ice with snow patches.
 * Bridges are plain lit meshes.
 */
import * as THREE from "../../three.js";
import { bridgeGeometry } from "../assets/props/bridge.js";
import { ICE_KIND } from "../../world/plan/riverStrips.js";
import { NOISE_GLSL } from "./noiseGlsl.js";
import { seaLight } from "./sea.js";
import { createOwner } from "./tracker.js";

const VERTEX = `attribute float aSteep; varying vec2 vUv; varying float vSt; varying vec3 vW;
  void main(){ vUv = uv; vSt = aSteep; vec4 wp = modelMatrix*vec4(position,1.); vW = wp.xyz; gl_Position = projectionMatrix*viewMatrix*wp; }`; // i18n-ok

const FRAGMENT = `uniform float uTime, uFogDensity, uLight, uAlpha, uIce; uniform vec3 uFogColor, uSunColor, uHorizon, uIceColor; varying vec2 vUv; varying float vSt; varying vec3 vW;
  ${NOISE_GLSL}
  void main(){
    float sp = 0.9 + vSt*3.5; float f = vUv.y - uTime*sp*(1.0 - uIce);
    float n = vnoise(vec2(vUv.x*5.0, f*3.0)); float n2 = vnoise(vec2(vUv.x*13.0+4.0, f*8.0));
    vec3 deep = vec3(0.025,0.16,0.21), light = vec3(0.09,0.36,0.42);
    vec3 col = mix(deep, light, smoothstep(0.25, 0.85, n*0.6+n2*0.4));
    float edge = smoothstep(0.32, 0.5, abs(vUv.x-0.5));
    col = mix(col, vec3(0.9,0.96,1.0), edge*0.35*n2);
    col = mix(col, vec3(0.93,0.97,1.0), clamp(vSt*1.6,0.,1.)*smoothstep(0.15,0.65,n2*0.7+n*0.5));
    vec3 V = normalize(cameraPosition - vW); float fres = pow(1.0 - max(V.y, 0.0), 3.0);
    col = mix(col, uHorizon*0.95, clamp(fres*0.85 + 0.12, 0.0, 0.9)*(1.0 - clamp(vSt*1.6,0.,1.)));
    col += uSunColor*pow(n2,10.0)*1.2;
    col = mix(col, uIceColor*(0.92 + 0.08*n), uIce);
    col *= uLight;
    float d = length(cameraPosition - vW); float fog = 1.0 - exp(-uFogDensity*uFogDensity*d*d);
    gl_FragColor = vec4(mix(col, uFogColor, fog), mix(uAlpha, 1.0, uIce));
  }`; // i18n-ok

/** Indexed geometry of the ribbons. */
function ribbonGeometry(strips) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(strips.positions, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(strips.uvs, 2));
  geometry.setAttribute("aSteep", new THREE.BufferAttribute(strips.flow, 1));
  geometry.setIndex(new THREE.BufferAttribute(strips.indices, 1));
  geometry.computeBoundingSphere();
  return geometry;
}

/** Snow patches and cracks on the ice, as one geometry with vertex colours. */
function iceGeometry(ice, style) {
  const colors = new Float32Array(ice.kinds.length * 3);
  ice.kinds.forEach((kind, i) => colors.set(kind === ICE_KIND.crack ? style.ice.crack ?? style.color : style.ice.color, i * 3));
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(ice.positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(new THREE.BufferAttribute(ice.indices, 1));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * @param {{strips: import("../../world/plan/riverStrips.js").RiverStrips, bridges?: {boxes: Float32Array, colors: Float32Array} | null,
 *   style: {color: number[], alpha?: number, ice?: {color: number[], crack?: number[]} | null}}} rivers
 * @param {{uniforms: {time: {value: number}}, track: import("./tracker.js").Tracker["track"]}} options
 */
export function createRiverLayer(rivers, { uniforms, track }) {
  const { own, disposeAll } = createOwner(track);
  const group = new THREE.Group();
  group.name = "rivers";
  const { style } = rivers;
  const frozen = Boolean(style.ice);
  const shader = {
    uTime: uniforms.time,
    uFogColor: { value: new THREE.Color() },
    uFogDensity: { value: 0.0002 },
    uLight: { value: 1 },
    uAlpha: { value: style.alpha ?? 0.85 },
    uIce: { value: frozen ? 1 : 0 },
    uSunColor: { value: new THREE.Color() },
    uHorizon: { value: new THREE.Color() },
    uIceColor: { value: new THREE.Color().setRGB(...style.color) },
  };
  if (rivers.strips.indices.length > 0) {
    const material = own(new THREE.ShaderMaterial({ uniforms: shader, vertexShader: VERTEX, fragmentShader: FRAGMENT, side: THREE.DoubleSide, transparent: !frozen, depthWrite: frozen }));
    const water = new THREE.Mesh(own(ribbonGeometry(rivers.strips)), material);
    water.name = "river-water";
    water.renderOrder = 1;
    group.add(water);
    if (frozen && rivers.strips.ice.indices.length > 0) {
      const patches = new THREE.Mesh(own(iceGeometry(rivers.strips.ice, style)), own(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide })));
      patches.name = "river-ice";
      patches.receiveShadow = true;
      group.add(patches);
    }
  }
  if (rivers.bridges?.boxes.length) {
    const bridges = new THREE.Mesh(own(bridgeGeometry(rivers.bridges)), own(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 })));
    bridges.name = "river-bridges";
    bridges.castShadow = bridges.receiveShadow = true;
    group.add(bridges);
  }
  return {
    object: group,
    update() {},
    setEnvironment(env) {
      shader.uFogColor.value.setRGB(...env.fogColor);
      shader.uFogDensity.value = env.fogDensity;
      shader.uLight.value = seaLight(env);
      shader.uSunColor.value.setRGB(...env.sunColor).multiplyScalar(env.night ? 0.3 : 1);
      shader.uHorizon.value.setRGB(...env.skyHorizon);
    },
    dispose() {
      group.clear();
      disposeAll();
    },
  };
}
