/**
 * GLSL for the 3D view: the own WebGL renderer's programs today, and the source
 * of the `RawShaderMaterial`s the Three.js adapter builds while the sweep runs.
 * Kept apart from the renderer so both can import the same text.
 *
 * Passes per frame:
 * 0. shadow — depth of the shadow casters as seen from the sun (shadow map)
 * 1. sky    — full-screen gradient with sun glow (no geometry)
 * 2. opaque — sun (shadowed, PCF-filtered) + sky/ground hemisphere light,
 *             rim light, distance and height fog, tone mapping
 * 3. blended — water and contact shadows, depth-tested but not written
 */

export const MESH_VERTEX = `#version 300 es
in vec3 a_position;
in vec3 a_normal;
in vec4 a_color;
uniform mat4 u_viewProjection;
uniform mat4 u_model;
uniform mat4 u_lightViewProjection;
uniform vec3 u_tint;
out vec3 v_normal;
out vec3 v_color;
out vec3 v_world;
out vec4 v_shadow;
void main() {
  vec4 world = u_model * vec4(a_position, 1.0);
  v_world = world.xyz;
  v_normal = mat3(u_model) * a_normal;
  v_color = mix(a_color.rgb, u_tint, a_color.a);
  // Normal offset against shadow acne on slopes.
  v_shadow = u_lightViewProjection * vec4(world.xyz + normalize(v_normal) * 0.06, 1.0);
  gl_Position = u_viewProjection * world;
}`;

export const MESH_FRAGMENT = `#version 300 es
precision highp float;
precision highp sampler2DShadow;
in vec3 v_normal;
in vec3 v_color;
in vec3 v_world;
in vec4 v_shadow;
uniform sampler2DShadow u_shadowMap;
uniform float u_shadowStrength;
uniform float u_shadowTexel;
uniform vec3 u_sunDirection;
uniform vec3 u_sunColor;
uniform vec3 u_skyColor;
uniform vec3 u_groundColor;
uniform vec3 u_cameraPosition;
uniform vec3 u_fogColor;
uniform vec2 u_fogRange;
uniform float u_alpha;
uniform float u_unlit;
uniform float u_fogScale;
uniform float u_linearOut;
out vec4 outColor;

vec3 toneMap(vec3 c) {
  // Gentle exposure + roll-off: whites stay white, highlights never clip harshly.
  c *= 1.2;
  c = c / (1.0 + c * 0.22);
  return pow(c, vec3(0.95));
}

float sunVisibility() {
  vec3 p = v_shadow.xyz / v_shadow.w * 0.5 + 0.5;
  if (u_shadowStrength <= 0.0 || p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0 || p.z > 1.0) return 1.0;
  // 3×3 percentage-closer filtering on top of the hardware 2×2 comparison.
  float lit = 0.0;
  for (int x = -1; x <= 1; x++) {
    for (int y = -1; y <= 1; y++) {
      lit += texture(u_shadowMap, vec3(p.xy + vec2(x, y) * u_shadowTexel, p.z - 0.0008));
    }
  }
  lit /= 9.0;
  // Fade out towards the edge of the shadow box so there is no hard border.
  float edge = smoothstep(0.0, 0.08, min(min(p.x, 1.0 - p.x), min(p.y, 1.0 - p.y)));
  return mix(1.0, mix(1.0 - u_shadowStrength, 1.0, lit), edge);
}

void main() {
  vec3 n = normalize(v_normal);
  if (!gl_FrontFacing) n = -n;
  float sun = max(dot(n, u_sunDirection), 0.0) * sunVisibility();
  vec3 ambient = mix(u_groundColor, u_skyColor, n.y * 0.5 + 0.5);
  vec3 toCamera = normalize(u_cameraPosition - v_world);
  // Soft rim light keeps silhouettes readable against the terrain.
  float rim = pow(1.0 - max(dot(n, toCamera), 0.0), 3.0) * 0.18;
  vec3 lit = v_color * (ambient * 0.62 + u_sunColor * sun * 0.85) + rim * u_skyColor;
  lit = mix(lit, v_color, u_unlit);
  float distance = length(v_world - u_cameraPosition);
  float fog = smoothstep(u_fogRange.x, u_fogRange.y, distance);
  // Height fog: distant valleys get hazier than mountain tops.
  fog = clamp(fog * (1.15 - 0.3 * smoothstep(0.0, 250.0, v_world.y - u_cameraPosition.y)), 0.0, 1.0) * u_fogScale;
  outColor = vec4(mix(toneMap(lit), u_fogColor, fog), u_alpha);
  // Overlay passes draw into the engine's linear target; the post chain encodes.
  if (u_linearOut > 0.5) outColor.rgb = pow(outColor.rgb, vec3(2.2));
}`;

