/**
 * A roadside billboard's frame: two dark posts, a dark back panel and a white lip around the poster, facing +z with the
 * ground at y = 0 and the centre of the frame on x = 0. The poster itself is a plain quad (`posterQuad`) that the board
 * layer paints onto, so the frame carries no picture. Vertex colours, like the other props; the detail version adds a
 * walkway rail and a lamp housing over the top edge.
 */
import { box, colour, merge } from "../geom.js";

/** Poster size and placement (metres): `lift` is the bottom edge's height, `inset` how far in front of the back panel the poster plane sits. */
export const POSTER = Object.freeze({ width: 6, height: 3, lift: 2.2, inset: 0.05 });

const LIP = 0.15;
const TOP = POSTER.lift + POSTER.height + LIP;
const LOWER = POSTER.lift - LIP;
const OUTER_WIDTH = POSTER.width + 2 * LIP;
const OUTER_HEIGHT = TOP - LOWER;
const CENTRE_Y = (TOP + LOWER) / 2;

/**
 * The billboard frame as one merged, vertex-coloured geometry.
 * @param {{detail: boolean}} options
 * @returns {import("../../../three.js").BufferGeometry}
 */
export function billboardFrame({ detail }) {
  const pole = colour("#5a5f66");
  const panel = colour("#2b2f36");
  const frame = colour("#eeeeea");
  const parts = [
    box(0.2, TOP, 0.2, pole, -2.4, TOP / 2, -0.25),
    box(0.2, TOP, 0.2, pole, 2.4, TOP / 2, -0.25),
    box(OUTER_WIDTH, OUTER_HEIGHT, 0.1, panel, 0, CENTRE_Y, -0.1),
    box(OUTER_WIDTH, LIP, 0.1, frame, 0, TOP - LIP / 2, 0),
    box(OUTER_WIDTH, LIP, 0.1, frame, 0, LOWER + LIP / 2, 0),
    box(LIP, POSTER.height, 0.1, frame, -(POSTER.width / 2 + LIP / 2), CENTRE_Y, 0),
    box(LIP, POSTER.height, 0.1, frame, POSTER.width / 2 + LIP / 2, CENTRE_Y, 0),
  ];
  if (detail) {
    parts.push(box(OUTER_WIDTH, 0.06, 0.06, pole, 0, 1.6, 0.25));
    parts.push(box(1.4, 0.25, 0.4, colour("#3f4144"), 0, TOP + 0.125, 0.2));
  }
  return merge(parts);
}

/**
 * The poster quad in the asset's local space: corners bottom-left, bottom-right, top-right, top-left, with the given
 * texture rectangle `[u0, v0, u1, v1]` (v = 0 at the bottom).
 * @param {[number, number, number, number]} uv
 * @returns {{positions: Float32Array, uvs: Float32Array, index: number[]}}
 */
export function posterQuad([u0, v0, u1, v1]) {
  const half = POSTER.width / 2;
  const bottom = POSTER.lift;
  const top = POSTER.lift + POSTER.height;
  const z = POSTER.inset;
  return {
    positions: new Float32Array([-half, bottom, z, half, bottom, z, half, top, z, -half, top, z]),
    uvs: new Float32Array([u0, v0, u1, v0, u1, v1, u0, v1]),
    index: [0, 1, 2, 0, 2, 3],
  };
}
