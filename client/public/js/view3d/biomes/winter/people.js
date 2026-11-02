/**
 * Winter's crowd: penguins instead of people, clapping their flippers.
 *
 * The two poses are the two frames the view alternates between. Everything
 * but the scarf is opaque, so the per-person shirt tint colours only the
 * scarf; the body keeps its black-and-white plumage.
 */
import { MeshBuilder } from "../../meshBuilder.js";

const COAT = [0.1, 0.12, 0.16];
const COAT_LIGHT = [0.18, 0.21, 0.27];
const BELLY = [0.96, 0.97, 1.0];
const BEAK = [0.96, 0.56, 0.12];
const EYE = [0.03, 0.03, 0.04];
const SCARF = [1, 1, 1, 1]; // tinted per penguin by the view

/** A penguin facing −Z. `clapping` puts both flippers together in front. */
export function buildPenguin(clapping) {
  const m = new MeshBuilder();

  // Webbed feet and a short tail behind the body.
  for (const side of [-1, 1]) m.box([side * 0.16, 0.045, -0.08], [0.22, 0.09, 0.34], BEAK);
  m.box([0, 0.18, 0.33], [0.28, 0.12, 0.24], COAT_LIGHT);

  // Black back and the white belly standing proud of it.
  m.ellipsoid([0, 0.66, 0.02], [0.38, 0.62, 0.31], COAT, 3, 7);
  m.ellipsoid([0, 0.62, -0.18], [0.28, 0.45, 0.16], BELLY, 3, 6);

  // Head with a white face patch, eyes and an orange beak.
  m.ellipsoid([0, 1.26, -0.02], [0.27, 0.26, 0.26], COAT, 3, 7);
  m.ellipsoid([0, 1.24, -0.2], [0.19, 0.18, 0.09], BELLY, 2, 6);
  for (const side of [-1, 1]) m.box([side * 0.085, 1.28, -0.285], [0.06, 0.07, 0.04], EYE);
  m.segment([0, 1.19, -0.24], [0, 1.14, -0.45], 0.14, 0.1, BEAK);

  // A knitted scarf around the neck, and its loose end on the white chest.
  m.box([0, 1.05, 0], [0.52, 0.11, 0.42], SCARF);
  m.box([0.18, 0.92, -0.31], [0.1, 0.26, 0.06], SCARF);

  // Flippers: spread out for the open beat, meeting in front for the clap.
  for (const side of [-1, 1]) {
    const shoulder = [side * 0.3, 0.96, -0.02];
    const tip = clapping ? [side * 0.06, 0.72, -0.32] : [side * 0.46, 0.78, -0.12];
    m.segment(shoulder, tip, 0.12, 0.16, COAT_LIGHT);
  }

  return m.build();
}
