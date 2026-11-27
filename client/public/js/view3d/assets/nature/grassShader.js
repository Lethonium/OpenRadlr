/**
 * GLSL of the grass rings. `GRASS_GLSL` is shared with the terrain shader, so
 * far ground has the same clumps, dry patches and gusts as the blades.
 */
import { CLOUD_GLSL } from "../hookChunks.js";

export const GRASS_GLSL = `
  float gHash(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x*p.y); }
  float gNoise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.0 - 2.0*f);
    return mix(mix(gHash(i), gHash(i + vec2(1,0)), u.x), mix(gHash(i + vec2(0,1)), gHash(i + vec2(1,1)), u.x), u.y); }
  float gClump(vec2 wp){ return gNoise(wp*0.09)*0.6 + gNoise(wp*0.31 + 7.0)*0.4; }
  float gDry(vec2 wp){ return smoothstep(0.6, 0.88, gNoise(wp*0.021 + 3.0)*0.7 + gNoise(wp*0.11)*0.3); }
  float gGust(vec2 wp, float t){ float g = sin(dot(wp, vec2(0.8, 0.6))*0.085 - t*1.6)*0.5 + 0.5; return g*g; }
`;

/** Declarations at the top of the vertex shader: ground height sampling, noise, cloud shade. */
export const GRASS_VERTEX_HEAD = `
  attribute vec3 aOff; uniform vec3 uCam; uniform float uSize, uROut, uWorld, uRes, uBlade, uBladeW, uTime, uWind, uCSK; uniform vec2 uFadeIn; uniform sampler2D uH, uC, uK; uniform vec4 uKBox;
  varying vec3 vGCol; varying float vGY;
  ${GRASS_GLSL}
  ${CLOUD_GLSL}
  float hS(vec2 wp){ vec2 gg = (wp + uWorld*0.5)/uWorld*(uRes-1.0); vec2 i = floor(gg); vec2 f = gg - i; float d = 1.0/uRes; vec2 t = (i+0.5)*d;
    float a = texture2D(uH, t).r, b = texture2D(uH, t+vec2(d,0.0)).r, c = texture2D(uH, t+vec2(0.0,d)).r, e = texture2D(uH, t+vec2(d,d)).r;
    return (f.x+f.y <= 1.0) ? a + (b-a)*f.x + (c-a)*f.y : e + (c-e)*(1.0-f.x) + (b-e)*(1.0-f.y); }
`;

/** Replaces `beginnormal_vertex`: places, bends and colours one blade. */
export const GRASS_VERTEX_BLADE = `
  vec2 p = aOff.xy; p += floor((uCam.xz - p)/uSize + 0.5)*uSize; float rnd = aOff.z;
  vec2 tuv = (p + uWorld*0.5)/uWorld*(uRes-1.0)/uRes + 0.5/uRes;
  vec4 tc = texture2D(uC, tuv);
  float dist = length(p - uCam.xz);
  // The coarse density, cut back to zero on the plan's road, river and built cells (finer than the ground texture).
  float dens = tc.a * texture2D(uK, (p - uKBox.xy)/uKBox.zw).r;
  float fade = (1.0 - smoothstep(uROut*0.8, uROut, dist)) * (uFadeIn.x < 0.0 ? 1.0 : smoothstep(uFadeIn.x, uFadeIn.y, dist));
  float keep = step(fract(rnd*13.73), dens*fade);
  float clump = gClump(p);
  float hgt = keep*uBlade*mix(0.6, 1.12, fract(rnd*7.31))*(0.5 + 0.5*dens)*mix(0.62, 1.4, clump);
  float ang = rnd*6.2831853; float ca = cos(ang), sa = sin(ang);
  vec3 lp = position; float yn = position.y; lp.x *= uBladeW*(0.7 + 0.6*fract(rnd*3.3)); lp.y *= hgt;
  vec3 xa = vec3(ca, 0.0, sa);
  vec3 r = vec3(lp.x*ca - lp.z*sa, lp.y, lp.x*sa + lp.z*ca);
  vec2 wd = normalize(vec2(0.8, 0.6) + 0.35*vec2(sin(rnd*31.0), cos(rnd*17.0)));
  float gust = gGust(p, uTime);
  float bend = (0.45*fract(rnd*5.1) + 0.12 + (gust*0.6 + sin(uTime*4.7 + rnd*40.0)*0.07)*uWind)*yn*yn;
  r.xz += wd*bend*hgt; r.y -= bend*bend*hgt*0.35;
  vec3 gPos = vec3(p.x, hS(p) - 0.03, p.y) + r;
  vec3 objectNormal = normalize(vec3(0.0, 1.0, 0.0) + xa*position.x*1.2 + vec3(wd.x, 0.0, wd.y)*bend*0.6);
  vGY = yn;
  float dry = gDry(p);
  vec3 base = tc.rgb*mix(vec3(1.0), vec3(1.12, 1.06, 0.74), dry*0.45 + fract(rnd*2.71)*0.12);
  base *= 0.86 + clump*0.26;
  vGCol = base*mix(0.6, 1.16, yn*yn*0.5 + yn*0.5);
  vGCol = mix(vGCol, vGCol*vec3(1.08, 1.06, 0.84), smoothstep(0.75, 1.0, yn)*0.4);
  vGCol *= 1.0 + gust*0.08*uWind;
  vGCol *= cloudShade(p, uTime, uCSK);
`;

export const GRASS_FRAGMENT_HEAD = "uniform float uGlow; uniform vec3 uSunDirV; uniform vec3 uSunCol; varying vec3 vGCol; varying float vGY;\n"; // i18n-ok

export const GRASS_EMISSIVE = `#include <emissivemap_fragment>
  totalEmissiveRadiance += vGCol*uGlow*vGY; { float bl = pow(max(dot(normalize(-vViewPosition), uSunDirV), 0.0), 3.0); totalEmissiveRadiance += vGCol*uSunCol*bl*vGY*1.2; }`;
