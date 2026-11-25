/**
 * The menu's route bands (view3d/highlight.js): one flat-shaded mesh per band, bright and unlit, lying over the road.
 * `setBands` replaces the shown bands, freeing the old geometries. A band's colours are scaled by its glow (the picked
 * route 1, the others fainter).
 */
import * as THREE from "../../three.js";
import { createOwner } from "./tracker.js";

/** Over the road and its markings. */
const ORDER = 3;

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
        const material = owner.own(new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false, transparent: false }));
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
