/**
 * Winter's herd animals. The world has three generic animal slots (the first
 * two graze in small groups, the third in a larger herd); winter fills them
 * with a caribou, a polar bear and a walrus instead of cows and sheep.
 *
 * Same convention as every model: origin on the ground at the centre of the
 * footprint, front faces −Z, placed with `placement(pos, yaw)`.
 */
import { MeshBuilder } from "../../meshBuilder.js";

const COAT = [0.42, 0.29, 0.19];
const PALE = [0.68, 0.6, 0.46];
const ANTLER = [0.72, 0.67, 0.55];
const HOOF = [0.16, 0.15, 0.14];

/** A caribou (reindeer): brown coat, pale neck, branched antlers. */
export function buildCaribou() {
  const m = new MeshBuilder();
  // Body, neck and head.
  m.box([0, 1.15, 0.1], [0.85, 0.9, 1.9], COAT);
  m.box([0, 1.32, -0.98], [0.62, 0.85, 0.75], PALE);
  m.box([0, 1.55, -1.42], [0.46, 0.52, 0.62], COAT);
  m.box([0, 1.42, -1.8], [0.32, 0.3, 0.24], PALE);
  m.box([0, 1.36, -1.94], [0.16, 0.12, 0.08], HOOF); // nose
  for (const x of [-0.3, 0.3]) m.box([x, 1.1, 1.08], [0.22, 0.22, 0.22], PALE); // rump patch
  for (const side of [-1, 1]) {
    m.box([side * 0.26, 1.72, -1.28], [0.16, 0.22, 0.12], COAT); // ears
    // Antlers: a main beam with two tines, one swept back.
    const base = [side * 0.2, 1.78, -1.4];
    const mid = [side * 0.3, 2.02, -1.2];
    const top = [side * 0.24, 2.24, -1.06];
    m.segment(base, mid, 0.055, 0.055, ANTLER);
    m.segment(mid, top, 0.045, 0.045, ANTLER);
    m.segment(mid, [side * 0.52, 2.04, -1.02], 0.04, 0.04, ANTLER);
    m.segment(top, [side * 0.1, 2.48, -0.94], 0.035, 0.035, ANTLER);
  }
  // Legs and hooves.
  for (const [x, z] of [
    [-0.32, -0.7],
    [0.32, -0.7],
    [-0.32, 0.8],
    [0.32, 0.8],
  ]) {
    m.box([x, 0.5, z], [0.2, 1.0, 0.2], COAT);
    m.box([x, 0.06, z], [0.24, 0.12, 0.24], HOOF);
  }
  m.box([0, 1.25, 1.06], [0.16, 0.32, 0.16], PALE); // tail
  return m.build();
}

/** A polar bear: heavy cream body, small ears, broad paws. */
export function buildPolarBear() {
  const m = new MeshBuilder();
  const fur = [0.93, 0.92, 0.88];
  const furShade = [0.86, 0.85, 0.81];
  m.ellipsoid([0, 1.05, 0.15], [0.66, 0.58, 1.15], fur, 3, 7);
  m.ellipsoid([0, 1.3, -1.08], [0.4, 0.37, 0.44], fur, 3, 7);
  m.box([0, 1.22, -1.45], [0.36, 0.28, 0.3], furShade); // snout
  m.box([0, 1.2, -1.62], [0.14, 0.11, 0.08], HOOF); // nose
  for (const side of [-1, 1]) {
    m.box([side * 0.26, 1.58, -0.98], [0.18, 0.18, 0.14], fur); // ears
    m.box([side * 0.42, 0.4, -0.72], [0.26, 0.8, 0.28], fur); // front legs
    m.box([side * 0.42, 0.26, -0.78], [0.3, 0.12, 0.34], furShade); // paws
    m.box([side * 0.42, 0.4, 0.78], [0.26, 0.8, 0.28], fur); // hind legs
    m.box([side * 0.42, 0.26, 0.84], [0.3, 0.12, 0.34], furShade);
  }
  m.box([0, 1.15, 1.22], [0.2, 0.22, 0.2], fur); // tail
  return m.build();
}

/** A walrus: a heavy grey-brown body, flippers and two cream tusks. */
export function buildWalrus() {
  const m = new MeshBuilder();
  const skin = [0.5, 0.43, 0.36];
  const skinShade = [0.42, 0.36, 0.3];
  const tusk = [0.92, 0.89, 0.8];
  m.ellipsoid([0, 0.82, 0.2], [0.88, 0.64, 1.32], skin, 3, 7);
  m.ellipsoid([0, 1.02, -1.3], [0.46, 0.4, 0.5], skin, 3, 7);
  m.box([0, 0.94, -1.64], [0.42, 0.3, 0.28], skinShade); // muzzle
  for (const side of [-1, 1]) {
    // Tusks curving down from the upper jaw.
    m.segment([side * 0.12, 0.92, -1.76], [side * 0.13, 0.46, -1.82], 0.07, 0.07, tusk);
    m.box([side * 0.14, 1.08, -1.5], [0.06, 0.06, 0.06], HOOF); // eyes
    // Front and rear flippers.
    m.box([side * 0.82, 0.28, -0.55], [0.5, 0.16, 0.72], skinShade);
    m.box([side * 0.62, 0.24, 1.15], [0.4, 0.14, 0.66], skinShade);
  }
  m.box([0, 0.42, 1.5], [0.42, 0.14, 0.3], skinShade); // tail flipper
  return m.build();
}
