/**
 * The plant kit by id: every plant and prop id the world planner emits that
 * is a plant (`NATURE`), and the crop fields (`CROPS`). A plant is
 * `{meta, parts({season, detail, uniforms, own}) -> {near, far}, create(opts)}`.
 */
import { almond } from "./almond.js";
import { birch, broadleaf, cypress, poplar } from "./broadleaf.js";
import { bush } from "./bush.js";
import { hayBale } from "./hayBale.js";
import { lavender } from "./lavender.js";
import { olive } from "./olive.js";
import { pine } from "./pine.js";
import { rock } from "./rock.js";
import { umbrellaPine } from "./umbrellaPine.js";

export { CROPS } from "./crops.js";

export const NATURE = Object.freeze({ almond, birch, broadleaf, bush, cypress, hayBale, lavender, olive, pine, poplar, rock, umbrellaPine });
