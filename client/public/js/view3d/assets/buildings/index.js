/**
 * The building kit by id. A building is `{meta, parts(options) -> {near, far,
 * glows, movers, width, depth, eaves, door}, create(options)}`: vertex-coloured
 * geometry in local space, ground at y = 0, door facing +z. The world merges
 * the parts per town or farm; `create` is for the workbench. The landmarks
 * (lighthouse, castle, sea arch, windmill, turbine, windpump, balloon, boat)
 * add `movers`: parts that turn about a pivot and axis, built round it.
 */
import { balloon } from "../props/balloon.js";
import { boat } from "../props/boat.js";
import { castle } from "./castle.js";
import { cathedral } from "./cathedral.js";
import { farmstead } from "./farmstead.js";
import { house } from "./house.js";
import { lighthouse } from "./lighthouse.js";
import { seaArch } from "./seaArch.js";
import { streetLamp } from "./streetLamp.js";
import { windmill } from "./windmill.js";
import { windpump } from "./windpump.js";
import { windTurbine } from "./windTurbine.js";

export { HOUSE_STYLES } from "./house.js";

export const BUILDINGS = Object.freeze({ balloon, boat, castle, cathedral, farmstead, house, lighthouse, seaArch, streetLamp, windmill, windpump, windTurbine });
