/**
 * GPU grass in concentric rings around the camera (the Ghost of Tsushima
 * approach). Each ring is a square tile of random blade roots that wraps
 * around the camera, so the field looks endless; near rings are dense and
 * thin, far rings sparse and wide, and neighbours cross-fade by dithering.
 * Height and colour come from textures baked from the ground. Restyled from
 * the reference's `grass-field.js`: ring tables live in `quality.js`, the
 * random roots are injected, flowers are left out.
 */
import * as THREE from "../../../three.js";
import { createOwner } from "../owner.js";
import { GRASS_EMISSIVE, GRASS_FRAGMENT_HEAD, GRASS_VERTEX_BLADE, GRASS_VERTEX_HEAD } from "./grassShader.js";

export { GRASS_GLSL } from "./grassShader.js";

/**
 * @typedef {{r: number, dens: number, w: number, segs: number, h?: number}} GrassRing
 * r outer radius (m), dens roots per square metre, w blade width (m), segs blade segments, h height factor
 */

/**
 * A ring set from a quality level, each ring but the first fading in over the previous ring's outer 20%.
 * @param {readonly GrassRing[]} rings
 * @returns {(GrassRing & {fadeIn: [number, number] | null})[]}
 */
export const ringSet = (rings) => rings.map((ring, i) => ({ ...ring, fadeIn: i ? [rings[i - 1].r * 0.8, rings[i - 1].r] : null }));

/** How many blade roots a ring set plants: the weight of a quality level. */
export const bladeCount = (rings) => rings.reduce((sum, ring) => sum + Math.round(ring.dens * ring.r * 2 * ring.r * 2), 0);

/** A blade: a tapering strip of `segs` quads and a tip, standing 1 m high, 1 m wide at the base. */
function bladeGeometry(segs) {
  const position = [];
  const index = [];
  for (let i = 0; i <= segs; i += 1) {
    const y = i / segs;
    const w = 0.5 * Math.pow(1 - y, 0.85);
    if (i < segs) position.push(-w, y, 0, w, y, 0);
    else position.push(0, 1, 0);
  }
  for (let i = 0; i < segs - 1; i += 1) {
    const a = i * 2;
    index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const t = (segs - 1) * 2;
  index.push(t, t + 1, t + 2);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(position, 3));
  geometry.setIndex(index);
  return geometry;
}

/** A one-texel clearance texture that lets grass grow everywhere. */
function everywhere() {
  const texture = new THREE.DataTexture(Uint8Array.of(255), 1, 1, THREE.RedFormat, THREE.UnsignedByteType);
  texture.unpackAlignment = 1;
  texture.needsUpdate = true;
  return texture;
}

/**
 * One ring of grass.
 * @param {object} options
 * @param {ReturnType<typeof ringSet>[number]} options.ring
 * @param {number} options.world side of the ground textures in metres
 * @param {number} options.res texels per side of the ground textures
 * @param {import("../../../three.js").Texture} options.heightTex red: ground height (float)
 * @param {import("../../../three.js").Texture} options.colorTex rgb: ground colour, alpha: grass density
 * @param {import("../../../three.js").Texture} [options.clearTex] red: 1 where a blade root may stand (finer than `colorTex`)
 * @param {import("../../../three.js").Vector4} [options.clearBox] world x0, z0, width and depth `clearTex` covers
 * @param {ReturnType<typeof import("../materials.js").createSharedUniforms>} options.uniforms
 * @param {() => number} options.random source of the roots' scatter
 * @param {import("../../scene/tracker.js").Tracker["track"]} options.track
 * @param {number} [options.bladeHeight] metres of a full-density blade
 * @returns {{object: import("../../../three.js").Mesh, uniforms: object, update: (camera: import("../../../three.js").Vector3) => void, dispose: () => void}}
 */
