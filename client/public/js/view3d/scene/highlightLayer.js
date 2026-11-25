/**
 * The menu's route bands (view3d/highlight.js): one flat-shaded mesh per band, bright and unlit, lying over the road.
 * `setBands` replaces the shown bands, freeing the old geometries. A band's colours are scaled by its glow (the picked
 * route 1, the others fainter).
 */
import * as THREE from "../../three.js";
import { MARK_OFFSET } from "./roadLayer.js";
import { createOwner } from "./tracker.js";

/** Over the road and its markings. */
const ORDER = 3;
/**
 * The road is pulled towards the camera by its polygon offset (more for the markings), which at a grazing angle
 * outweighs the band's lift of under a metre and buries it. The band is pulled further than the markings.
 */
const OFFSET = Object.freeze({ factor: MARK_OFFSET.factor * 2, units: MARK_OFFSET.units * 2 });

/**
 * @param {{track: import("./tracker.js").Tracker["track"]}} options
 */
export function createHighlightLayer({ track }) {
  const { disposeAll } = createOwner(track);
  const object = new THREE.Group();
  object.name = "highlight";
  /** Per band resources, freed on the next `setBands`. */
  let owner = createOwner(track);

  const clear = () => {
    object.clear();
    owner.disposeAll();
    owner = createOwner(track);
  };

  return {
    object,
    /** @param {{band: {positions: Float32Array, colors: Float32Array}, glow?: number}[]} bands */
    setBands(bands) {
      clear();
      for (const { band, glow = 1 } of bands) {
        const geometry = owner.own(new THREE.BufferGeometry());
        geometry.setAttribute("position", new THREE.BufferAttribute(band.positions, 3));
        geometry.setAttribute("color", new THREE.BufferAttribute(band.colors, 3));
        geometry.computeBoundingSphere();
        const material = owner.own(new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false, transparent: false, polygonOffset: true, polygonOffsetFactor: OFFSET.factor, polygonOffsetUnits: OFFSET.units }));
        material.color.setScalar(glow);
        const mesh = new THREE.Mesh(geometry, material);
        mesh.renderOrder = ORDER;
        mesh.frustumCulled = true;
        object.add(mesh);
      }
    },
    update() {},
    setEnvironment() {},
    dispose() {
      clear();
      disposeAll();
    },
  };
}
