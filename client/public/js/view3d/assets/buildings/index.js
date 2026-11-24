/**
 * The building kit by id. A building is `{meta, parts(options) -> {near, far,
 * glows, width, depth, eaves, door}, create(options)}`: vertex-coloured
 * geometry in local space, ground at y = 0, door facing +z. The world merges
 * the parts per town or farm; `create` is for the workbench.
 */
import { cathedral } from "./cathedral.js";
import { farmstead } from "./farmstead.js";
import { house } from "./house.js";
import { streetLamp } from "./streetLamp.js";

export { HOUSE_STYLES } from "./house.js";

export const BUILDINGS = Object.freeze({ cathedral, farmstead, house, streetLamp });
