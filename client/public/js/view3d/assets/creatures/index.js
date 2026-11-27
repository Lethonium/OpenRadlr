/**
 * The island's animals by id: each is a creature-contract asset (`{meta, parts({season, detail, seed, own}) ->
 * {body, limbs, speed, size}, create(opts)}`). The fauna layer instances `parts`; the workbench shows `create`.
 */
import { bird } from "./bird.js";
import { butterfly } from "./butterfly.js";
import { chicken } from "./chicken.js";
import { cow } from "./cow.js";
import { deer } from "./deer.js";
import { dolphin } from "./dolphin.js";
import { fox } from "./fox.js";
import { horse } from "./horse.js";
import { pig } from "./pig.js";
import { rabbit } from "./rabbit.js";
import { sheep } from "./sheep.js";

export const CREATURES = Object.freeze({ cow, sheep, horse, pig, chicken, deer, rabbit, fox, bird, butterfly, dolphin });
