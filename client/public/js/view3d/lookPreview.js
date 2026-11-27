/**
 * The Look page's preview (#25): one cyclist pedalling on a slowly turning stand, on a canvas of its own. Loaded with
 * the 3D code, only when the page opens.
 */
import * as THREE from "../three.js";
import { createSharedUniforms } from "./assets/materials.js";
import { createOwner } from "./assets/owner.js";
import { createClassicCyclist } from "./assets/riders/classicCyclist.js";
import { createCyclist } from "./assets/riders/cyclist.js";

/** How the stand turns (radians per second) and how the rider pedals. */
const TURN = 0.45;
const RIDE = Object.freeze({ cadence: 82, speed: 7 });
const MAX_PIXEL_RATIO = 2;

export class LookPreview {
  #renderer;
  #scene = new THREE.Scene();
  #camera = new THREE.PerspectiveCamera(24, 1, 0.1, 50);
  #stand = new THREE.Group();
  #uniforms = createSharedUniforms();
  #cyclist = null;
  #owner = null;
  #frame = 0;
  #last = 0;
  #time = 0;
  #reducedMotion;
  #floor;

  /**
   * @param {HTMLCanvasElement} canvas
   * @param {{reducedMotion?: boolean}} [options] reduced motion: the stand stays still, the rider coasts
   */
  constructor(canvas, { reducedMotion = false } = {}) {
    this.#reducedMotion = reducedMotion;
    this.#renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.#scene.add(new THREE.HemisphereLight("#e4f0ff", "#6f6a55", 1.5));
    const sun = new THREE.DirectionalLight("#fff3e0", 2.4);
    sun.position.set(3, 6, 4);
    this.#scene.add(sun);
    const floor = (this.#floor = new THREE.Mesh(new THREE.CircleGeometry(1.4, 40), new THREE.MeshStandardMaterial({ color: "#c9c3b4", roughness: 0.9 })));
    floor.rotation.x = -Math.PI / 2;
    this.#scene.add(floor, this.#stand);
    this.#stand.rotation.y = 0.7;
    this.#camera.position.set(0.2, 1.35, 4.4);
    this.#camera.lookAt(0.1, 0.85, 0);
  }

  /** Shows `look`; `classic` draws the classic rider and bike. */
  setLook(look, classic = false) {
    const owner = createOwner();
    const cyclist = classic ? createClassicCyclist(look, { own: owner.own, uniforms: this.#uniforms }) : createCyclist(look, { own: owner.own, uniforms: this.#uniforms, seed: 1 });
    if (this.#cyclist) this.#stand.remove(this.#cyclist.object);
    this.#owner?.disposeAll();
    this.#cyclist = cyclist;
    this.#owner = owner;
    this.#stand.add(cyclist.object);
    cyclist.ride(0, this.#rideState());
    this.#draw();
  }

  #rideState() {
    return this.#reducedMotion ? { cadence: 0, speed: 0, t: this.#time } : { ...RIDE, t: this.#time };
  }

  /** Keeps the canvas's drawing buffer at its shown size. */
  #fit() {
    const canvas = this.#renderer.domElement;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (!width || !height) return false;
    const ratio = Math.min(MAX_PIXEL_RATIO, globalThis.devicePixelRatio || 1);
    if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
      this.#renderer.setPixelRatio(ratio);
      this.#renderer.setSize(width, height, false);
      this.#camera.aspect = width / height;
      this.#camera.updateProjectionMatrix();
    }
    return true;
  }

  #draw() {
    if (this.#fit()) this.#renderer.render(this.#scene, this.#camera);
  }

  /** Starts turning and pedalling, drawing every animation frame. */
  start() {
    if (this.#frame) return;
    this.#last = performance.now();
    const step = (now) => {
      const dt = Math.min(0.1, (now - this.#last) / 1000);
      this.#last = now;
      this.#time += dt;
      if (!this.#reducedMotion) this.#stand.rotation.y += dt * TURN;
      this.#cyclist?.ride(dt, this.#rideState());
      this.#draw();
      this.#frame = requestAnimationFrame(step);
    };
    this.#frame = requestAnimationFrame(step);
  }

  stop() {
    if (this.#frame) cancelAnimationFrame(this.#frame);
    this.#frame = 0;
  }

  dispose() {
    this.stop();
    this.#owner?.disposeAll();
    this.#floor.geometry.dispose();
    this.#floor.material.dispose();
    this.#renderer.dispose();
  }
}
