/**
 * GLSL strings of the post chain: the shared quad vertex shader, occlusion,
 * the composite (sun rays, depth of field) and the colour grade. The material
 * hooks' snippets are in `assets/hookChunks.js`.
 */

/** Shared vertex shader of the post chain's full-screen passes. */
export const QUAD_VERTEX = "varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }"; // i18n-ok

/**
 * Screen-space occlusion from depth alone (normals rebuilt from it).
 * @param {number} samples
 */
export const aoFragment = (samples) => `#define AS ${samples}
  uniform sampler2D tDepth; uniform mat4 uProj, uProjInv; uniform vec2 uRes; uniform float uRadius, uAOFar; varying vec2 vUv;
  vec3 vpos(vec2 uv){ float d = texture2D(tDepth, uv).x; vec4 v = uProjInv*vec4(uv*2.0-1.0, d*2.0-1.0, 1.0); return v.xyz/v.w; }
  void main(){
    float d = texture2D(tDepth, vUv).x; if(d >= 0.99999){ gl_FragColor = vec4(1.0, 60000.0, 0.0, 1.0); return; }
    vec3 P = vpos(vUv); if (-P.z > uAOFar) { gl_FragColor = vec4(1.0, min(-P.z, 60000.0), 0.0, 1.0); return; } vec2 px = 1.0/uRes;
    vec3 Pr = vpos(vUv+vec2(px.x,0.0)), Pl = vpos(vUv-vec2(px.x,0.0)), Pu = vpos(vUv+vec2(0.0,px.y)), Pd = vpos(vUv-vec2(0.0,px.y));
    vec3 dx = abs(Pr.z-P.z) < abs(Pl.z-P.z) ? Pr-P : P-Pl; vec3 dy = abs(Pu.z-P.z) < abs(Pd.z-P.z) ? Pu-P : P-Pd;
    vec3 cr = cross(dx, dy); vec3 N = dot(cr, cr) > 1e-12 ? normalize(cr) : vec3(0.0, 0.0, 1.0);
    float R = uRadius*(1.0 + -P.z*0.012);
    float a = fract(52.9829189*fract(dot(gl_FragCoord.xy, vec2(0.06711056,0.00583715))))*6.2831853;
    vec3 T = normalize(cross(N, normalize(vec3(cos(a), sin(a), 0.37)))); vec3 B = cross(N, T);
    float occ = 0.0;
    for(int i=0;i<AS;i++){
      float fi = float(i); float u = (fi+0.5)/float(AS); float r = mix(0.12, 1.0, u*u);
      float th = fi*2.3999632; float z = sqrt(1.0-u); float q = sqrt(1.0-z*z);
      vec3 S = P + (T*cos(th)*q + B*sin(th)*q + N*z)*R*r;
      vec4 o = uProj*vec4(S,1.0); vec2 suv = o.xy/o.w*0.5+0.5;
      float sz = vpos(suv).z;
      occ += step(S.z + 0.03*R, sz) * smoothstep(0.0, 1.0, R/abs(P.z - sz));
    }
    gl_FragColor = vec4(clamp(1.0 - occ/float(AS), 0.0, 1.0), min(-P.z, 60000.0), 0.0, 1.0);
  }`;

/**
 * Composite: far depth of field, occlusion (bilateral upsample) and sun rays.
 * @param {number} samples ray samples; at least 1 so the loop compiles
 */
export const compositeFragment = (samples) => `#define RS ${Math.max(1, samples)}
  uniform sampler2D tDiffuse, tDepth, tAO; uniform vec2 uAORes, uSun; uniform float uAOStr, uAOFar, uNear, uFar, uRays, uAspect, uDof, uDofA, uDofB; uniform vec2 uPx; uniform vec3 uRayCol; varying vec2 vUv;
  float linZ(float d){ float z = d*2.0-1.0; return 2.0*uNear*uFar/(uFar+uNear-z*(uFar-uNear)); }
  void main(){
    vec4 c = texture2D(tDiffuse, vUv); float d = texture2D(tDepth, vUv).x;
    if (uDof > 0.001) {
      float zf = d >= 0.99999 ? uDofB : linZ(d); float r = uDof*smoothstep(uDofA, uDofB, zf)*2.6;
      if (r > 0.25) { vec3 acc = c.rgb; float wt = 1.0;
        for (int i = 0; i < 8; i++) { float a = float(i)*0.785398 + 0.39; vec2 o = vec2(cos(a), sin(a))*r*uPx; vec2 uv2 = vUv + o; float d2 = texture2D(tDepth, uv2).x; float z2 = d2 >= 0.99999 ? uDofB : linZ(d2);
          float w = smoothstep(uDofA*0.8, uDofB, z2); acc += texture2D(tDiffuse, uv2).rgb*w; wt += w; }
        c.rgb = acc/wt; } }
    if(uAOStr > 0.0 && d < 0.99999){
      float z = linZ(d); float s = 0.0, w = 0.0; vec2 tx = 1.0/uAORes;
      for(int x=-1;x<=1;x++) for(int y=-1;y<=1;y++){ vec2 a = texture2D(tAO, vUv + vec2(float(x), float(y))*tx).rg; float ww = 1.0/(0.02 + abs(a.g - z)/z*25.0); s += a.r*ww; w += ww; }
      float ao = w > 1e-6 ? clamp(s/w, 0.0, 1.0) : 1.0; c.rgb *= mix(1.0, ao, uAOStr*(1.0 - smoothstep(uAOFar*0.35, uAOFar, z)));
    }
    if(uRays > 0.001){
      vec2 dir = uSun - vUv; vec2 st = dir/float(RS); float L = 0.0, decay = 1.0;
      vec2 p = vUv + st*fract(52.9829189*fract(dot(gl_FragCoord.xy, vec2(0.06711056,0.00583715))));
      for(int i=0;i<RS;i++){ float m = step(0.99999, texture2D(tDepth, p).x); vec3 sc = texture2D(tDiffuse, p).rgb; L += m*max(dot(sc, vec3(0.3,0.5,0.2)) - 0.75, 0.0)*decay; decay *= 0.95; p += st; }
      L /= float(RS); float fall = 1.0 - smoothstep(0.0, 0.85, length(dir*vec2(uAspect, 1.0)));
      c.rgb += uRayCol*L*uRays*fall;
    }
    gl_FragColor = vec4(max(c.rgb, vec3(0.0)), c.a);
  }`;

/** Added to the end of OutputShader's fragment: saturation, tint, lift, curve, vignette. */
export const GRADE_GLSL = `
  { vec3 c = gl_FragColor.rgb; float l = dot(c, vec3(0.299, 0.587, 0.114)); c = mix(vec3(l), c, uSat) * uTint;
    c = c * (1.0 - uLift) + uLift * vec3(0.55, 0.6, 0.7) * 0.25; vec3 cc = clamp(c, 0.0, 1.0); c = mix(c, cc * cc * (3.0 - 2.0 * cc), uCurve);
    vec2 dv = vUv - 0.5; c *= 1.0 - dot(dv, dv) * uVig; gl_FragColor.rgb = c; }
`;
