/**
 * The roadside crowd: per pose two instanced meshes (the body and the shirt, which carries each person's colour as its
 * instance colour) and one for the flags (instance colour = the flag's). The world's worker places the people
 * (`world.crowd`); the view says each frame which are out and how they cheer (`frame.crowd`, `{index, yaw, lift, pose,
 * flagSwing}` with `index` into `world.crowd.people`), the layer only places them.
 */
import * as THREE from "../../three.js";
import { addHook, cloudShadows, heightFog } from "../assets/materials.js";
import { FLAG_HAND, flagGeometry, spectatorGeometry } from "../assets/people/spectator.js";
import { createOwner } from "./tracker.js";

const UP = new THREE.Vector3(0, 1, 0);

/**
 * @param {{crowd?: {people: object[], figure: "person"|"penguin"}}} world
 * @param {{settings: import("../quality.js").QualitySettings, uniforms?: object, track: import("./tracker.js").Tracker["track"]}} options
 */
export function createCrowdLayer(world, { settings, uniforms, track }) {
  const { own, disposeAll } = createOwner(track);
  const { people = [], figure = "person" } = world.crowd ?? {};
  const object = new THREE.Group();
  object.name = "crowd";
  const capacity = people.length;
  const hook = (material) => (uniforms ? addHook(addHook(material, cloudShadows(uniforms)), heightFog(uniforms)) : material);
  const solid = (side = THREE.FrontSide) => hook(own(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, side })));

  /** An instanced mesh with room for everyone; `coloured` ones carry a colour per instance. */
  const instanced = (name, geometry, material, coloured) => {
    const mesh = new THREE.InstancedMesh(own(geometry), material, capacity);
    mesh.name = name;
    mesh.count = 0;
    mesh.castShadow = settings.shadows;
    mesh.frustumCulled = false;
    if (coloured) mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    object.add(mesh);
    return mesh;
  };

  const poses = capacity === 0 ? [] : [["up", true], ["down", false]].map(([name, pose]) => {
    const { body, shirt } = spectatorGeometry({ figure, pose });
    return { pose, body: instanced(`crowd-body-${name}`, body, solid(), false), shirt: instanced(`crowd-shirt-${name}`, shirt, solid(), true) };
  });
  const flags = capacity === 0 ? null : instanced("crowd-flags", flagGeometry(), solid(THREE.DoubleSide), true);

  const hand = new THREE.Matrix4().makeTranslation(...FLAG_HAND[figure]);
  const scratch = { model: new THREE.Matrix4(), swing: new THREE.Matrix4(), at: new THREE.Vector3(), turn: new THREE.Quaternion(), size: new THREE.Vector3(), color: new THREE.Color() };
  let drawn = 0;

  return {
    object,
    /** Spectators drawn after the last update (flags not counted). */
    stats: () => ({ drawn }),
    update(frame) {
      drawn = 0;
      if (capacity === 0) return;
      const counts = new Map(poses.map((pose) => [pose, 0]));
      let flagCount = 0;
      const { model, swing, at, turn, size, color } = scratch;
      for (const entry of frame.crowd ?? []) {
        const person = people[entry.index];
        if (!person) continue;
        const pose = poses.find((candidate) => candidate.pose === entry.pose);
        const i = counts.get(pose);
        counts.set(pose, i + 1);
        drawn += 1;
        at.set(person.position[0], person.position[1] + entry.lift, person.position[2]);
        turn.setFromAxisAngle(UP, entry.yaw);
        model.compose(at, turn, size.setScalar(person.scale));
        pose.body.setMatrixAt(i, model);
        pose.shirt.setMatrixAt(i, model);
        pose.shirt.setColorAt(i, color.setRGB(...person.shirt));
        if (person.flag) {
          // The flag swings about its pole in the raised hand.
          model.multiply(hand).multiply(swing.makeRotationY(entry.flagSwing));
          flags.setMatrixAt(flagCount, model);
          flags.setColorAt(flagCount, color.setRGB(...person.flag));
          flagCount += 1;
        }
      }
      for (const [pose, count] of counts) {
        for (const mesh of [pose.body, pose.shirt]) {
          mesh.count = count;
          mesh.instanceMatrix.needsUpdate = true;
        }
        pose.shirt.instanceColor.needsUpdate = true;
      }
      flags.count = flagCount;
      flags.instanceMatrix.needsUpdate = true;
      flags.instanceColor.needsUpdate = true;
    },
    setEnvironment() {},
    dispose() {
      for (const mesh of object.children) mesh.dispose();
      object.clear();
      disposeAll();
    },
  };
}
