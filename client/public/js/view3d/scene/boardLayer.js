/**
 * The roadside billboards (`world.boards`): every frame is one instance of one mesh, every static poster a quad of one
 * merged mesh that reads the poster atlas, and the goal boards (`frame.goalBoards`, at most two, anchored by the view)
 * are two more frame instances with a quad each from a second, two-slot canvas. Three draw calls at most. The poster
 * faces give off a little of their own colour, more at dusk and night (`env.night`).
 */
import * as THREE from "../../three.js";
import { addHook, cloudShadows, heightFog } from "../assets/materials.js";
import { billboardFrame, posterQuad } from "../assets/props/billboard.js";
import { slotUv } from "../posters/paint.js";
import { createOwner } from "./tracker.js";

/** How much a poster gives off of its own colour by day, and the most it adds at night. */
const GLOW = Object.freeze({ day: 0.1, night: 0.6 });
/** Goal boards at most. */
const GOAL_MAX = 2;
const CREAM = 0xf4ecd8;
/** The two goal posters side by side on their canvas: slot 0 left, slot 1 right. */
const GOAL_UV = Object.freeze([[0, 0, 0.5, 1], [0.5, 0, 1, 1]]);

/**
 * @param {{boards?: {position: number[], yaw: number}[]}} world
 * @param {{settings: import("../quality.js").QualitySettings, uniforms?: object, track: import("./tracker.js").Tracker["track"]}} options
 */
export function createBoardLayer(world, { settings, uniforms, track }) {
  const { own, disposeAll } = createOwner(track);
  const boards = world.boards ?? [];
  const object = new THREE.Group();
  object.name = "boards";
  const hook = (material) => (uniforms ? addHook(addHook(material, cloudShadows(uniforms)), heightFog(uniforms)) : material);
  const matrix = new THREE.Matrix4();
  const at = new THREE.Vector3();
  const facing = new THREE.Vector3();
  const size = new THREE.Vector3(1, 1, 1);
  const turn = new THREE.Quaternion();
  const angles = new THREE.Euler(0, 0, 0, "YXZ");
  const place = ({ position, yaw }, target = matrix) => {
    angles.y = yaw;
    return target.compose(at.fromArray(position), turn.setFromEuler(angles), size);
  };

  const frames = new THREE.InstancedMesh(own(billboardFrame({ detail: settings.boards.detail })), hook(own(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 }))), boards.length + GOAL_MAX);
  frames.name = "board-frames";
  frames.castShadow = settings.shadows;
  frames.frustumCulled = false;
  boards.forEach((board, i) => frames.setMatrixAt(i, place(board)));
  frames.count = boards.length;
  frames.instanceMatrix.needsUpdate = true;
  object.add(frames);

  /** A face material: cream until a canvas arrives, then the canvas lit by itself. */
  const face = () => hook(own(new THREE.MeshStandardMaterial({ color: CREAM, roughness: 0.8, emissive: new THREE.Color(CREAM) })));
  const withCanvas = (material, canvas) => {
    material.map?.dispose();
    const texture = own(new THREE.Texture(canvas));
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    texture.needsUpdate = true;
    material.map = texture;
    material.emissiveMap = texture;
    material.color.set(0xffffff);
    material.emissive.set(0xffffff);
    material.needsUpdate = true;
  };

  /** Writes quad `index` of `geometry` with the poster rectangle at `matrix` and the texture rectangle `uv`. */
  const writeQuad = (geometry, index, matrixOf, uv) => {
    const quad = posterQuad(uv);
    const position = geometry.getAttribute("position");
    const uvs = geometry.getAttribute("uv");
    const normals = geometry.getAttribute("normal");
    // The quad's front is its board's +z, turned by the board's rotation (lit materials need it).
    const front = facing.set(0, 0, 1).transformDirection(matrixOf);
    for (let k = 0; k < 4; k += 1) {
      at.fromArray(quad.positions, k * 3).applyMatrix4(matrixOf);
      position.setXYZ(index * 4 + k, at.x, at.y, at.z);
      uvs.setXY(index * 4 + k, quad.uvs[k * 2], quad.uvs[k * 2 + 1]);
      normals.setXYZ(index * 4 + k, front.x, front.y, front.z);
    }
    position.needsUpdate = true;
    normals.needsUpdate = true;
    uvs.needsUpdate = true;
  };
  const quadGeometry = (count) => {
    const geometry = own(new THREE.BufferGeometry());
    geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(count * 12), 3));
    geometry.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(count * 8), 2));
    geometry.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(count * 12), 3));
    const index = [];
    for (let i = 0; i < count; i += 1) index.push(i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3);
    geometry.setIndex(index);
    return geometry;
  };
  const quadMesh = (name, geometry, material) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.frustumCulled = false;
    object.add(mesh);
    return mesh;
  };

  const posterMaterial = face();
  let posters = null;
  let slots = boards.map((_, i) => i % 8);
  const paintSlots = () => {
    const geometry = posters.geometry;
    boards.forEach((board, i) => writeQuad(geometry, i, place(board), slotUv(slots[i] ?? 0)));
  };
  if (boards.length > 0) {
    posters = quadMesh("board-posters", quadGeometry(boards.length), posterMaterial);
    paintSlots();
  }

  const goalMaterial = face();
  const goalGeometry = quadGeometry(GOAL_MAX);
  goalGeometry.setDrawRange(0, 0);
  const goal = quadMesh("goal-posters", goalGeometry, goalMaterial);
  goal.visible = false;
  let goalCount = 0;

  return {
    object,
    /** Boards drawn: the planned ones and the goal boards out now. */
    stats: () => ({ boards: boards.length, goal: goalCount }),
    /** The atlas canvas and which slot each board shows (`slotOf[i]` for `world.boards[i]`). */
    setPosters(atlas, slotOf) {
      slots = slotOf;
      withCanvas(posterMaterial, atlas);
      if (posters) paintSlots();
    },
    /** The canvas with the two goal posters side by side. */
    setGoalPosters(canvas) {
      withCanvas(goalMaterial, canvas);
    },
    update(frame) {
      const goals = (frame.goalBoards ?? []).slice(0, GOAL_MAX);
      goals.forEach((board, i) => {
        frames.setMatrixAt(boards.length + i, place(board));
        writeQuad(goalGeometry, i, place(board), GOAL_UV[board.slot === 1 ? 1 : 0]);
      });
      if (goals.length === 0 && goalCount === 0) return;
      goalCount = goals.length;
      frames.count = boards.length + goalCount;
      frames.instanceMatrix.needsUpdate = true;
      goalGeometry.setDrawRange(0, goalCount * 6);
      goal.visible = goalCount > 0;
    },
    setEnvironment(env) {
      const glow = GLOW.day + GLOW.night * Math.min(1, Math.max(0, env.night ?? 0));
      posterMaterial.emissiveIntensity = glow;
      goalMaterial.emissiveIntensity = glow;
    },
    dispose() {
      object.clear();
      frames.dispose();
      disposeAll();
    },
  };
}
