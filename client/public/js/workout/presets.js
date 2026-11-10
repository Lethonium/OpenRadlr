/** Ready-made bodyweight circuits. Built with createPlan so they are validated at load. */

import { t } from "../i18n/i18n.js";
import { createPlan } from "./plan.js";

/** A preset whose name and description follow the language (looked up when read). */
const preset = (spec, text) => Object.freeze({ ...createPlan(spec), get name() { return text.name(); }, get description() { return text.description(); } });

const rest = (seconds) => ({ kind: "rest", seconds });
const work = (exercise, seconds) => ({ kind: "exercise", exercise, seconds });

const FULL_BODY = ["squats", "situps", "pushups", "jumping_jacks", "plank", "burpees"];

export const PRESETS = Object.freeze([
  preset({ id: "full-body", name: "Full body", venue: "valley-cafe", blocks: [1, 2].flatMap(() => FULL_BODY.flatMap((exercise) => [work(exercise, 40), rest(20)])) }, { name: () => t("workout.preset.fullBody.name"), description: () => t("workout.preset.fullBody.description") }), // i18n-ok (English id label; the UI translates by mode)
  preset(
    {
      id: "core",
      venue: "forge-hut",
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
    { id: "tabata", name: "Tabata", venue: "hill-cafe", blocks: Array.from({ length: 8 }, (_, i) => [work(i % 2 === 0 ? "squats" : "burpees", 20), rest(10)]).flat() }, // i18n-ok (English id label; the UI translates by mode)
    { name: () => t("workout.preset.tabata.name"), description: () => t("workout.preset.tabata.description") },
  ),
  preset(
    { id: "sun-salutation", name: "Sun Salutation A", venue: "beach-cafe", blocks: [work("sun_salutation", 180), work("child_pose", 60)] }, // i18n-ok (English id label; the UI translates by mode)
    { name: () => t("workout.preset.sunSalutation.name"), description: () => t("workout.preset.sunSalutation.description") },
  ),
  preset(
    {
      id: "cool-down",
      venue: "beach-cafe",
      name: "Post-ride cool-down", // i18n-ok (English id label; the UI translates by mode)
      blocks: [work("forward_fold", 60), rest(10), work("low_lunge", 120), rest(10), work("pigeon", 120), rest(10), work("downward_dog", 60), rest(10), work("cobra", 45), rest(10), work("child_pose", 90)],
    },
    { name: () => t("workout.preset.coolDown.name"), description: () => t("workout.preset.coolDown.description") },
  ),
  preset(
    {
      id: "hip-flow",
      venue: "beach-cafe",
      name: "Hip and hamstring flow", // i18n-ok (English id label; the UI translates by mode)
      blocks: [work("sun_salutation", 72), rest(10), work("low_lunge", 120), rest(10), work("forward_fold", 60), rest(10), work("pigeon", 120), rest(10), work("downward_dog", 60), rest(10), work("low_lunge", 120), rest(10), work("pigeon", 120), rest(10), work("forward_fold", 60), rest(10), work("child_pose", 90)],
    },
    { name: () => t("workout.preset.hipFlow.name"), description: () => t("workout.preset.hipFlow.description") },
  ),
]);
