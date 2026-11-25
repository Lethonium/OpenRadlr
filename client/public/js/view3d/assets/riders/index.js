/**
 * The rider assets on the workbench by id: the rigged rider alone and the cyclist on its bike. Both are
 * `{meta, create(options) -> {object, update(dt, t), dispose()}}`.
 */
import * as cyclist from "./cyclist.js";
import * as rider from "./rider.js";

export const RIDERS = Object.freeze({
  rider: Object.freeze({ meta: rider.meta, create: rider.create }),
  cyclist: Object.freeze({ meta: cyclist.meta, create: cyclist.create }),
});