export const DEPTH_VERTEX = `#version 300 es
in vec3 a_position;
uniform mat4 u_lightViewProjection;
uniform mat4 u_model;
void main() {
  gl_Position = u_lightViewProjection * u_model * vec4(a_position, 1.0);
}`;

// Only the depth matters, but Three's shadow target has a colour attachment too,
// and WebGL rejects a draw whose fragment shader writes nothing to it.
export const DEPTH_FRAGMENT = `#version 300 es
precision mediump float;
layout(location = 0) out vec4 o_unused;
void main() { o_unused = vec4(1.0); }`;

export const SKY_VERTEX = `#version 300 es
const vec2 corners[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
out vec2 v_ndc;
void main() {
  v_ndc = corners[gl_VertexID];
  gl_Position = vec4(v_ndc, 1.0, 1.0);
}`;

export const SKY_FRAGMENT = `#version 300 es
precision highp float;
in vec2 v_ndc;
uniform mat4 u_inverseViewProjection;
uniform vec3 u_cameraPosition;
uniform vec3 u_sunDirection;
uniform vec3 u_zenithColor;
uniform vec3 u_horizonColor;
uniform vec3 u_sunColor;
out vec4 outColor;
void main() {
  vec4 far = u_inverseViewProjection * vec4(v_ndc, 1.0, 1.0);
  vec3 direction = normalize(far.xyz / far.w - u_cameraPosition);
  float height = clamp(direction.y, -0.1, 1.0);
  vec3 sky = mix(u_horizonColor, u_zenithColor, pow(max(height, 0.0), 0.55));
  float sunAmount = max(dot(direction, u_sunDirection), 0.0);
  sky += u_sunColor * (pow(sunAmount, 900.0) * 1.4 + pow(sunAmount, 12.0) * 0.18);
  outColor = vec4(sky, 1.0);
}`;

export const WEATHER_VERTEX = `#version 300 es
in vec2 a_corner;
in vec4 a_seed;
uniform mat4 u_viewProjection;
uniform vec3 u_cameraPosition;
uniform vec3 u_cameraRight;
uniform vec3 u_cameraUp;
uniform vec3 u_box;
uniform vec2 u_fall;
uniform vec2 u_drift;
uniform vec2 u_size;
uniform float u_time;
out vec2 v_corner;
void main() {
  float speed = mix(u_fall.x, u_fall.y, a_seed.w);
  vec3 seed = a_seed.xyz * u_box;
  vec3 drift = vec3(u_drift.x, 0.0, u_drift.y) * u_time;
  vec3 world;
  world.x = mod(seed.x + drift.x - u_cameraPosition.x, u_box.x) + u_cameraPosition.x - u_box.x * 0.5;
  world.z = mod(seed.z + drift.z - u_cameraPosition.z, u_box.z) + u_cameraPosition.z - u_box.z * 0.5;
  world.y = u_cameraPosition.y - u_box.y * 0.5 + mod(seed.y - u_time * speed - u_cameraPosition.y, u_box.y);
  float size = mix(u_size.x, u_size.y, fract(a_seed.w * 7.13));
  world += (u_cameraRight * a_corner.x + u_cameraUp * a_corner.y) * size;
  v_corner = a_corner;
  gl_Position = u_viewProjection * vec4(world, 1.0);
}`;

export const WEATHER_FRAGMENT = `#version 300 es
precision highp float;
in vec2 v_corner;
uniform vec4 u_color;
uniform float u_linearOut;
out vec4 outColor;
void main() {
  float d = length(v_corner);
  if (d > 1.0) discard;
  vec3 color = u_linearOut > 0.5 ? pow(u_color.rgb, vec3(2.2)) : u_color.rgb;
  outColor = vec4(color, u_color.a * (1.0 - smoothstep(0.55, 1.0, d)));
}`;
