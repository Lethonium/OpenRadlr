/**
 * The verge's props by id: each is a plant-contract asset (`{meta, parts({season, detail, uniforms, own}) ->
 * {near, far}, create(opts)}`) with one near part and no far twin, so the roadside layer instances them
 * beside the clumps. The landmark props (balloon, boat) live in `BUILDINGS`.
 */
import * as bikeCafe from "../buildings/bikeCafe.js";
import * as spinStudio from "../buildings/spinStudio.js";
import { bench } from "./bench.js";
import { boardwalk } from "./boardwalk.js";
import { beehive } from "./beehive.js";
import { cairn } from "./cairn.js";
import { cart } from "./cart.js";
import * as bridge from "./bridge.js";
import * as lemon from "./lemon.js";
import { logPile } from "./logPile.js";
import { mailbox } from "./mailbox.js";
import * as outdoorGym from "./outdoorGym.js";
import * as roadPost from "./roadPost.js";
import * as routeArch from "./routeArch.js";
import { villageSign, warningSign } from "./roadSigns.js";
import { picketFence } from "./picketFence.js";
import { snowPole } from "./snowPole.js";
import { stoneWall } from "./stoneWall.js";

export const PROPS = Object.freeze({ beehive, bench, boardwalk, cairn, cart, logPile, mailbox, picketFence, snowPole, stoneWall });

/** Workbench-only props: not on the verge, drawn by their own layers (`{meta, create}`). */
export const FLOATERS = Object.freeze({
  "bike-cafe": Object.freeze({ meta: bikeCafe.meta, create: bikeCafe.create }),
  "spin-studio": Object.freeze({ meta: spinStudio.meta, create: spinStudio.create }),
  bridge: Object.freeze({ meta: bridge.meta, create: bridge.create }),
  "road-post": Object.freeze({ meta: roadPost.meta, create: roadPost.create }),
  lemon: Object.freeze({ meta: lemon.meta, create: lemon.create }),
  "outdoor-gym": Object.freeze({ meta: outdoorGym.meta, create: outdoorGym.create }),
  "route-arch": Object.freeze({ meta: routeArch.meta, create: routeArch.create }),
  "warning-sign": warningSign,
  "village-sign": villageSign,
});
