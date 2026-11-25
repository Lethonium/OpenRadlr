/**
 * The sky dome: gradient, sun disc and glow, moon and stars by night, and a
 * cloud layer, from the reference's sky shader (no aurora, rainbow or floating
 * islands). It follows the camera and draws behind everything.
 */
import * as THREE from "../../three.js";
import { NOISE_GLSL } from "./noiseGlsl.js";
import { createOwner } from "./tracker.js";

/** Cloud cover of a clear sky and how the clouds read at night (the shader dims them with the day). */
export const SKY = Object.freeze({ radius: 5000, cloudAmount: 0.9, cloudiness: 0 });

/**
 * The haze band over the sky's lower part, in the scene's fog colour: 1 at and below the horizon, falling to 0 at
 * the band's height. The height grows with the fog's thickness towards the horizon (`density` x the far plane's
 * distance, so a long view through thin air hazes as much as a short one through thick), so the fogged sea ends
 * in sky of its own colour rather than in a line, and the clear ride keeps a clear sky above a narrow band.
 */
export const HAZE = Object.freeze({ k: 0.06, min: 0.02, max: 0.6 });

/** The band's height as the sine of an elevation, for a fog `thickness` (density x distance). */
export const hazeHeight = (thickness) => Math.min(HAZE.max, Math.max(HAZE.min, HAZE.k * thickness * thickness));

/** How much of the fog colour covers the sky at sine-of-elevation `elevation`: 1 at and below the horizon, 0 above the band. */
export function hazeBand(elevation, thickness) {
  const t = Math.min(1, Math.max(0, elevation / hazeHeight(thickness)));
  return 1 - t * t * (3 - 2 * t);
}

const VERTEX = "varying vec3 vD; void main(){ vD = position; vec4 p = projectionMatrix*modelViewMatrix*vec4(position,1.); gl_Position = p.xyww; }"; // i18n-ok

const FRAGMENT = `uniform vec3 uTop,uHorizon,uBottom,uSunDir,uMoonDir,uSunColor; uniform vec3 uFogColor; uniform float uNight,uStars,uTime,uDay,uCloudAmt,uCloudy,uFogDensity,uFar; varying vec3 vD;
  ${NOISE_GLSL}
  float h3(vec3 p){ p=fract(p*0.3183099+.1); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
  void main(){ vec3 d = normalize(vD); float h = d.y;
    vec3 col = mix(uHorizon, uTop, pow(clamp(h,0.,1.), 0.55));
    col = mix(col, uBottom, smoothstep(0.0, -0.12, h));
    float sd = max(dot(d, uSunDir), 0.0);
    if(uStars > 0.01){
      vec3 p = d*260.0; vec3 c = floor(p); float r = h3(c);
      if(r > 0.993){ vec3 f = fract(p)-0.5; float s = 1.0 - smoothstep(0.0, 0.16, length(f));
        col += vec3(0.9,0.95,1.0)*s*uStars*(0.55+0.45*sin(uTime*2.5+r*90.0))*smoothstep(0.0,0.25,h)*2.2; }
    }
    if(uNight > 0.01){
      float md = dot(d, uMoonDir);
      col += vec3(1.0,0.97,0.88)*smoothstep(0.99955,0.9997,md)*uNight*2.6 + vec3(0.35,0.45,0.8)*pow(max(md,0.0),40.0)*0.35*uNight;
    }
    if(uCloudAmt > 0.01 && h > 0.0){
      vec2 cp = d.xz/(h+0.1)*0.75 + vec2(uTime*0.006, uTime*0.0025);
      float n = 0.0, a = 0.5; vec2 q = cp; for(int i=0;i<5;i++){ n += a*vnoise(q); q *= 2.07; a *= 0.5; }
      float cov = mix(0.58, 0.3, uCloudy); float c = smoothstep(cov, cov + 0.22, n) * smoothstep(0.0, 0.18, h);
      float n2 = 0.0; a = 0.5; q = cp + vec2(0.05, 0.03); for(int i=0;i<4;i++){ n2 += a*vnoise(q); q *= 2.07; a *= 0.5; }
      float belly = clamp((n - n2)*6.0 + 0.6, 0.35, 1.0);
      float lit = (0.7 + 0.35*pow(max(dot(d, uSunDir), 0.0), 3.0)) * belly;
      vec2 ci = d.xz/(h+0.25)*vec2(0.35, 1.6) + vec2(uTime*0.002, 0.0); float cr = smoothstep(0.55, 0.8, vnoise(ci*1.3)*0.6 + vnoise(ci*4.1)*0.4) * smoothstep(0.05, 0.35, h) * 0.45 * uDay;
      col = mix(col, vec3(1.0, 0.98, 0.96)*mix(0.4, 1.0, uDay) + uSunColor*0.1, cr*uCloudAmt*(1.0 - uCloudy*0.5));
      vec3 cc = mix(uHorizon*0.9 + vec3(0.06), vec3(1.0, 0.98, 0.95), 0.55*uDay) * mix(0.25, 1.0, uDay) * lit * mix(1.0, 0.62, uCloudy);
      cc += uSunColor*pow(max(dot(d, uSunDir), 0.0), 8.0)*0.25;
      col = mix(col, cc, c*uCloudAmt);
    }
    float hh = clamp(${HAZE.k.toFixed(3)}*pow(uFogDensity*uFar, 2.0), ${HAZE.min.toFixed(3)}, ${HAZE.max.toFixed(3)});
    col = mix(col, uFogColor, 1.0 - smoothstep(0.0, hh, h));
    col += uSunColor*(smoothstep(0.9994,0.99965,sd)*18.0*uDay + pow(sd,9.0)*0.45 + pow(sd,2.5)*0.12);
    gl_FragColor = vec4(col, 1.0);
  }`; // i18n-ok

