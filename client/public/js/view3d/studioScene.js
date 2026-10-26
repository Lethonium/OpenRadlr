/**
 * 3D spin studio: a dark room with neon strips, bikes on smart trainers in
 * two rows and the instructor pedalling on a stage in front. Reuses the rider
 * model (pedalling legs, spinning rear wheel) and the renderer of the road
 * view. Local axes as there: riders face −Z, up is +Y.
 */
import { invert, lookAt, multiply, perspective, placement, rotationXAbout, scaling } from "./math.js";
import { MeshBuilder } from "./meshBuilder.js";
import { Renderer, createContext } from "./renderer.js";
import {
  RIDER_GEOMETRY,
  VARIANT_COUNT,
  WHEEL_HUBS,
  buildBike,
  buildCrankset,
  buildFoot,
  buildRiderShadow,
  buildShin,
  buildThigh,
  buildWheel,
  legPose,
  ridingBodyParts,
  riderLook,
  uploadBodyParts,
  variantLook,
} from "./riderModel.js";
import { hexToRgb, projectToScreen, visibleLabels } from "./view3d.js";
import { sunShadowMatrix } from "./lighting.js";

export const ROOM = Object.freeze({ halfWidth: 7.5, front: -9.5, back: 6.5, height: 4.6 });
const ROW_GAP = 2.6;
const SEAT_GAP = 1.4;
const RISER = 0.35;
const STAGE = Object.freeze({ z: -5.4, height: 0.55, halfWidth: 2.4, depth: 2.6 });

/** The instructor: id 0 (riders start at 1), on the stage, facing the room. */
export const INSTRUCTOR = Object.freeze({ id: 0, name: "Coach Lemon", position: [0, STAGE.height, STAGE.z], yaw: Math.PI });

export const STUDIO_CAMERAS = Object.freeze(["seat", "wide", "coach"]);
export const STUDIO_CAMERA_LABELS = Object.freeze({ seat: "Behind me", wide: "Whole room", coach: "Coach's view" });

/** Seat 0–7: front row from left to right, 8–15: back row on a riser. */
export function seatPosition(seat) {
  const row = seat < 8 ? 0 : 1;
  const column = seat % 8;
  return [(column - 3.5) * SEAT_GAP, row * RISER, row * ROW_GAP];
}

/** Camera eye and target for a mode, from my seat. */
export function studioCamera(mode, mySeat) {
  const coachHead = [INSTRUCTOR.position[0], INSTRUCTOR.position[1] + 1.2, INSTRUCTOR.position[2]];
  if (mode === "wide") return { eye: [0, 3.9, ROOM.back - 0.6], target: [0, 0.6, -3.5] };
  // Just in front of the coach, over the stage edge (the coach is hidden: too close).
  if (mode === "coach") return { eye: [0, 2.5, STAGE.z + 1.1], target: [0, 0.8, ROW_GAP] };
  // Over my shoulder, in front of the row behind me.
  const seat = seatPosition(mySeat ?? 3);
  return { eye: [seat[0] * 0.9, seat[1] + 2.25, seat[2] + 1.9], target: [coachHead[0], coachHead[1] - 0.4, coachHead[2]] };
}

// Colours: dark walls, a warm wooden floor, neon in the brand's lemon and accent orange.
const WALL = [0.12, 0.11, 0.16];
const FLOOR = [0.36, 0.27, 0.2];
const CEILING = [0.06, 0.06, 0.08];
const STAGE_TOP = [0.18, 0.18, 0.22];
const RISER_TOP = [0.3, 0.23, 0.18];
const SCREEN = [0.04, 0.05, 0.08];
const TRAINER = [0.1, 0.1, 0.12];
const TRAINER_FOOT = [0.3, 0.31, 0.34];
const SPEAKER = [0.08, 0.08, 0.09];
const LEMON = [1.0, 0.86, 0.2];
const ORANGE = [1.0, 0.48, 0.1];
const NEON_BLUE = [0.3, 0.6, 1.0];

