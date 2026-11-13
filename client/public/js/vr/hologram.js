/**
 * The ride HUD in VR: a see-through cyan panel rising from the stem, leaning
 * towards the rider, with the window's numbers in glowing pixel digits. It
 * lives in bike space, so it moves with the bike and never with the head.
 * `hologramLayout` decides what goes where (pure); `Hologram` draws it.
 */
import { formatDuration, speedUnit } from "../util/format.js";
import { BODY_JOINTS } from "../view3d/riderModel.js";
import { MeshBuilder } from "../view3d/meshBuilder.js";
import { multiply, placement } from "../view3d/math.js";
import { pixelText } from "../view3d/pixelFont.js";
import { ZONE_COLORS } from "../view/workoutView.js";

const CYAN = [0.55, 0.95, 1.0];
const TEXT = [0.85, 1.0, 1.0];
// The top tips away from the rider (negative lean) so the face points up at the seated eye (head height above the saddle, see seatAnchor.js): read face-on, not edge-on.
const PANEL = { width: 0.37, height: 0.15, gap: 0.04, lean: (-49 * Math.PI) / 180, edge: 0.003, textLift: 0.002 };
const PIXEL = { big: 0.006, small: 0.0028 };
const MIN_REBUILD_S = 0.25;
const GLASS_ALPHA = 0.18;

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
/** Upper case, in the font's characters: the dash and the minus sign are a plain "-". */
const upper = (value) => String(value).toUpperCase().replace(/[–−]/g, "-");

/**
 * What the panel says and where, `u` right and `v` up in metres from its centre.
 * @param {object} values from `rideHudValues`
 * @param {{workout?: {workout: {segments: object[]}, state: {index: number, segmentRemainingS: number}}}} options the running workout, if any
 * @returns {{cells: {text: string, at: number[], size: "big" | "small", color: number[]}[]}}
 */
export function hologramLayout(values, { workout = null } = {}) {
  const zone = Number(String(values.zone).slice(1)) || 1;
  const cells = [];
  const put = (text, u, v, size = "small", color = TEXT) => cells.push({ text: upper(text), at: [u, v], size, color });
  put(values.power, 0, 0.03, "big", rgb(ZONE_COLORS[Math.min(5, Math.max(0, zone - 1))]));
  put(`W · ${values.zone}`, 0, -0.005);
  put(values.speed, -0.13, 0.045);
  put(speedUnit(), -0.13, 0.022);
  put(values.cadence, -0.13, -0.005);
  put("RPM" /* i18n-ok */, -0.13, -0.028);
  put(values.grade, 0.13, 0.045);
  put(values.hr, 0.13, 0.022);
  put("BPM" /* i18n-ok */, 0.13, -0.001);
  if (workout) {
    const target = values.target;
    put(Number.isFinite(target) ? `${target} W` : "-", -0.12, -0.062);
    put(`${workout.state.index + 1}/${workout.workout.segments.length}`, 0, -0.062);
    put(formatDuration(workout.state.segmentRemainingS), 0.12, -0.062);
  }
  return { cells };
}

/** A quad facing +Z from corner to corner, at depth `z`. */
function rectangle(mesh, [x0, y0], [x1, y1], z, color) {
  mesh.quad([x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z], color);
}

function glass() {
  const mesh = new MeshBuilder();
  rectangle(mesh, [-PANEL.width / 2, -PANEL.height / 2], [PANEL.width / 2, PANEL.height / 2], 0, [...CYAN, 1]);
  return mesh.build();
}

function frame() {
  const mesh = new MeshBuilder();
  const [w, h, e] = [PANEL.width / 2, PANEL.height / 2, PANEL.edge];
  const color = [...CYAN, 0];
  rectangle(mesh, [-w, h - e], [w, h], 0, color);
  rectangle(mesh, [-w, -h], [w, -h + e], 0, color);
  rectangle(mesh, [-w, -h + e], [-w + e, h - e], 0, color);
  rectangle(mesh, [w - e, -h + e], [w, h - e], 0, color);
  return mesh.build();
}

function text(layout) {
  const mesh = new MeshBuilder();
  for (const { text: words, at, size, color } of layout.cells) {
    pixelText(mesh, words, { origin: [at[0], at[1], PANEL.textLift], right: [1, 0, 0], up: [0, 1, 0], facing: [0, 0, 1], pixel: PIXEL[size], color: [...color, 0] });
  }
  return mesh.build();
}

export class Hologram {
  #renderer;
  #glass;
  #frame;
  #text = null;
  #key = null;
  #builtAt = -Infinity;
  /** The panel's centre in bike space and its lean, from the bars. */
  #local;

  /** @param {import("../view3d/renderer.js").Renderer} renderer */
  constructor(renderer) {
    this.#renderer = renderer;
    this.#glass = renderer.upload(glass());
    this.#frame = renderer.upload(frame());
    const bars = [0, 1, 2].map((k) => (BODY_JOINTS.handL[k] + BODY_JOINTS.handR[k]) / 2);
    // The bottom edge is the hinge: the panel's centre sits half its height up the lean.
    const half = PANEL.height / 2;
    this.#local = placement([bars[0], bars[1] + PANEL.gap + half * Math.cos(PANEL.lean), bars[2] + half * Math.sin(PANEL.lean)], 0, PANEL.lean);
  }

  /**
   * Shows the ride's numbers. The text mesh is rebuilt only when the words
   * change, and then at most four times a second (`timeS`, when given).
   * @param {object} values from `rideHudValues`
   * @param {{workout?: object}} options the running workout, if any
   */
  update(values, { workout = null } = {}, timeS = null) {
    const layout = hologramLayout(values, { workout });
    const key = JSON.stringify(layout.cells);
    if (key === this.#key) return;
    if (this.#text && timeS !== null && timeS - this.#builtAt < MIN_REBUILD_S) return;
    if (this.#text) this.#renderer.dispose(this.#text);
    this.#text = this.#renderer.upload(text(layout));
    this.#key = key;
    this.#builtAt = timeS ?? -Infinity;
  }

  /** Draws the panel in the view the renderer has begun; `bikeModel` is the bike's world matrix. */
  draw(bikeModel) {
    if (!this.#text) return;
    const model = multiply(bikeModel, this.#local);
    this.#renderer.drawBright(this.#frame, model, 1);
    this.#renderer.drawBright(this.#text, model, 1);
    this.#renderer.drawTransparent(this.#glass, model, { alpha: GLASS_ALPHA, unlit: 1, tint: CYAN });
  }

  dispose() {
    for (const handle of [this.#glass, this.#frame, this.#text]) if (handle) this.#renderer.dispose(handle);
    this.#text = null;
  }
}
