/**
 * GLSL snippets of the material hooks (grain, cloud shadows, height fog).
 * They live with the assets because assets and scene layers use them; the
 * post chain's shaders are in `engine/shaderChunks.js`.
 */

/** Value noise for the drifting cloud shadows. */
export const CLOUD_GLSL = `
  float csH(vec2 p){ p = fract(p*vec2(127.1, 311.7)); p += dot(p, p + 19.19); return fract(p.x*p.y); }
  float csN(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f); return mix(mix(csH(i), csH(i+vec2(1,0)), f.x), mix(csH(i+vec2(0,1)), csH(i+vec2(1,1)), f.x), f.y); }
  float cloudShade(vec2 wp, float t, float k){ if (k <= 0.001) return 1.0; vec2 q = wp*0.0022 + vec2(t*0.006, t*0.0035);
    float n = csN(q)*0.55 + csN(q*2.1 + 5.0)*0.3 + csN(q*4.3 + 9.0)*0.15; return 1.0 - k*smoothstep(0.48, 0.66, n); }
`;

/** Bump from the grain's screen-space derivatives. */
export const GRAIN_BUMP_GLSL = `
  vec3 gBump(vec3 sp, vec3 sn, vec2 dH){ vec3 sx = dFdx(sp), sy = dFdy(sp); vec3 r1 = cross(sy, sn), r2 = cross(sn, sx); float det = dot(sx, r1); vec3 g = sign(det)*(dH.x*r1 + dH.y*r2); return normalize(abs(det)*sn - g); }
`;

/** Vertex: world position and normal for the tri-planar grain. */
export const GRAIN_VERTEX = `#include <project_vertex>
  vec4 gW = vec4(transformed, 1.0); vec3 gN = objectNormal;
  #ifdef USE_INSTANCING
    gW = instanceMatrix * gW; gN = mat3(instanceMatrix) * gN;
  #endif
  gW = modelMatrix * gW; vGW = gW.xyz; vGN = normalize(mat3(modelMatrix) * gN);`;

/** Vertex: world xz for the cloud shadows. */
export const CLOUD_VERTEX = `#include <project_vertex>
  { vec4 cw = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
    cw = instanceMatrix * cw;
  #endif
  vCSW = (modelMatrix * cw).xz; }`;

/** Vertex: world position for the height fog. */
export const HEIGHT_FOG_VERTEX = `#include <project_vertex>
  { vec4 hw = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
    hw = instanceMatrix * hw;
  #endif
  vHFW = (modelMatrix * hw).xyz; }`;

/** Fragment: Three's exp2 fog, thinner above `uHFBase` metres. */
export const HEIGHT_FOG_FRAGMENT = `#ifdef USE_FOG
  float hfThin = exp(-max(vHFW.y - uHFBase, 0.0) * uHFFall);
  float hfFactor = (1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth)) * hfThin;
  gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, clamp(hfFactor, 0.0, 1.0));
#endif`;