/** Quad whose front face points along `direction`. */
function panel(mesh, a, b, c, d, color, direction) {
  mesh.triangleFacing(a, b, c, color, direction);
  mesh.triangleFacing(a, c, d, color, direction);
}

/** A smart trainer under the rear wheel and a block under the front wheel, at the origin. */
function addTrainer(mesh, at) {
  const [x, y, z] = at;
  const rear = WHEEL_HUBS[0][2];
  const front = WHEEL_HUBS[1][2];
  mesh.box([x, y + 0.2, z + rear], [0.3, 0.4, 0.42], TRAINER);
  mesh.box([x, y + 0.03, z + rear], [0.9, 0.06, 0.16], TRAINER_FOOT);
  mesh.box([x, y + 0.02, z + rear + 0.25], [0.6, 0.04, 0.1], TRAINER_FOOT);
  mesh.box([x, y + 0.05, z + front], [0.24, 0.1, 0.36], TRAINER);
}

/**
 * The room as two meshes: `room` (lit normally) and `neon` (drawn
 * self-illuminated). The first six quads are the shell: floor, ceiling, walls.
 */
export function buildStudioRoom() {
  const room = new MeshBuilder();
  const { halfWidth: w, front: f, back: b, height: h } = ROOM;
  panel(room, [-w, 0, f], [w, 0, f], [w, 0, b], [-w, 0, b], FLOOR, [0, 1, 0]);
  panel(room, [-w, h, f], [w, h, f], [w, h, b], [-w, h, b], CEILING, [0, -1, 0]);
  panel(room, [-w, 0, f], [w, 0, f], [w, h, f], [-w, h, f], WALL, [0, 0, 1]);
  panel(room, [-w, 0, b], [w, 0, b], [w, h, b], [-w, h, b], WALL, [0, 0, -1]);
  panel(room, [-w, 0, f], [-w, 0, b], [-w, h, b], [-w, h, f], WALL, [1, 0, 0]);
  panel(room, [w, 0, f], [w, 0, b], [w, h, b], [w, h, f], WALL, [-1, 0, 0]);

  // Stage with steps, the riser under the back row, and a trainer at every seat.
  room.box([0, STAGE.height / 2, STAGE.z], [STAGE.halfWidth * 2, STAGE.height, STAGE.depth], STAGE_TOP);
  room.box([0, STAGE.height / 4, STAGE.z + STAGE.depth / 2 + 0.25], [1.4, STAGE.height / 2, 0.5], STAGE_TOP);
  room.box([0, RISER / 2, ROW_GAP], [SEAT_GAP * 8 + 0.6, RISER, 2.2], RISER_TOP);
  for (let seat = 0; seat < 16; seat += 1) addTrainer(room, seatPosition(seat));
  addTrainer(room, INSTRUCTOR.position);

  // Big screen on the front wall, speakers in the corners.
  room.box([0, 2.5, f + 0.06], [7.2, 2.6, 0.1], SCREEN);
  for (const side of [-1, 1]) {
    room.box([side * (w - 0.6), 3.4, f + 0.5], [0.6, 0.9, 0.5], SPEAKER);
    room.box([side * (w - 0.6), 3.4, b - 0.5], [0.6, 0.9, 0.5], SPEAKER);
  }

  const neon = new MeshBuilder();
  // Frame around the screen, strips along the walls and the stage edge.
  neon.box([0, 3.85, f + 0.1], [7.6, 0.06, 0.04], LEMON);
  neon.box([0, 1.15, f + 0.1], [7.6, 0.06, 0.04], LEMON);
  for (const side of [-1, 1]) {
    neon.box([side * 3.8, 2.5, f + 0.1], [0.06, 2.76, 0.04], LEMON);
    neon.box([side * (w - 0.05), 3.9, (f + b) / 2], [0.04, 0.07, b - f - 0.4], ORANGE);
    neon.box([side * (w - 0.05), 0.15, (f + b) / 2], [0.04, 0.05, b - f - 0.4], NEON_BLUE);
  }
  neon.box([0, STAGE.height + 0.02, STAGE.z + STAGE.depth / 2], [STAGE.halfWidth * 2, 0.04, 0.05], ORANGE);
  neon.box([0, 3.9, b - 0.05], [w * 2 - 0.4, 0.07, 0.04], ORANGE);
  return { room: room.build(), neon: neon.build() };
}

