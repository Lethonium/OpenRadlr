/**
 * Winter's props: the roadside markers as snowmen. (The café, with its snow roof, is the new world's: assets/buildings/bikeCafe.js.)
 */
import { MeshBuilder } from "../../meshBuilder.js";
import { buildVillageSign, buildWarningSign } from "../../structures.js";

/**
 * A roadside marker as a snowman: three snowballs, coal eyes, a carrot nose,
 * twig arms, a scarf and a red hat. The pair at every kilometre wears a yellow
 * scarf so the distance still reads at speed; the rest wear a red one.
 */
export function buildWinterPost(km = false) {
  const m = new MeshBuilder();
  const body = [0.97, 0.98, 1.0];
  const coal = [0.14, 0.15, 0.17];
  const carrot = [0.95, 0.5, 0.12];
  const red = [0.78, 0.2, 0.18];
  const yellow = [0.95, 0.78, 0.24];
  const scarf = km ? yellow : red;

  m.ellipsoid([0, 0.34, 0], [0.34, 0.34, 0.34], body, 3, 6);
  m.ellipsoid([0, 0.82, 0], [0.26, 0.26, 0.26], body, 3, 6);
  m.ellipsoid([0, 1.18, 0], [0.18, 0.18, 0.18], body, 3, 6);
  for (const x of [-0.06, 0.06]) m.box([x, 1.22, -0.15], [0.035, 0.035, 0.035], coal);
  m.segment([0, 1.15, -0.14], [0, 1.15, -0.36], 0.06, 0.06, carrot);
  for (const side of [-1, 1]) m.segment([side * 0.2, 0.9, 0], [side * 0.48, 1.07, 0], 0.04, 0.04, coal);
  m.box([0, 1.02, 0], [0.36, 0.1, 0.36], scarf);
  m.box([0.14, 0.93, -0.15], [0.09, 0.22, 0.06], scarf);
  m.cone([0, 1.33, 0], 0.22, 0.34, red, 6);
  return m.build();
}

/** Every model a winter world needs. */
export const winterModels = Object.freeze({
  post: buildWinterPost,
  warning: buildWarningSign,
  villageSign: buildVillageSign,
});