/**
 * The sky layer.
 * @param {{uniforms: {time: {value: number}}, track: import("./tracker.js").Tracker["track"]}} options
 */
export function createSky({ uniforms, track }) {
  const { own, disposeAll } = createOwner(track);
  const shader = {
    uTop: { value: new THREE.Color() },
    uHorizon: { value: new THREE.Color() },
    uBottom: { value: new THREE.Color() },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uMoonDir: { value: new THREE.Vector3(0, -1, 0) },
    uSunColor: { value: new THREE.Color() },
    uNight: { value: 0 },
    uStars: { value: 0 },
    uTime: uniforms.time,
    uDay: { value: 1 },
    uCloudAmt: { value: SKY.cloudAmount },
    uCloudy: { value: SKY.cloudiness },
    uFogColor: { value: new THREE.Color() },
    uFogDensity: { value: 0 },
    uFar: { value: 9000 },
  };
  const geometry = own(new THREE.SphereGeometry(SKY.radius, 48, 24));
  const material = own(new THREE.ShaderMaterial({ uniforms: shader, vertexShader: VERTEX, fragmentShader: FRAGMENT, side: THREE.BackSide, depthWrite: false, fog: false }));
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "sky";
  mesh.frustumCulled = false;
  mesh.renderOrder = -1;

  return {
    object: mesh,
    update({ camera }) {
      camera.getWorldPosition(mesh.position);
      shader.uFar.value = camera.far;
    },
    setEnvironment(env) {
      shader.uTop.value.setRGB(...env.skyTop);
      shader.uHorizon.value.setRGB(...env.skyHorizon);
      shader.uBottom.value.setRGB(...env.skyBottom);
      shader.uSunDir.value.fromArray(env.sun);
      shader.uMoonDir.value.fromArray(env.moon);
      shader.uSunColor.value.setRGB(...env.sunColor);
      shader.uNight.value = env.night;
      shader.uStars.value = env.stars;
      shader.uDay.value = 1 - env.night;
      shader.uFogColor.value.setRGB(...env.fogColor);
      shader.uFogDensity.value = env.fogDensity;
      shader.uCloudy.value = env.overcast ?? SKY.cloudiness;
    },
    dispose() {
      disposeAll();
    },
  };
}