/** Indoor light: a key light from above the stage, dim purple ambience, no fog. */
const STUDIO_LIGHT = Object.freeze({
  sun: (() => {
    const v = [0.25, 0.9, 0.45];
    const n = Math.hypot(...v);
    return v.map((x) => x / n);
  })(),
  sunColor: [1.0, 0.9, 0.78],
  zenith: [0.5, 0.45, 0.62],
  horizon: [0.05, 0.05, 0.08],
  ground: [0.32, 0.24, 0.3],
  fog: [400, 900],
  shadowStrength: 0.55,
});

const FOV_Y = (60 * Math.PI) / 180;
/** Riders this close to the camera (horizontally) would fill the screen; they're not drawn. */
const NEAR_CAMERA_HIDE = 1.2;

export class StudioView3D {
  #labels = new Map();
  #pedalPhase = new Map();
  #wheelPhase = new Map();
  #lastTime = null;
  cameraMode = "seat";
  quality = "high";

  /**
   * @param {HTMLCanvasElement} canvas
   * @param {HTMLElement} labelLayer absolutely positioned element over the canvas
   */
  constructor(canvas, labelLayer) {
    const gl = createContext(canvas);
    if (!gl) throw new Error("WebGL 2 is not available");
    this.canvas = canvas;
    this.labelLayer = labelLayer;
    this.renderer = new Renderer(gl);
    this.shadowsEnabled = this.renderer.createShadowMap(1024);
    const { room, neon } = buildStudioRoom();
    this.room = this.renderer.upload(room);
    this.neon = this.renderer.upload(neon);
    this.bodies = [];
    this.bodyParts = [];
    this.thighs = [];
    this.shins = [];
    for (let i = 0; i < VARIANT_COUNT; i += 1) {
      const look = variantLook(i);
      this.bodies.push(this.renderer.upload(buildBike(look)));
      this.bodyParts.push(uploadBodyParts(this.renderer, look));
      this.thighs.push(this.renderer.upload(buildThigh(look)));
      this.shins.push(this.renderer.upload(buildShin(look)));
    }
    this.foot = this.renderer.upload(buildFoot());
    this.crankset = this.renderer.upload(buildCrankset());
    this.wheel = this.renderer.upload(buildWheel());
    this.shadow = this.renderer.upload(buildRiderShadow());
    this.identity = placement([0, 0, 0]);
  }

  setQuality(quality) {
    if (quality === "high" || quality === "low") this.quality = quality;
  }

  /** Switches to the next camera and returns its mode name. */
  cycleCamera() {
    this.cameraMode = STUDIO_CAMERAS[(STUDIO_CAMERAS.indexOf(this.cameraMode) + 1) % STUDIO_CAMERAS.length];
    return this.cameraMode;
  }

