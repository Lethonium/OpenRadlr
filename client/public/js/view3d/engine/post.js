/**
 * The post-processing chain, ported from the reference renderer without the
 * comic ink pass: atmosphere (occlusion, sun rays, far depth of field), bloom,
 * then tone mapping with a colour grade. It starts from the engine's scene
 * target, which the scene has drawn into.
 */
import * as THREE from "../../three.js";
import { EffectComposer } from "../../../vendor/three/addons/postprocessing/EffectComposer.js";
import { UnrealBloomPass } from "../../../vendor/three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "../../../vendor/three/addons/postprocessing/OutputPass.js";
import { Pass, FullScreenQuad } from "../../../vendor/three/addons/postprocessing/Pass.js";
import { OutputShader } from "../../../vendor/three/addons/shaders/OutputShader.js";
import { QUAD_VERTEX, GRADE_GLSL, aoFragment, compositeFragment } from "./shaderChunks.js";
import { atmosOptions, gradeFor, postPlan } from "./postPlan.js";

/** Camera heights above the rider (metres) over which depth of field fades out. */
const DOF_FADE = Object.freeze([15, 45]);
const smoothstep = (edge0, edge1, x) => {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

/** Occlusion from depth (half or full resolution), sun rays and far depth of field in one pass. */
class AtmosPass extends Pass {
  constructor({ aoSamples, aoFull, raySamples }) {
    super();
    this.needsSwap = true;
    this.camera = null;
    this.aoDivisions = aoFull ? 0 : 1;
    this.aoTarget = new THREE.WebGLRenderTarget(2, 2, { type: THREE.HalfFloatType });
    this.aoMaterial = new THREE.ShaderMaterial({
      uniforms: { tDepth: { value: null }, uProj: { value: new THREE.Matrix4() }, uProjInv: { value: new THREE.Matrix4() }, uRes: { value: new THREE.Vector2(1, 1) }, uRadius: { value: 1.3 }, uAOFar: { value: 500 } },
      vertexShader: QUAD_VERTEX,
      fragmentShader: aoFragment(Math.max(1, aoSamples)),
    });
    this.compositeMaterial = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null }, tDepth: { value: null }, tAO: { value: null }, uAORes: { value: new THREE.Vector2(1, 1) },
        uAOStr: { value: aoSamples > 0 ? 0.9 : 0 }, uAOFar: { value: 500 }, uNear: { value: 0.1 }, uFar: { value: 1000 },
        uSun: { value: new THREE.Vector2(0.5, 0.8) }, uRays: { value: 0 }, uRayCol: { value: new THREE.Color(1, 0.9, 0.75) },
        uAspect: { value: 1 }, uDof: { value: 0 }, uDofA: { value: 320 }, uDofB: { value: 2200 }, uPx: { value: new THREE.Vector2(1, 1) },
      },
      vertexShader: QUAD_VERTEX,
      fragmentShader: compositeFragment(raySamples),
    });
    this.aoQuad = new FullScreenQuad(this.aoMaterial);
    this.compositeQuad = new FullScreenQuad(this.compositeMaterial);
  }

  setSize(width, height) {
    const aoWidth = Math.max(1, width >> this.aoDivisions);
    const aoHeight = Math.max(1, height >> this.aoDivisions);
    this.aoTarget.setSize(aoWidth, aoHeight);
    this.aoMaterial.uniforms.uRes.value.set(aoWidth, aoHeight);
    const u = this.compositeMaterial.uniforms;
    u.uPx.value.set(1 / Math.max(1, width), 1 / Math.max(1, height));
    u.uAORes.value.set(aoWidth, aoHeight);
    u.uAspect.value = width / height;
  }

  render(renderer, writeBuffer, readBuffer) {
    const camera = this.camera;
    const u = this.compositeMaterial.uniforms;
    const depth = readBuffer.depthTexture;
    if (u.uAOStr.value > 0) {
      const a = this.aoMaterial.uniforms;
      a.tDepth.value = depth;
      a.uAOFar.value = u.uAOFar.value;
      a.uProj.value.copy(camera.projectionMatrix);
      a.uProjInv.value.copy(camera.projectionMatrixInverse);
      renderer.setRenderTarget(this.aoTarget);
      this.aoQuad.render(renderer);
    }
    u.tDiffuse.value = readBuffer.texture;
    u.tDepth.value = depth;
    u.tAO.value = this.aoTarget.texture;
    u.uNear.value = camera.near;
    u.uFar.value = camera.far;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.compositeQuad.render(renderer);
  }

  dispose() {
    this.aoTarget.dispose();
    this.aoMaterial.dispose();
    this.compositeMaterial.dispose();
    this.aoQuad.dispose();
    this.compositeQuad.dispose();
  }
}

