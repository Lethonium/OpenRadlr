/**
 * The Look page's preview (#25): one cyclist pedalling on a slowly turning stand, on a canvas of its own. Loaded with
 * the 3D code, only when the page opens.
 */
import * as THREE from "../three.js";
import { createSharedUniforms } from "./assets/materials.js";
import { createOwner } from "./assets/owner.js";
import { createClassicCyclist } from "./assets/riders/classicCyclist.js";
import { createCyclist } from "./assets/riders/cyclist.js";
import { Turntable } from "./lookTurntable.js";

/** How the rider pedals. */
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
  #turntable;
  /** Geometries and materials of the little scene, freed with the preview. */
  #props = [];
  #removeDrag;

  /**
   * @param {HTMLCanvasElement} canvas
   * @param {{reducedMotion?: boolean}} [options] reduced motion: the stand stays still, the rider coasts
   */
  constructor(canvas, { reducedMotion = false } = {}) {
    this.#reducedMotion = reducedMotion;
    this.#turntable = new Turntable({ still: reducedMotion });
    this.#renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.#renderer.shadowMap.enabled = true;
    this.#renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.#scene.add(new THREE.HemisphereLight("#e4f0ff", "#5f6b45", 1.4));
    const sun = new THREE.DirectionalLight("#fff3e0", 2.6);
    sun.position.set(2.5, 6, 3);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    Object.assign(sun.shadow.camera, { left: -2, right: 2, top: 2, bottom: -2, near: 1, far: 15 });
    sun.shadow.radius = 4;
    this.#scene.add(sun, this.#stand);
    this.#buildGround();
    this.#camera.position.set(0.2, 1.45, 4.6);
    this.#camera.lookAt(0.1, 0.8, 0);
    this.#removeDrag = this.#listenForDrags(canvas);
  }

  /** A round patch of meadow with a stretch of road on the stand, the bike on its lane. */
  #buildGround() {
    const own = (resource) => (this.#props.push(resource), resource);
    const flat = (geometry, colour, y) => {
      const mesh = new THREE.Mesh(own(geometry), own(new THREE.MeshStandardMaterial({ color: colour, roughness: 0.95 })));
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.y = y;
      mesh.receiveShadow = true;
      return mesh;
    };
    this.#stand.add(
      flat(new THREE.CircleGeometry(1.6, 48), "#6f8f4a", 0),
      flat(new THREE.PlaneGeometry(3.2, 1.3), "#4a4e55", 0.004),
      ...[-1.2, -0.4, 0.4, 1.2].map((x) => {
        const dash = flat(new THREE.PlaneGeometry(0.42, 0.05), "#e9e6dc", 0.006);
        dash.position.set(x, 0.006, -0.45);
        return dash;
      }),
    );
  }

  /** Dragging across the preview turns the stand; vertical moves still scroll the page (CSS touch-action). */
  #listenForDrags(canvas) {
    let lastX = null;
    const down = (event) => {
      lastX = event.clientX;
      this.#turntable.grab();
      canvas.setPointerCapture?.(event.pointerId);
    };
    const move = (event) => {
      if (lastX === null) return;
      this.#turntable.drag(event.clientX - lastX);
      lastX = event.clientX;
      if (!this.#frame) this.#draw();
    };
    const up = () => {
      if (lastX === null) return;
      lastX = null;
      this.#turntable.release();
    };
    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", up);
    return () => {
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", up);
      canvas.removeEventListener("pointercancel", up);
    };
  }

  /** Shows `look`; `classic` draws the classic rider and bike. */
  setLook(look, classic = false) {
    const owner = createOwner();
    const cyclist = classic ? createClassicCyclist(look, { own: owner.own, uniforms: this.#uniforms }) : createCyclist(look, { own: owner.own, uniforms: this.#uniforms, seed: 1 });
    if (this.#cyclist) this.#stand.remove(this.#cyclist.object);
    this.#owner?.disposeAll();
    this.#cyclist = cyclist;
    this.#owner = owner;
    cyclist.object.traverse((child) => child.isMesh && (child.castShadow = true));
    cyclist.object.position.z = 0.15;
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
    this.#stand.rotation.y = this.#turntable.angle;
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
      this.#turntable.update(dt);
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
    this.#removeDrag();
    for (const resource of this.#props) resource.dispose();
    this.#renderer.dispose();
  }
}