  /** Upper-body parts of a rider in the riding pose, hung off `model` (the bike frame). */
  #torso(model, look) {
    return ridingBodyParts(look).map(({ mesh, model: local }) => ({ mesh: this.bodyParts[look.variant].get(mesh), model: multiply(model, local) }));
  }

  /** Body, legs and wheels of a rider at `position`, facing `yaw`, pedalling at `cadence`. */
  #parts(id, position, yaw, cadence, speed, dt) {
    const look = riderLook(id);
    const model = multiply(placement(position, yaw), scaling(look.scale));
    const phase = ((this.#pedalPhase.get(id) ?? id) + (cadence / 60) * Math.PI * 2 * dt) % (Math.PI * 2);
    this.#pedalPhase.set(id, phase);
    const joint = (at, angle) => multiply(model, multiply(placement(at), rotationXAbout([0, 0, 0], angle)));
    const [, hy, hz] = RIDER_GEOMETRY.hip;
    const limbs = [];
    for (const [side, offset] of [
      [0.12, 0],
      [-0.12, Math.PI],
    ]) {
      const pose = legPose(phase + offset);
      if (offset === 0) limbs.push({ mesh: this.crankset, model: joint(RIDER_GEOMETRY.bottomBracket, pose.crankAngle) });
      limbs.push(
        { mesh: this.thighs[look.variant], model: joint([side, hy, hz], pose.thighAngle) },
        { mesh: this.shins[look.variant], model: joint([side, pose.knee[1], pose.knee[2]], pose.shinAngle) },
        { mesh: this.foot, model: joint([side, pose.ankle[1], pose.ankle[2]], pose.footAngle) },
      );
    }
    // Only the rear wheel turns on a trainer; the front one stands still.
    const spin = ((this.#wheelPhase.get(id) ?? 0) - (speed * dt) / (RIDER_GEOMETRY.wheelRadius * look.scale)) % (Math.PI * 2);
    this.#wheelPhase.set(id, spin);
    const wheels = WHEEL_HUBS.map((hub, i) => multiply(model, multiply(placement(hub), rotationXAbout([0, 0, 0], i === 0 ? spin : 0))));
    return { model, limbs, torso: this.#torso(model, look), wheels, variant: look.variant };
  }

  /**
   * Draws one frame.
   * @param {{riders: {id: number, name: string, is_bot: boolean, seat: number, cadence: ?number, speed: number}[],
   *          myId: number, myCadence?: number, coachCadence: number, timeS: number,
   *          colors: {me: string, human: string, bot: string, accent: string}}} frame
   */
  render({ riders, myId, myCadence, coachCadence, timeS, colors }) {
    const dt = this.#lastTime === null ? 0 : Math.min(0.1, timeS - this.#lastTime);
    this.#lastTime = timeS;
    const high = this.quality === "high";
    const ratio = Math.min(globalThis.devicePixelRatio || 1, high ? 2 : 1);
    const width = Math.max(1, Math.round(this.canvas.clientWidth));
    const height = Math.max(1, Math.round(this.canvas.clientHeight));
    this.renderer.resize(Math.round(width * ratio), Math.round(height * ratio));

    const me = riders.find((r) => r.id === myId);
    const { eye, target } = studioCamera(this.cameraMode, me?.seat);
    const viewProjection = multiply(perspective(FOV_Y, width / height, 0.1, 60), lookAt(eye, target));
    const inverseViewProjection = invert(viewProjection);

    const tints = { me: hexToRgb(colors.me), human: hexToRgb(colors.human), bot: hexToRgb(colors.bot), coach: hexToRgb(colors.accent) };
    const placed = riders.map((rider) => ({ rider, position: seatPosition(rider.seat), yaw: 0 }));
    placed.push({ rider: { id: INSTRUCTOR.id, name: INSTRUCTOR.name, is_bot: false, coach: true }, position: INSTRUCTOR.position, yaw: INSTRUCTOR.yaw });
    const visible = placed.filter(({ rider, position }) => rider.id === myId || Math.hypot(position[0] - eye[0], position[2] - eye[2]) > NEAR_CAMERA_HIDE);
    const drawn = visible.map(({ rider, position, yaw }) => {
      const cadence = rider.coach ? coachCadence : rider.id === myId ? (myCadence ?? 0) : (rider.cadence ?? 0);
      const speed = rider.coach ? (coachCadence > 0 ? 9 : 0) : (rider.speed ?? 0);
      const tint = rider.coach ? tints.coach : rider.id === myId ? tints.me : rider.is_bot ? tints.bot : tints.human;
      return { rider, position, yaw, tint, ...this.#parts(rider.id, position, yaw, cadence, speed, dt) };
    });

    if (this.shadowsEnabled && high) {
      this.renderer.beginShadows(sunShadowMatrix(STUDIO_LIGHT.sun, [0, 0, -1.5], { halfSize: 11, depth: 40, mapSize: 1024 }));
      for (const part of drawn) {
        this.renderer.drawShadowCaster(this.bodies[part.variant], part.model);
        for (const piece of part.torso) this.renderer.drawShadowCaster(piece.mesh, piece.model);
        for (const limb of part.limbs) this.renderer.drawShadowCaster(limb.mesh, limb.model);
      }
      this.renderer.endShadows();
    }

    this.renderer.begin({ viewProjection, inverseViewProjection, camera: eye, ...STUDIO_LIGHT, shadowStrength: high ? STUDIO_LIGHT.shadowStrength : 0 });
    this.renderer.draw(this.room, this.identity);
    this.renderer.drawBright(this.neon, this.identity, 1);
    for (const part of drawn) {
      this.renderer.draw(this.bodies[part.variant], part.model, part.tint);
      for (const piece of part.torso) this.renderer.draw(piece.mesh, piece.model, part.tint);
      for (const limb of part.limbs) this.renderer.draw(limb.mesh, limb.model);
      for (const wheel of part.wheels) this.renderer.draw(this.wheel, wheel);
    }
    for (const part of drawn) {
      this.renderer.drawTransparent(this.shadow, placement(part.position, part.yaw), { alpha: 0.3, unlit: 1 });
    }

    this.#updateLabels(visible, myId, eye, viewProjection, width, height);
    for (const phases of [this.#pedalPhase, this.#wheelPhase]) {
      for (const id of phases.keys()) if (id !== INSTRUCTOR.id && !riders.some((r) => r.id === id)) phases.delete(id);
    }
  }

  #updateLabels(placed, myId, eye, viewProjection, width, height) {
    const candidates = [];
    for (const { rider, position } of placed) {
      const head = [position[0], position[1] + RIDER_GEOMETRY.headHeight + 0.45, position[2]];
      const screen = projectToScreen(viewProjection, head, width, height);
      if (screen) candidates.push({ rider, distance: Math.hypot(...head.map((v, i) => v - eye[i])), screen });
    }
    const shown = visibleLabels(candidates, myId, { charWidth: 6.5 });
    for (const { rider, screen } of shown) {
      const label = this.#label(rider, myId);
      label.style.transform = `translate(${screen.x.toFixed(1)}px, ${screen.y.toFixed(1)}px) translate(-50%, -100%)`;
    }
    const shownIds = new Set(shown.map((c) => c.rider.id));
    for (const [id, element] of this.#labels) {
      element.hidden = !shownIds.has(id);
      if (!placed.some((p) => p.rider.id === id)) {
        element.remove();
        this.#labels.delete(id);
      }
    }
  }

  #label(rider, myId) {
    let element = this.#labels.get(rider.id);
    if (!element) {
      element = document.createElement("div");
      element.className = rider.coach ? "label3d coach" : rider.id === myId ? "label3d me" : "label3d";
      const name = document.createElement("span");
      name.textContent = rider.name;
      element.append(name);
      if (rider.is_bot || rider.coach) {
        const badge = document.createElement("span");
        badge.className = "badge";
        badge.textContent = rider.coach ? "coach" : "bot";
        element.append(badge);
      }
      this.labelLayer.append(element);
      this.#labels.set(rider.id, element);
    }
    return element;
  }

  dispose() {
    for (const handle of [this.room, this.neon, ...this.bodies, ...this.bodyParts.flatMap((p) => [...p.values()]), ...this.thighs, ...this.shins, this.foot, this.crankset, this.wheel, this.shadow]) {
      this.renderer.dispose(handle);
    }
    this.#labels.forEach((element) => element.remove());
    this.#labels.clear();
  }
}
