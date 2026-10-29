/** Ready-made bodyweight circuits. Built with createPlan so they are validated at load. */

import { t } from "../i18n/i18n.js";
import { createPlan } from "./plan.js";

/** A preset whose name and description follow the language (looked up when read). */
const preset = (spec, text) => Object.freeze({ ...createPlan(spec), get name() { return text.name(); }, get description() { return text.description(); } });

const rest = (seconds) => ({ kind: "rest", seconds });
const work = (exercise, seconds) => ({ kind: "exercise", exercise, seconds });

const FULL_BODY = ["squats", "situps", "pushups", "jumping_jacks", "plank", "burpees"];

export const PRESETS = Object.freeze([
  preset({ id: "full-body", name: "Full body", blocks: [1, 2].flatMap(() => FULL_BODY.flatMap((exercise) => [work(exercise, 40), rest(20)])) }, { name: () => t("workout.preset.fullBody.name"), description: () => t("workout.preset.fullBody.description") }), // i18n-ok (English id label; the UI translates by mode)
  preset(
    {
      id: "core",
      name: "Core", // i18n-ok (English id label; the UI translates by mode)
      blocks: [1, 2].flatMap(() => [
        work("situps", 45), rest(15),
        work("plank", 60), rest(30),
        work("pushups", 40), rest(50),
      ]),
    },
    { name: () => t("workout.preset.core.name"), description: () => t("workout.preset.core.description") },
  ),
  preset(
    { id: "tabata", name: "Tabata", blocks: Array.from({ length: 8 }, (_, i) => [work(i % 2 === 0 ? "squats" : "burpees", 20), rest(10)]).flat() }, // i18n-ok (English id label; the UI translates by mode)
    { name: () => t("workout.preset.tabata.name"), description: () => t("workout.preset.tabata.description") },
  ),
]);
