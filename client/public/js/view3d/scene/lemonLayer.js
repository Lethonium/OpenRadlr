/**
 * The golden lemons (ride/lemons.js) floating over the road: one instanced mesh with a glow of its own. The view says
 * which are in reach each frame (`frame.lemons`, `{position, yaw}` with `position` the lemon's centre); the layer
 * only places them.
 */
import * as THREE from "../../three.js";
import { addHook, cloudShadows, heightFog } from "../assets/materials.js";
import { LEMON_COLORS, lemonGeometry } from "../assets/props/lemon.js";
import { createOwner } from "./tracker.js";

/** Most lemons drawn at once; any more are cut. */
const CAPACITY = 64;
/** The lemon model is about 1 m long; a lemon floating over the road is this much of it. */
const SCALE = 0.35;
/** How much of the peel colour the lemon gives off on its own. */
const GLOW = 0.5;

/**
 * @param {{settings: import("../quality.js").QualitySettings, uniforms?: object, track: import("./tracker.js").Tracker["track"]}} options
 */
export function createLemonLayer({ settings, uniforms, track }) {
  const { own, disposeAll } = createOwner(track);
  const emissive = new THREE.Color().setRGB(...LEMON_COLORS.peel).multiplyScalar(GLOW);
  const base = own(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, emissive }));
  const material = uniforms ? addHook(addHook(base, cloudShadows(uniforms)), heightFog(uniforms)) : base;
  const object = new THREE.InstancedMesh(own(lemonGeometry()), material, CAPACITY);
  object.name = "lemons";
  object.count = 0;
  object.castShadow = settings.shadows;
  object.frustumCulled = false;
  const matrix = new THREE.Matrix4();
  const turn = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const at = new THREE.Vector3();
  const size = new THREE.Vector3(SCALE, SCALE, SCALE);

  return {
    object,
    /** Lemons drawn after the last update. */
    stats: () => ({ drawn: object.count }),
    update(frame) {
      const lemons = frame.lemons ?? [];
      const count = Math.min(lemons.length, CAPACITY);
      for (let i = 0; i < count; i += 1) {
        at.fromArray(lemons[i].position);
        turn.setFromAxisAngle(up, lemons[i].yaw);
        object.setMatrixAt(i, matrix.compose(at, turn, size));
      }
      object.count = count;
      object.instanceMatrix.needsUpdate = true;
    },
    setEnvironment() {},
    dispose() {
      object.clear();
      object.dispose();
      disposeAll();
    },
  };
}
