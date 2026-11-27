/**
 * The rider assets on the workbench by id: the rigged rider alone, the cyclist on its bike, the classic cyclist and the baked statue. All are
 * `{meta, create(options) -> {object, update(dt, t), dispose()}}`.
 */
import * as classicCyclist from "./classicCyclist.js";
import * as cyclist from "./cyclist.js";
import * as rider from "./rider.js";
import * as statue from "./statue.js";

export const RIDERS = Object.freeze({
  rider: Object.freeze({ meta: rider.meta, create: rider.create }),
  cyclist: Object.freeze({ meta: cyclist.meta, create: cyclist.create }),
  "classic-cyclist": Object.freeze({ meta: classicCyclist.meta, create: classicCyclist.create }),
  statue: Object.freeze({ meta: statue.meta, create: statue.create }),
});
