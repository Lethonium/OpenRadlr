/**
 * 3D spin studio, room only: a light training room, bikes on smart trainers in
 * two rows and the instructor pedalling on a stage in front. The room and the
 * riders are the Three.js scene's own (the studio asset and the rider layer, as
 * in the valley's building); this is the fallback for when the valley world
 * does not load. Local axes as in the building: riders face −Z, up is +Y.
 */
import * as THREE from "../three.js";
import { lookAt, multiply, perspective } from "./math.js";
import { createStudioRoom } from "./assets/buildings/spinStudio.js";
import { createSharedUniforms } from "./assets/materials.js";
import { cameraFromMatrices } from "./engine/camera.js";
import { engineFor } from "./engine/engine.js";
import { createRiderLayer } from "./scene/riderLayer.js";
import { createTracker, createOwner } from "./scene/tracker.js";
import { COACH_KIT, INSTRUCTOR, ROOM, STAGE, coachId, seatPosition } from "./studioLayout.js";
import { STUDIO_CAMERAS, cameraModeOf, studioCamera } from "./studioCamera.js";
import { hexToRgb, linearOf, projectToScreen, visibleLabels } from "./view3d.js";
import { QUALITY_LEVELS, qualitySettings } from "./quality.js";

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
  sunIntensity: 2.6,
  hemiSky: [0.84, 0.93, 1.0],
  hemiGround: [0.6, 0.56, 0.5],
  hemiIntensity: 1.1,
  horizon: [0.85, 0.88, 0.9],
});

/** What the post chain reads: a bright, clear day. */
const STUDIO_ENV = Object.freeze({ exposure: 1.05, sun: STUDIO_LIGHT.sun, sunColor: STUDIO_LIGHT.sunColor, night: 0, overcast: 0 });

/** The riders the room draws: as many as the room holds, all within its length. */
const RIDER_SETTINGS = Object.freeze({ full: 17, reach: 60 });
/** The shadow box over the room (half its edge, metres) and the sun's distance from its centre. */
const SHADOW = Object.freeze({ half: 11, centre: [0, 0, -1.5], distance: 30, near: 1, far: 70 });
/** Name labels hang this high above the floor under a rider (head and a little more), metres. */
const HEAD_LABEL_HEIGHT = 2;

const FOV_Y = (60 * Math.PI) / 180;
/**
 * The riders the room-only view draws: none too close to the camera, except
 * me and the coach. In my own point of view my bike stays and only my body is left out
 * (the camera sits in my head): the view sets `hideBody` on my entry.
 */
export function shownInRoom(placed, myId, eye) {
  return placed.filter(({ rider, position }) => rider.id === myId || rider.coach || Math.hypot(position[0] - eye[0], position[2] - eye[2]) > NEAR_CAMERA_HIDE);
}

/** Riders this close to the camera (horizontally) would fill the screen; they're not drawn. */
const NEAR_CAMERA_HIDE = 1.2;

/** The way a rider with this yaw faces (−Z at yaw 0). */
const forwardOf = (yaw) => [-Math.sin(yaw), 0, -Math.cos(yaw)];

export class StudioView3D {
  #labels = new Map();
  #classicRider = false;
  #lastTime = null;
  #reducedMotion;
  #owner;
  #uniforms = createSharedUniforms();
  #camera = new THREE.PerspectiveCamera();
  #sun;
  #sunDirection = new THREE.Vector3(...STUDIO_LIGHT.sun);
  cameraMode = "seat";
  quality = "high";

