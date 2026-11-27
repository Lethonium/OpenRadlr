/**
 * A farmstead: farmhouse, gambrel barn, grain silos, an open machine shed
 * with a tractor and a solar slab, round bales, a garden fence and a gravel
 * yard. Local frame: the yard (58 x 46 m) centred near the origin, the front
 * and the gate toward +z. Winter whitens the roofs and heaps snow in the yard.
 * Restyled from the reference farmstead; the house is `house.js`'s, in the `style` the farm's region gives
 * (the season only whitens roofs and recolours the yard).
 */
import { box, colour, cylinder, deepFreeze, ico, rod } from "../geom.js";
import { defineBuilding } from "./building.js";
import { bales, barn, shed, silo, tractor } from "./farmBuildings.js";
import { HOUSE_STYLES, houseGeometry } from "./house.js";
import { place } from "./shapes.js";

const YARD = Object.freeze({ width: 58, depth: 46, centre: -2 });

const PALETTE = deepFreeze({
  spring: { barn: "#9c3b2e", trim: "#efe9df", roof: "#585d63", yard: "#a49b8b", silo: "#d4d8dc", tractor: "#3d7a3a", wrap: "#eeeeea", flowers: ["#ff8aa0", "#ffd23f", "#b9a0ff", "#ffffff"] },
  summer: { barn: "#d9c3a0", trim: "#7a5a3c", roof: "#b25e3d", yard: "#c2b49a", silo: "#e2e2dc", tractor: "#b8372b", wrap: "hay" },
  autumn: { barn: "#5b4331", trim: "#e7dfcf", roof: "#47433f", yard: "#9a8f7f", silo: "#c9cdd1", tractor: "#3d7a3a", wrap: "hay", pumpkins: ["#f28a1e", "#e8741a", "#f5a524"] },
  winter: { barn: "#8e3a2f", trim: "#f2efe8", roof: "#eef3f7", yard: "#d9dde2", silo: "#d4d8dc", tractor: "#2f5f9e", wrap: "#2f3b31", snowy: true },
});
const SILOS = Object.freeze([[23.5, -14, 2.5, 14], [23.5, -8, 2, 11.5], [23.5, -19.6, 1.8, 9.5]]);
const HOUSE_AT = Object.freeze([-17, 0, 9]);
const BARN_AT = Object.freeze([9, 0, -6]);

export const farmstead = defineBuilding(
  { id: "farmstead", name: "Farmstead", description: "A farmhouse, gambrel barn, silos, machine shed with a tractor, bales and a garden fence on a gravel yard.", options: { style: { type: "select", values: HOUSE_STYLES, default: "cottage" }, silos: { type: "range", min: 0, max: 3, step: 1, default: 2 }, solar: { type: "bool", default: true } } }, // i18n-ok
  ({ season, detail, dice, style = "cottage", silos = 2, solar = true }) => {
    const palette = PALETTE[season] ?? PALETTE.summer;
    const snowy = Boolean(palette.snowy);
    const { pick, range } = dice;
    const house = houseGeometry({ style, season, detail, big: true, dice });
    const barnParts = barn(palette, { snowy, detail });
    const near = [box(YARD.width, 0.2, YARD.depth, colour(palette.yard), 0, -0.02, YARD.centre)];
    const far = [];
    const glows = [];
    place(house.near, ...HOUSE_AT);
    place(house.far, ...HOUSE_AT);
    place(house.glows, ...HOUSE_AT);
    near.push(...house.near);
    far.push(...house.far);
    glows.push(...house.glows);
    near.push(...place(barnParts.near, ...BARN_AT));
    far.push(...place(barnParts.far, ...BARN_AT));
    glows.push(...place(barnParts.glows, ...BARN_AT));
    for (const [x, z, radius, height] of SILOS.slice(0, Math.min(silos, 3))) {
      const one = silo(x, z, radius, height, palette, detail);
      near.push(...one.near);
      far.push(...one.far);
    }
    if (silos) near.push(rod([23.5, 14.3, -14], [16.2, 9.6, -10], 0.18, colour("#9aa1a8"), 5, true));
    near.push(...shed(-15, -15, palette, { solar, snowy }));
    near.push(...tractor(-18, -15.5, -Math.PI / 2, palette.tractor));
    near.push(...bales(-27.5, -5, palette.wrap, 3));
    if (season === "summer" || season === "autumn") near.push(...bales(-9, -24.5, "hay", 2));
    near.push(box(0.1, 1.1, 0.1, colour("#5e4330"), 4, 0.55, 21), box(0.35, 0.3, 0.55, colour("#2f5f9e"), 4, 1.2, 21));
    if (detail) {
      for (let x = -25; x <= -9; x += 1.1) near.push(box(0.08, 0.9, 0.05, colour("#efeae0"), x, 0.45, 17.5));
      near.push(box(16, 0.08, 0.04, colour("#efeae0"), -17, 0.7, 17.45), box(3, 0.6, 0.9, colour("#8d949b"), 27, 0.3, 10));
      for (let i = 0; i < 12; i += 1) {
        const wood = colour(pick(["#8a6a4a", "#7a5a3c", "#9a7a55"]));
        near.push(cylinder(0.16, 0.16, 1.1, 6, wood).rotateX(Math.PI / 2).translate(-27.5 + (i % 6) * 0.34, 0.18 + Math.floor(i / 6) * 0.3, 4.5));
      }
      for (const [i, tone] of (palette.flowers ?? palette.pumpkins ?? []).entries()) near.push(ico(0.22 + (palette.pumpkins ? 0.1 : 0), 0, colour(tone), -24 + i * 3.2 + range(-0.5, 0.5), 0.3, range(15.8, 17)));
      if (snowy) for (let i = 0; i < 6; i += 1) near.push(ico(range(0.9, 1.5), 0, colour("#f4f7fb"), range(-26, 26), 0.1, range(-22, 18)).scale(1, 0.35, 1));
    }
    return { near, far, glows, width: YARD.width, depth: YARD.depth, eaves: house.eaves, door: { x: HOUSE_AT[0] + house.door.x, y: house.door.y, z: HOUSE_AT[2] + house.door.z } };
  },
);
