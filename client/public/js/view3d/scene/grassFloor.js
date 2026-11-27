/**
 * Ground beyond the last grass ring shades like grass: the blades' clumps,
 * dry patches, wind waves and sun-through sheen (shared GLSL), and inside the
 * rings it darkens into the shaded floor between blades. Needs the `aGrass`
 * attribute (0..1 per vertex). Restyled from the reference's `grassFloor`.
 */
import { GRASS_GLSL } from "../assets/nature/grass.js";

/**
 * A material hook.
 * @param {{time: object, wind: object, sunDirV: object, sunCol: object}} uniforms shared uniforms
 * @param {{value: number}} outer the last ring's outer radius, metres
 * @returns {((shader: object) => void) & {key: string}}
 */
export function grassFloor(uniforms, outer) {
  const hook = (shader) => {
    Object.assign(shader.uniforms, { uTime: uniforms.time, uWind: uniforms.wind, uSunDirV: uniforms.sunDirV, uSunCol: uniforms.sunCol, uGR: outer });
    shader.vertexShader = `attribute float aGrass; varying float vGr; varying vec3 vTW;\n${shader.vertexShader.replace("#include <begin_vertex>", "#include <begin_vertex>\n vGr = aGrass; vTW = (modelMatrix * vec4(transformed, 1.0)).xyz;")}`; // i18n-ok
    shader.fragmentShader = `uniform float uTime, uWind, uGR; uniform vec3 uSunDirV, uSunCol; varying float vGr; varying vec3 vTW;\n${GRASS_GLSL}${shader.fragmentShader
      .replace("#include <color_fragment>", `#include <color_fragment>
        float tUnder = 0.0, tGr = vGr;
        {
          vec2 wp = vTW.xz; float fw = fwidth(wp.x) + fwidth(wp.y);
          float hi = 1.0 - smoothstep(0.6, 2.5, fw*0.31);
          float cl = mix(0.5, gNoise(wp*0.09), 1.0 - smoothstep(4.0, 14.0, fw))*0.6 + mix(0.5, gNoise(wp*0.31 + 7.0), hi)*0.4;
          float dry = gDry(wp);
          vec3 c = diffuseColor.rgb;
          vec3 gc = c*mix(vec3(1.0), vec3(1.12, 1.06, 0.74), dry*0.45)*(0.8 + cl*0.34);
          float dc = length(wp - cameraPosition.xz);
          tUnder = (1.0 - smoothstep(uGR*0.5, uGR*0.92, dc)) * tGr;
          gc *= mix(1.0, 0.8, tUnder);
          gc *= 1.0 + gGust(wp, uTime)*0.1*uWind*(1.0 - tUnder);
          diffuseColor.rgb = mix(c, gc, tGr);
        }`)
      .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>
        { float bl = pow(max(dot(normalize(-vViewPosition), uSunDirV), 0.0), 3.0); totalEmissiveRadiance += diffuseColor.rgb*uSunCol*bl*0.55*tGr*(1.0 - tUnder); }`)}`; // i18n-ok
  };
  return Object.assign(hook, { key: "gfloor" });
}
