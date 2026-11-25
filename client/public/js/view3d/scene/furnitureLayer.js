/**
 * The road's furniture from the placements the world's worker made (`world.furniture`): guard rails (a post and a
 * beam per segment, each kind one instanced mesh), the warning triangles and village boards (a post mesh and a
 * painted-face mesh per kind) and the flamme rouge over the road. Static. The painted faces glow a little more at
 * dusk and night (`env.night`). Their colours are the biome's palette.
 */
import * as THREE from "../../three.js";
import { addHook, cloudShadows, heightFog } from "../assets/materials.js";
import { box, merge } from "../assets/geom.js";
import { createFaceMaterial, flammeRougeParts, villageSignParts, warningSignParts } from "../assets/props/roadSigns.js";
import { createOwner } from "./tracker.js";

/** How much a sign face gives off of its own colour by day, and the most it adds at night. */
const GLOW = Object.freeze({ day: 0.1, night: 0.6 });
/** A rail's beam: height and depth (metres), and how high it floats above the road. */
const BEAM = Object.freeze({ height: 0.3, depth: 0.06, lift: 0.55 });
/** A rail's post: width, height and how far its centre stands over the road. */
const POST = Object.freeze({ width: 0.12, height: 0.9, lift: 0.2 });
const UP = new THREE.Vector3(0, 1, 0);

const linear = ([r, g, b]) => new THREE.Color().setRGB(r, g, b);

/**
 * @param {{furniture?: {rails: {a: number[], b: number[]}[], signs: {kind: string, position: number[], yaw: number}[],
 *   flammeRouge: {position: number[], yaw: number, halfWidth: number}|null}}} world
 * @param {{biome: import("../biomes/index.js").Biome, settings: import("../quality.js").QualitySettings, uniforms?: object, track: import("./tracker.js").Tracker["track"]}} options
 */
export function createFurnitureLayer(world, { biome, settings, uniforms, track }) {
  const { own, disposeAll } = createOwner(track);
  const { rails = [], signs = [], flammeRouge = null } = world.furniture ?? {};
  const palette = biome.palette;
  const object = new THREE.Group();
  object.name = "furniture";
  const hook = (material) => (uniforms ? addHook(addHook(material, cloudShadows(uniforms)), heightFog(uniforms)) : material);
  const solid = () => hook(own(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 })));
  const faces = hook(createFaceMaterial(own));
  const scratch = { matrix: new THREE.Matrix4(), along: new THREE.Vector3(), across: new THREE.Vector3(), at: new THREE.Vector3(), size: new THREE.Vector3(1, 1, 1), turn: new THREE.Quaternion(), angles: new THREE.Euler(0, 0, 0, "YXZ") };

  /** An instanced mesh of `geometry` with one matrix per entry, `matrixOf(entry, matrix)` writing it. */
  const instanced = (name, geometry, material, entries, matrixOf) => {
    const mesh = new THREE.InstancedMesh(own(geometry), material, entries.length);
    mesh.name = name;
    mesh.castShadow = settings.shadows;
    mesh.frustumCulled = false;
    entries.forEach((entry, i) => mesh.setMatrixAt(i, matrixOf(entry, scratch.matrix)));
    mesh.instanceMatrix.needsUpdate = true;
    object.add(mesh);
    return mesh;
  };

  if (rails.length > 0) {
    // The beam is a unit box along x, so the matrix stretches it from a to b; the post stands at a, unstretched.
    const beams = merge([box(1, BEAM.height, BEAM.depth, linear(palette.metal), 0, BEAM.lift, 0)]);
    const posts = merge([box(POST.width, POST.height, POST.width, linear(palette.pole), 0, POST.lift, 0)]);
    const { along, across, at } = scratch;
    instanced("rails", beams, solid(), rails, ({ a, b }, matrix) => {
      along.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      across.crossVectors(along, UP).normalize();
      return matrix.makeBasis(along, UP, across).setPosition(at.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2));
    });
    instanced("rail-posts", posts, solid(), rails, ({ a, b }, matrix) => {
      along.set(b[0] - a[0], 0, b[2] - a[2]).normalize();
      across.crossVectors(along, UP);
      return matrix.makeBasis(along, UP, across).setPosition(at.set(a[0], a[1], a[2]));
    });
  }

  const placeSign = ({ position, yaw }, matrix) => {
    scratch.angles.y = yaw;
    return matrix.compose(scratch.at.fromArray(position), scratch.turn.setFromEuler(scratch.angles), scratch.size);
  };
  for (const [kind, parts] of [["warning", warningSignParts], ["village", villageSignParts]]) {
    const placed = signs.filter((sign) => sign.kind === kind);
    if (placed.length === 0) continue;
    const { geometry, glow } = parts(palette);
    instanced(`${kind}-posts`, geometry, solid(), placed, placeSign);
    instanced(`${kind}-faces`, glow, faces, placed, placeSign);
  }

  if (flammeRouge) {
    const { geometry, glow } = flammeRougeParts(flammeRouge.halfWidth, palette);
    const group = new THREE.Group();
    group.name = "flamme-rouge";
    const frame = new THREE.Mesh(own(geometry), solid());
    frame.castShadow = settings.shadows;
    group.add(frame, new THREE.Mesh(own(glow), faces));
    group.position.fromArray(flammeRouge.position);
    group.rotation.y = flammeRouge.yaw;
    object.add(group);
  }

  return {
    object,
    update() {},
    setEnvironment(env) {
      faces.emissiveIntensity = GLOW.day + GLOW.night * Math.min(1, Math.max(0, env.night ?? 0));
    },
    dispose() {
      object.clear();
      disposeAll();
    },
  };
}
