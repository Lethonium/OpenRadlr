/**
 * The far-off islands on the horizon: per island a low rock-and-green dome (the rock asset's boulder, scaled to the
 * island's size and set mostly under water), a rocky crown on the tall ones. All of them merge into two meshes, a
 * lighter and a darker, always drawn and fogged: they stand beyond the haze and give the sea a horizon.
 */
import * as THREE from "../../three.js";
import { NATURE } from "../assets/nature/index.js";
import { merge } from "../assets/geom.js";
import { addHook, cloudShadows, heightFog } from "../assets/materials.js";
import { createScratch, placed } from "./buildingMerge.js";
import { createOwner } from "./tracker.js";

/** How far the dome sinks under the sea, as a share of its height. */
const SINK = 0.4;
/** The crown of a tall island: radius against the island's, height and how high it starts. */
const CROWN = Object.freeze({ radius: 0.28, height: 0.62, start: 0.55 });
/** Colour factors of the lighter and the darker island. */
const TINT = Object.freeze({ light: 1, dark: 0.78 });

/** The boulder's extent: its half width and height, so it can be scaled to fit a size. */
function extentOf(geometry) {
  geometry.computeBoundingBox();
  const { min, max } = geometry.boundingBox;
  return { half: Math.max(max.x, -min.x, max.z, -min.z), top: max.y };
}

/**
 * @param {{islands: import("../../world/plan/islands.js").FarIsland[]}} plan
 * @param {{season?: string, settings: import("../quality.js").QualitySettings, uniforms: object, track: import("./tracker.js").Tracker["track"]}} options
 */
export function createIslandLayer(plan, { season = "summer", settings, uniforms, track }) {
  const { own, disposeAll } = createOwner(track);
  const object = new THREE.Group();
  object.name = "islands";
  const scratch = createScratch();
  const rock = NATURE.rock.parts({ season, detail: settings.detail, uniforms, own: scratch.own });
  const boulder = (settings.detail ? rock.near : rock.far)[0].geometry;
  const { half, top } = extentOf(boulder);

  /** The boulder stretched to `radius` by `depth` (the far axis) and `rise` high, on y = `base`, turned by `turn`. */
  const dome = ({ x, z, radius, depth, rise, base, turn }) => {
    const copy = boulder.clone();
    copy.scale(radius / half, rise / top, depth / half);
    return placed(copy, { x, y: base, z, yaw: turn });
  };
  const lists = { light: [], dark: [] };
  for (const island of plan.islands) {
    const sink = island.height * SINK;
    const list = island.dark ? lists.dark : lists.light;
    list.push(dome({ x: island.x, z: island.z, radius: island.radius, depth: island.radius * island.squash, rise: island.height + sink, base: island.sea - sink, turn: island.turn }));
    if (island.peakTurn !== null) {
      const radius = island.radius * CROWN.radius;
      list.push(dome({ x: island.x, z: island.z, radius, depth: radius, rise: island.height * CROWN.height, base: island.sea + island.height * CROWN.start, turn: island.peakTurn }));
    }
  }
  for (const [name, list] of Object.entries(lists)) {
    if (!list.length) continue;
    const material = own(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 }));
    material.color.setScalar(TINT[name]);
    addHook(material, cloudShadows(uniforms));
    addHook(material, heightFog(uniforms));
    const mesh = new THREE.Mesh(own(merge(list)), material);
    mesh.name = `islands-${name}`;
    mesh.receiveShadow = false;
    object.add(mesh);
  }
  scratch.release();

  return {
    object,
    update() {},
    setEnvironment() {},
    dispose() {
      object.clear();
      disposeAll();
    },
  };
}