export function createGrassRing({ ring, world, res, heightTex, colorTex, clearTex = null, clearBox = null, uniforms: shared, random, track, bladeHeight = 0.5 }) {
  const owner = createOwner(track);
  const tile = ring.r * 2;
  const count = Math.max(1, Math.round(ring.dens * tile * tile));
  const base = bladeGeometry(ring.segs);
  // The roots, sorted into TILES × TILES squares of the ring's tile: each square is a draw of its own.
  const span = tile / TILES;
  const bins = Array.from({ length: TILES * TILES }, () => []);
  for (let i = 0; i < count; i += 1) {
    const root = [random() * tile, random() * tile, random()];
    bins[Math.min(TILES - 1, Math.floor(root[1] / span)) * TILES + Math.min(TILES - 1, Math.floor(root[0] / span))].push(root);
  }
  const material = owner.own(new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.62, metalness: 0 }));
  const fade = ring.fadeIn ?? [-1, 0];
  const uniforms = {
    uCam: { value: new THREE.Vector3() },
    uSize: { value: tile },
    uROut: { value: ring.r },
    uFadeIn: { value: new THREE.Vector2(fade[0], fade[1]) },
    uWorld: { value: world },
    uRes: { value: res },
    uH: { value: heightTex },
    uC: { value: colorTex },
    uK: { value: clearTex ?? owner.own(everywhere()) },
    uKBox: { value: clearBox ?? new THREE.Vector4(-1e6, -1e6, 2e6, 2e6) },
    uBlade: { value: bladeHeight * (ring.h ?? 1) },
    uBladeW: { value: ring.w },
    uTime: shared.time,
    uWind: shared.wind,
    uGlow: { value: 0.1 },
    uSunDirV: shared.sunDirV,
    uSunCol: shared.sunCol,
    uCSK: shared.cloudShadow,
  };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = GRASS_VERTEX_HEAD + shader.vertexShader.replace("#include <color_vertex>", "").replace("#include <beginnormal_vertex>", GRASS_VERTEX_BLADE).replace("#include <begin_vertex>", "vec3 transformed = gPos;"); // i18n-ok
    shader.fragmentShader = GRASS_FRAGMENT_HEAD + shader.fragmentShader
      .replace("#include <color_fragment>", "#include <color_fragment>\n diffuseColor.rgb = vGCol;")
      .replace("#include <normal_fragment_begin>", "#include <normal_fragment_begin>\n normal = normalize(vNormal);")
      .replace("#include <dithering_fragment>", "#include <dithering_fragment>\n gl_FragColor = clamp(gl_FragColor, vec4(0.0), vec4(8.0, 8.0, 8.0, 1.0));")
      .replace("#include <emissivemap_fragment>", GRASS_EMISSIVE); // i18n-ok
  };
  material.customProgramCacheKey = () => `grass${ring.segs}`;
  const object = new THREE.Group();
  const tiles = [];
  for (const [b, roots] of bins.entries()) {
    if (roots.length === 0) continue;
    const geometry = owner.own(new THREE.InstancedBufferGeometry());
    geometry.setIndex(base.index);
    geometry.setAttribute("position", base.attributes.position);
    geometry.setAttribute("aOff", new THREE.InstancedBufferAttribute(Float32Array.from(roots.flat()), 3));
    geometry.instanceCount = roots.length;
    const mesh = new THREE.Mesh(geometry, material);
    // The ring culls its squares itself: the blades move in the shader, so Three's bounds would be wrong.
    mesh.frustumCulled = false;
    mesh.receiveShadow = true;
    object.add(mesh);
    tiles.push({ mesh, x: (b % TILES) * span, z: Math.floor(b / TILES) * span });
  }
  base.dispose();
  const xs = [];
  const zs = [];
  return {
    object,
    uniforms,
    ring,
    count,
    /** Squares drawn after the last update. */
    drawn: () => tiles.filter((t) => t.mesh.visible).length,
    /**
     * Wraps the blades around the camera. `sees(x0, z0, x1, z1)` says whether a world rectangle can show grass
     * (in view, not bare); a square whose every wrapped piece fails it is not drawn.
     * @param {import("../../../three.js").Vector3} camera
     * @param {((x0: number, z0: number, x1: number, z1: number) => boolean) | null} [sees]
     */
    update(camera, sees = null) {
      uniforms.uCam.value.copy(camera);
      for (const t of tiles) {
        if (!sees) {
          t.mesh.visible = true;
          continue;
        }
        xs.length = 0;
        zs.length = 0;
        xs.push(...wrappedSpans(t.x, span, camera.x, tile));
        zs.push(...wrappedSpans(t.z, span, camera.z, tile));
        t.mesh.visible = xs.some(([x0, x1]) => zs.some(([z0, z1]) => sees(x0, z0, x1, z1)));
      }
    },
    dispose: () => owner.disposeAll(),
  };
}

/** Squares per side a ring's tile is split into, so the squares out of view or without grass are not drawn. */
export const TILES = 4;

/**
 * Where roots from [a, a + size) of a ring's tile land once wrapped around the camera at `c`
 * (the shader's `p += floor((c - p)/tile + 0.5)*tile`): one world interval, or two at opposite
 * ends of the ring where the wrap cuts through them.
 * @returns {Array<[number, number]>}
 */
export function wrappedSpans(a, size, c, tile) {
  const shift = (p) => Math.floor((c - p) / tile + 0.5);
  const first = shift(a);
  const last = shift(a + size * (1 - 1e-9));
  if (first === last) return [[a + first * tile, a + size + first * tile]];
  const pieces = [
    [a + first * tile, c + tile / 2],
    [c - tile / 2, a + size + last * tile],
  ];
  // A square starting right on the cut keeps only its wrapped piece.
  return pieces.filter(([from, to]) => to > from);
}
