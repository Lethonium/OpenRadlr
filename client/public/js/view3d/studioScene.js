/**
 * 3D spin studio: a light training room, bikes on smart trainers in
 * two rows and the instructor pedalling on a stage in front. Reuses the rider
 * model (pedalling legs, spinning rear wheel) and the renderer of the road
 * view. Local axes as there: riders face −Z, up is +Y.
 */
import { invert, lookAt, multiply, perspective, placement, rotationXAbout, scaling } from "./math.js";
import { buildStudioRoom } from "./studioRoom.js";
import { INSTRUCTOR, ROOM, STAGE, seatPosition } from "./studioLayout.js";
import { STUDIO_CAMERAS, cameraModeOf, studioCamera } from "./studioCamera.js";
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

export { INSTRUCTOR, ROOM, STAGE, seatPosition };

export { STUDIO_CAMERAS, cameraModeOf, studioCamera };
export const STUDIO_CAMERA_LABELS = Object.freeze({ seat: "Behind me", pov: "My view", wide: "Whole room", coach: "Coach's view" }); // i18n-ok (English id label; the UI translates by mode)

/** Standalone daylight: a key light from above the stage and a bright sky, no fog. */
const STUDIO_LIGHT = Object.freeze({
  sun: (() => {
    const v = [0.25, 0.9, 0.45];
    const n = Math.hypot(...v);
    return v.map((x) => x / n);
  })(),
  sunColor: [1.0, 0.95, 0.85],
  zenith: [0.62, 0.74, 0.9],
  horizon: [0.85, 0.88, 0.9],
  ground: [0.6, 0.56, 0.5],
  fog: [400, 900],
  shadowStrength: 0.55,
});

const FOV_Y = (60 * Math.PI) / 180;
/**
 * The riders the room-only view draws: none too close to the camera, except
 * me, and not me in my own point of view (the camera sits in my head).
 */
export function shownInRoom(placed, myId, eye, mode) {
  return placed.filter(({ rider, position }) =>
    rider.id === myId ? mode !== "pov" : Math.hypot(position[0] - eye[0], position[2] - eye[2]) > NEAR_CAMERA_HIDE,
  );
}

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
    const { room, accents } = buildStudioRoom();
    this.room = this.renderer.upload(room);
    this.accents = this.renderer.upload(accents);
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
    const { eye, target } = studioCamera(this.cameraMode, me?.seat, { cadence: myCadence ?? 0, timeS });
    const viewProjection = multiply(perspective(FOV_Y, width / height, 0.1, 60), lookAt(eye, target));
    const inverseViewProjection = invert(viewProjection);

    const tints = { me: hexToRgb(colors.me), human: hexToRgb(colors.human), bot: hexToRgb(colors.bot), coach: hexToRgb(colors.accent) };
    const placed = riders.map((rider) => ({ rider, position: seatPosition(rider.seat), yaw: 0 }));
    placed.push({ rider: { id: INSTRUCTOR.id, name: INSTRUCTOR.name, is_bot: false, coach: true }, position: INSTRUCTOR.position, yaw: INSTRUCTOR.yaw });
    const visible = shownInRoom(placed, myId, eye, this.cameraMode);
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
    this.renderer.drawBright(this.accents, this.identity, 1);
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
    for (const handle of [this.room, this.accents, ...this.bodies, ...this.bodyParts.flatMap((p) => [...p.values()]), ...this.thighs, ...this.shins, this.foot, this.crankset, this.wheel, this.shadow]) {
      this.renderer.dispose(handle);
    }
    this.#labels.forEach((element) => element.remove());
    this.#labels.clear();
  }
}
