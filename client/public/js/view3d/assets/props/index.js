/**
 * The verge's props by id: each is a plant-contract asset (`{meta, parts({season, detail, uniforms, own}) ->
 * {near, far}, create(opts)}`) with one near part and no far twin, so the roadside layer instances them
 * beside the clumps. The landmark props (balloon, boat) live in `BUILDINGS`.
 */
import { bench } from "./bench.js";
import { boardwalk } from "./boardwalk.js";
import { beehive } from "./beehive.js";
import { cairn } from "./cairn.js";
import { cart } from "./cart.js";
import { logPile } from "./logPile.js";
import { mailbox } from "./mailbox.js";
import { picketFence } from "./picketFence.js";
import { snowPole } from "./snowPole.js";
import { stoneWall } from "./stoneWall.js";

export const PROPS = Object.freeze({ beehive, bench, boardwalk, cairn, cart, logPile, mailbox, picketFence, snowPole, stoneWall });
