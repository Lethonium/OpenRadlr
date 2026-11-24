/** GLSL of the crop fields: rows, tramlines, patchy ripeness and wind waves, all in the shader. */

export const CROP_VERTEX = `#include <begin_vertex>
  vF = aF; vec2 wp = (modelMatrix * vec4(transformed, 1.0)).xz; vXZ = wp;
  float wv = sin(dot(wp, vec2(0.075, 0.05)) - uTime * 1.25) * 0.6 + sin(dot(wp, vec2(-0.03, 0.09)) - uTime * 0.8) * 0.4;
  vWave = wv * uSway * uWind; transformed.xz += vec2(0.55, 0.35) * vWave * aF.z * aF.z * 0.35;`;

export const CROP_VERTEX_HEAD = "attribute vec3 aF; varying vec3 vF; varying float vWave; varying vec2 vXZ; uniform float uTime; uniform float uWind; uniform float uSway;\n"; // i18n-ok

export const CROP_FRAGMENT_HEAD = `uniform vec3 uA, uB, uSide, uSpeckC; uniform float uPeriod, uStripe, uSpeck, uTram, uFurrow; varying vec3 vF; varying float vWave; varying vec2 vXZ;
  float cHash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float cNoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f); return mix(mix(cHash(i), cHash(i+vec2(1,0)), f.x), mix(cHash(i+vec2(0,1)), cHash(i+vec2(1,1)), f.x), f.y); }
`;

export const CROP_COLOR = `#include <color_fragment>
  {
    float ph = vF.y / uPeriod * 6.2832; float r = 0.5 + 0.5 * sin(ph);
    float fw = fwidth(vF.y / uPeriod); float rowVis = 1.0 - smoothstep(0.25, 0.7, fw);
    vec3 col = mix(uA, uB, smoothstep(0.15, 0.95, r) * uStripe * rowVis + (1.0 - rowVis) * uStripe * 0.5);
    col *= mix(1.0, 0.78 + 0.32 * (0.5 + 0.5 * cos(ph)), uFurrow * rowVis);
    float n = cNoise(vXZ * 0.025) * 0.45 + cNoise(vXZ * 0.09) * 0.35 + cNoise(vXZ * 0.4) * 0.2; col *= 0.8 + n * 0.36;
    float sp = step(1.0 - uSpeck * 0.6, cHash(floor(vXZ * 2.2))) * uSpeck; col = mix(col, uSpeckC, sp * 0.45 * rowVis);
    float tl = abs(fract(vF.y / 18.0) - 0.5) * 18.0; col *= 1.0 - (1.0 - smoothstep(0.25, 0.55, tl)) * 0.35 * uTram;
    col *= 1.0 + vWave * 0.09;
    if (vF.z < 0.985) col = mix(uSide * 0.55, uSide, smoothstep(0.0, 0.9, vF.z));
    diffuseColor.rgb *= col;
  }`;