  /**
   * @param {HTMLCanvasElement} canvas
   * @param {HTMLElement} labelLayer absolutely positioned element over the canvas
   * @param {{engine?: object, reducedMotion?: boolean}} [options] `engine` the canvas's engine (tests; the canvas's own is used otherwise);
   *   no camera bob with reduced motion
   */
  constructor(canvas, labelLayer, { engine = null, reducedMotion = false } = {}) {
    this.canvas = canvas;
    this.labelLayer = labelLayer;
    this.#reducedMotion = reducedMotion;
    // One engine per canvas, shared with every other view on it and never disposed here.
    this.engine = engine ?? engineFor(canvas);
    this.tracker = createTracker();
    this.#owner = createOwner(this.tracker.track);
    const { own } = this.#owner;
    const settings = qualitySettings(this.quality);
    this.engine.setQuality(settings);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color().setRGB(...STUDIO_LIGHT.horizon, THREE.LinearSRGBColorSpace);
    this.room = createStudioRoom({ own, ceiling: true });
    this.room.setOpen(true);
    this.scene.add(this.room.object);
    const hemisphere = new THREE.HemisphereLight();
    hemisphere.color.setRGB(...STUDIO_LIGHT.hemiSky);
    hemisphere.groundColor.setRGB(...STUDIO_LIGHT.hemiGround);
    hemisphere.intensity = STUDIO_LIGHT.hemiIntensity;
    this.#sun = own(new THREE.DirectionalLight(0xffffff, STUDIO_LIGHT.sunIntensity));
    this.#sun.color.setRGB(...STUDIO_LIGHT.sunColor);
    const { half, centre, distance } = SHADOW;
    Object.assign(this.#sun.shadow.camera, { left: -half, right: half, top: half, bottom: -half, near: SHADOW.near, far: SHADOW.far });
    this.#sun.shadow.camera.updateProjectionMatrix();
    this.#sun.shadow.bias = -0.0004;
    this.#sun.shadow.normalBias = 0.03;
    this.#sun.target.position.set(...centre);
    this.#sun.position.set(...centre).addScaledVector(this.#sunDirection, distance);
    this.#sun.target.updateMatrixWorld();
    this.scene.add(hemisphere, this.#sun, this.#sun.target);
    this.#uniforms.sunCol.value.setRGB(...STUDIO_LIGHT.sunColor);
    this.#shadows(settings);
    this.#makeRiders(settings);
  }

  /** Draws my own rider as the classic cyclist (the old rider and bike); the others and the coach keep the new look. */
  setClassicRider(on) {
    this.#classicRider = Boolean(on);
  }

  /** The room's riders, rebuilt for a graphics level. */
  #makeRiders(settings) {
    this.riderLayer?.dispose();
    if (this.riderLayer) this.scene.remove(this.riderLayer.object);
    this.riderLayer = createRiderLayer({ settings: { ...settings, riders: RIDER_SETTINGS }, uniforms: this.#uniforms, track: this.tracker.track });
    this.riderLayer.setEnvironment({ night: 0 });
    this.scene.add(this.riderLayer.object);
  }

  /** The sun's shadow map for a graphics level: its size, or none. */
  #shadows({ shadowMapSize }) {
    const sun = this.#sun;
    if (sun.shadow.mapSize.x !== shadowMapSize) {
      sun.shadow.mapSize.set(Math.max(1, shadowMapSize), Math.max(1, shadowMapSize));
      sun.shadow.map?.dispose();
      sun.shadow.map = null;
    }
    sun.castShadow = shadowMapSize > 0;
  }

  /** The camera for my seat; My view bobs with my cadence unless motion is reduced. */
  cameraPose(mySeat, cadence, timeS) {
    return studioCamera(this.cameraMode, mySeat, { cadence, timeS, reducedMotion: this.#reducedMotion });
  }

  setQuality(quality) {
    if (!QUALITY_LEVELS.includes(quality)) return;
    this.quality = quality;
    const settings = qualitySettings(quality);
    this.engine.setQuality(settings);
    this.#shadows(settings);
    this.#makeRiders(settings);
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
    const { pixelRatioMax } = qualitySettings(this.quality);
    const ratio = Math.min(globalThis.devicePixelRatio || 1, pixelRatioMax);
    const width = Math.max(1, Math.round(this.canvas.clientWidth));
    const height = Math.max(1, Math.round(this.canvas.clientHeight));
    this.engine.resize(width, height, ratio);

    const me = riders.find((r) => r.id === myId);
    const { eye, target } = this.cameraPose(me?.seat, myCadence ?? 0, timeS);
    const projection = perspective(FOV_Y, width / height, 0.1, 60);
    const view = lookAt(eye, target);
    const viewProjection = multiply(projection, view);
    cameraFromMatrices(this.#camera, view, projection);
    this.#camera.near = 0.1;
    this.#camera.far = 60;
    this.#camera.aspect = width / height;

    const tints = { me: hexToRgb(colors.me), human: hexToRgb(colors.human), bot: hexToRgb(colors.bot), coach: hexToRgb(COACH_KIT) };
    const placed = riders.map((rider) => ({ rider, position: seatPosition(rider.seat), yaw: 0 }));
    placed.push({ rider: { id: INSTRUCTOR.id, name: INSTRUCTOR.name, is_bot: false, coach: true }, position: INSTRUCTOR.position, yaw: INSTRUCTOR.yaw });
    const visible = shownInRoom(placed, myId, eye);
    const entries = visible.map(({ rider, position, yaw }) => {
      const mine = rider.id === myId;
      const tint = rider.coach ? tints.coach : mine ? tints.me : rider.is_bot ? tints.bot : tints.human;
      return {
        id: rider.coach ? coachId(0) : rider.id,
        lookId: rider.coach ? INSTRUCTOR.id : undefined,
        me: mine,
        position,
        forward: forwardOf(yaw),
        cadence: rider.coach ? coachCadence : mine ? (myCadence ?? 0) : (rider.cadence ?? 0),
        speed: rider.coach ? (coachCadence > 0 ? 9 : 0) : (rider.speed ?? 0),
        grade: 0,
        tint: linearOf(tint),
        ghost: false,
        classic: mine && this.#classicRider,
        // In my own point of view the camera sits in my head: the body is left out, the bike stays.
        hideBody: mine && this.cameraMode === "pov",
      };
    });

    this.#uniforms.time.value += dt;
    this.#uniforms.sunDirV.value.copy(this.#sunDirection).transformDirection(this.#camera.matrixWorldInverse);
    this.riderLayer.update({ dt, t: timeS, camera: this.#camera, riders: entries });
    this.engine.beginFrame(STUDIO_ENV);
    this.engine.renderScene(this.scene, this.#camera);
    this.#updateLabels(visible, myId, eye, viewProjection, width, height);
    this.engine.present(this.#camera, STUDIO_ENV, { ride: false, height: 0 });
  }

  #updateLabels(placed, myId, eye, viewProjection, width, height) {
    const candidates = [];
    for (const { rider, position } of placed) {
      const head = [position[0], position[1] + HEAD_LABEL_HEIGHT, position[2]];
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
    this.riderLayer.dispose();
    this.scene.clear();
    this.#owner.disposeAll();
    this.#labels.forEach((element) => element.remove());
    this.#labels.clear();
  }
}
