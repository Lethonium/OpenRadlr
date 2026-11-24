/**
 * The GPU fall: a material hook that makes points or line segments fall, sway
 * and wrap round the camera inside a box, so rain, snow and the like cost one
 * draw call and no per-frame buffer writes. Each particle's position is a
 * seed in the box; its speed factor comes from the `aV` attribute.
 */

/** Edge of the box round the camera, metres (the vertical wrap is 70 m). */
export const FALL_BOX = 140;

/** The uniforms every falling material shares: the camera, the clock and the wind's drift. */
export function createFallUniforms() {
  return { uCam: { value: { x: 0, y: 0, z: 0 } }, uT: { value: 0 }, uWOff: { value: { x: 0, y: 0 } }, uBox: { value: FALL_BOX } };
}

const BEGIN_VERTEX = `
  vec3 p = position; float sd = aV * 917.0;
  p.y -= uT * uFall * aV; p.x += uWOff.x * uDrift + sin(uT * uSpin + sd) * uSway; p.z += uWOff.y * uDrift + cos(uT * uSpin * 0.8 + sd * 1.3) * uSway;
  p.x = uCam.x + mod(p.x - uCam.x + uBox * 0.5, uBox) - uBox * 0.5; p.z = uCam.z + mod(p.z - uCam.z + uBox * 0.5, uBox) - uBox * 0.5; p.y = uCam.y + mod(p.y - uCam.y + 30.0, 70.0) - 30.0;`; // i18n-ok

/**
 * Makes `material` fall.
 * @template {import("../../three.js").Material} M
 * @param {M} material
 * @param {{fall: number, sway: number, spin: number, drift: number, line?: boolean}} motion metres per second, metres, radians per second, share of the wind
 * @param {ReturnType<typeof createFallUniforms>} shared
 * @returns {M} the same material
 */
export function fallMaterial(material, { fall, sway, spin, drift, line = false }, shared) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, shared, { uFall: { value: fall }, uSway: { value: sway }, uSpin: { value: spin }, uDrift: { value: drift } });
    const streak = line ? " p.y += aEnd * 0.9;" : "";
    shader.vertexShader = `attribute float aV; ${line ? "attribute float aEnd; " : ""}uniform vec3 uCam; uniform vec2 uWOff; uniform float uT, uFall, uSway, uSpin, uDrift, uBox;\n${shader.vertexShader.replace("#include <begin_vertex>", `${BEGIN_VERTEX}${streak} vec3 transformed = p;`)}`; // i18n-ok
  };
  material.customProgramCacheKey = () => `fall${fall}|${sway}|${spin}|${line}`;
  return material;
}
