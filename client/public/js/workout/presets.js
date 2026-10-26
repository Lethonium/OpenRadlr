/** Ready-made bodyweight circuits. Built with createPlan so they are validated at load. */

import { createPlan } from "./plan.js";

const rest = (seconds) => ({ kind: "rest", seconds });
const work = (exercise, seconds) => ({ kind: "exercise", exercise, seconds });

const FULL_BODY = ["squats", "situps", "pushups", "jumping_jacks", "plank", "burpees"];

export const PRESETS = Object.freeze([
  createPlan({
    id: "full-body",
    name: "Full body",
    description: "Two rounds of six exercises, 40 s on and 20 s rest.",
    blocks: [1, 2].flatMap(() => FULL_BODY.flatMap((exercise) => [work(exercise, 40), rest(20)])),
  }),
  createPlan({
    id: "core",
    name: "Core",
    description: "Two rounds of sit-ups, plank and push-ups with longer rests.",
    blocks: [1, 2].flatMap(() => [
      work("situps", 45), rest(15),
      work("plank", 60), rest(30),
      work("pushups", 40), rest(50),
    ]),
  }),
  createPlan({
    id: "tabata",
    name: "Tabata",
    description: "Eight rounds of 20 s hard, 10 s rest, alternating squats and burpees.",
    blocks: Array.from({ length: 8 }, (_, i) => [work(i % 2 === 0 ? "squats" : "burpees", 20), rest(10)]).flat(),
  }),
]);
