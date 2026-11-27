/**
 * A modern three-blade wind turbine: a white tapered tower on a plinth, a
 * nacelle and a rotor. The rotor (hub cone and blades) is a separate `rotor`
 * mover about the z axis, so the layer can turn it; it faces +z. Restyled
 * from the reference's `wind-turbine.js` (which faced +x).
 */
import * as THREE from "../../../three.js";
import { box, colour, cone, cylinder, paint } from "../geom.js";
import { defineBuilding } from "./building.js";

const HEIGHT = 62;
const BLADE = 30;
const HUB_Z = 2.6;

/** A blade standing along +y from the hub, tapering and twisting toward its tip. */
function blade(color, segments, angle) {
  const geometry = paint(new THREE.BoxGeometry(1.7, BLADE, 0.35, 1, segments, 1), color);
  const p = geometry.attributes.position;
  for (let i = 0; i < p.count; i += 1) {
    const y = p.getY(i) + BLADE / 2;
    const t = y / BLADE;
    p.setX(i, p.getX(i) * (1 - t * 0.75) + (1 - t) * 0.35);
    p.setZ(i, p.getZ(i) * (1 - t * 0.6));
    p.setY(i, y + 0.8);
  }
  return geometry.rotateZ(angle);
}

export const windTurbine = defineBuilding(
  { id: "windTurbine", name: "Wind turbine", description: "A three-blade turbine on a tall white tower; the rotor turns." }, // i18n-ok
  ({ detail, dice }) => {
    const white = colour("#eef0f2");
    const near = [
      cylinder(1.2, 2.1, HEIGHT, detail ? 16 : 10, white, 0, HEIGHT / 2, 0, true),
      cylinder(3.2, 3.2, 1, 16, colour("#b8b4ac"), 0, 0.4, 0),
      box(2.8, 2.8, 7, white, 0, HEIGHT + 1.2, -1.2),
      box(0.4, 0.5, 0.6, colour("#d93a2f"), 0, HEIGHT + 2.8, -3.6),
    ];
    const far = [cylinder(1.2, 2.1, HEIGHT, 6, white, 0, HEIGHT / 2, 0, true), box(2.8, 2.8, 7, white, 0, HEIGHT + 1.2, -1.2)];
    const turn = dice.range(0, 6);
    const rotor = [cone(1.25, 2.6, detail ? 14 : 8, white).rotateX(Math.PI / 2).translate(0, 0, 0.9)];
    for (let k = 0; k < 3; k += 1) rotor.push(blade(white, detail ? 8 : 3, turn + (k * Math.PI * 2) / 3));
    const mover = { name: "rotor", geometries: rotor.map((part) => part.translate(0, HEIGHT + 1.2, HUB_Z)), x: 0, y: HEIGHT + 1.2, z: HUB_Z, axis: [0, 0, 1] };
    return { near, far, glows: [], movers: [mover], width: 7, depth: 7, eaves: HEIGHT, door: { x: 0, y: 1, z: 3 } };
  },
);