/** OutputPass whose shader also grades: saturation, tint, lift, contrast curve, vignette. */
function gradePass() {
  const pass = new OutputPass();
  Object.assign(pass.uniforms, { uSat: { value: 1 }, uVig: { value: 0.42 }, uTint: { value: new THREE.Vector3(1, 1, 1) }, uLift: { value: 0.05 }, uCurve: { value: 0.28 } });
  const shader = OutputShader.fragmentShader.replace("uniform sampler2D tDiffuse;", "uniform sampler2D tDiffuse; uniform float uSat, uVig, uLift, uCurve; uniform vec3 uTint;"); // i18n-ok
  const end = shader.lastIndexOf("}");
  pass.material.fragmentShader = shader.slice(0, end) + GRADE_GLSL + shader.slice(end);
  pass.material.needsUpdate = true;
  return pass;
}

/**
 * Builds the chain for one quality level on top of the engine's scene target.
 * @param {import("../../three.js").WebGLRenderer} renderer
 * @param {import("../../three.js").WebGLRenderTarget} target the scene target, with a depth texture
 * @param {import("../quality.js").QualitySettings} settings
 * @returns {{render: (camera: import("../../three.js").PerspectiveCamera, env: object, view?: {ride?: boolean}) => void,
 *   setSize: (width: number, height: number) => void, dispose: () => void}}
 */
export function createPost(renderer, target, settings) {
  const plan = postPlan(settings);
  const options = atmosOptions(settings, { ride: true });
  const composer = new EffectComposer(renderer, target);
  composer.setPixelRatio(1);
  composer.renderTarget2.samples = 0;
  composer.renderTarget2.depthTexture = new THREE.DepthTexture(target.width, target.height);
  const atmos = plan.includes("atmos") ? new AtmosPass(options) : null;
  if (atmos) composer.addPass(atmos);
  const bloom = plan.includes("bloom") ? new UnrealBloomPass(new THREE.Vector2(target.width / 2, target.height / 2), 0.3, 0.5, 0.97) : null;
  if (bloom) composer.addPass(bloom);
  const grade = gradePass();
  composer.addPass(grade);

  const sun = new THREE.Vector3();
  const eye = new THREE.Vector3();
  return {
    render(camera, env, { ride = false, height = 0 } = {}) {
      if (atmos) {
        atmos.camera = camera;
        const u = atmos.compositeMaterial.uniforms;
        camera.getWorldDirection(sun);
        const facing = sun.dot(new THREE.Vector3(...env.sun));
        sun.set(...env.sun).multiplyScalar(1000).add(camera.getWorldPosition(eye)).project(camera);
        u.uSun.value.set(sun.x * 0.5 + 0.5, sun.y * 0.5 + 0.5);
        u.uRays.value = !env.night && facing > 0 && options.raySamples > 0 ? 1 : 0;
        const peak = Math.max(...env.sunColor, 1e-3);
        u.uRayCol.value.setRGB(env.sunColor[0] / peak, env.sunColor[1] / peak, env.sunColor[2] / peak);
        // Far-only and mild, as in the reference's ride views; a camera high above the rider (a drone, a pinned view) is sharp.
        u.uDof.value = ride && options.depthOfField ? 1 - smoothstep(DOF_FADE[0], DOF_FADE[1], height) : 0;
      }
      const { saturation, tint } = gradeFor(env);
      grade.uniforms.uSat.value = saturation;
      grade.uniforms.uTint.value.set(...tint);
      // The scene target is always the one the chain starts from; a frame with an odd
      // number of swaps would otherwise start the next one from the other buffer.
      composer.readBuffer = composer.renderTarget1;
      composer.writeBuffer = composer.renderTarget2;
      composer.render(0);
    },
    setSize(width, height) {
      composer.setSize(width, height);
    },
    dispose() {
      composer.passes.forEach((pass) => pass.dispose?.());
      composer.renderTarget2.dispose();
    },
  };
}
