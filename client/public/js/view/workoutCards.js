/**
 * The workout cards of the start menu: a radio group with a block strip and,
 * on the selected card, one chip per figure. Pure helpers decide what to show;
 * `renderWorkoutCards` writes it with textContent only.
 */

import { t } from "../i18n/i18n.js";
import { planDuration } from "../workout/plan.js";
import { VENUES } from "../workout/venues.js";

/** One colour per exercise: strip segments and figure chips. */
export const EXERCISE_COLORS = Object.freeze({
  squats: "#ff7a1a",
  situps: "#3fa7d6",
  pushups: "#e4572e",
  jumping_jacks: "#f2c14e",
  plank: "#59a96a",
  burpees: "#a06cd5",
});

/** The translated tag per venue category (literal keys, so the key sweep sees them). */
const categoryTag = (category) =>
  ({ fullBody: () => t("workout.category.fullBody"), hiit: () => t("workout.category.hiit"), core: () => t("workout.category.core"), strength: () => t("workout.category.strength") })[category]?.() ?? "";

/** The blocks of a plan as fractions of its length (the get-ready rest is not part of a stored plan). */
export function blockStrip(plan) {
  const total = planDuration(plan);
  return plan.blocks.map((block) => ({
    fraction: block.seconds / total,
    kind: block.kind,
    exercise: block.kind === "exercise" ? block.exercise : null,
    label: block.label,
    seconds: block.seconds,
  }));
}

/** What a card shows; `cafeName` comes from the map data (empty until it is loaded). */
export function workoutCard(plan, { cafeName = "" } = {}) {
  const category = VENUES[plan.venue]?.category;
  const exercises = [...new Set(plan.blocks.filter((b) => b.kind === "exercise").map((b) => b.exercise))];
  const labelOf = (exercise) => plan.blocks.find((b) => b.exercise === exercise).label;
  return {
    id: plan.id,
    name: plan.name,
    minutes: Math.round(planDuration(plan) / 60),
    tag: categoryTag(category),
    cafe: cafeName ?? "",
    description: plan.description,
    strip: blockStrip(plan),
    figures: exercises.map((exercise) => ({ exercise, label: labelOf(exercise), color: EXERCISE_COLORS[exercise] })),
  };
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * Draws the cards into `container`. The selected id falls back to the first plan
 * when it is unknown (an old saved profile).
 * @param {HTMLElement} container
 * @param {object[]} plans
 * @param {{selectedId: string | null, cafeNames?: Map<string, string>, figureIndex?: number | null,
 *   onSelect: (id: string) => void, onFigure: (id: string, index: number | null) => void}} options
 */
export function renderWorkoutCards(container, plans, { selectedId, cafeNames = new Map(), figureIndex = null, onSelect, onFigure }) {
  const current = plans.some((plan) => plan.id === selectedId) ? selectedId : plans[0]?.id;
  const hadFocus = container.contains(container.ownerDocument?.activeElement ?? null);
  let focusTarget = null;
  const cards = plans.map((plan, index) => {
    const card = workoutCard(plan, { cafeName: cafeNames.get(plan.venue) ?? "" });
    const selected = card.id === current;
    const wrapper = element("div", selected ? "workout-card selected" : "workout-card");
    const radio = element("div", "workout-card-body");
    radio.setAttribute("role", "radio");
    radio.setAttribute("aria-checked", String(selected));
    radio.tabIndex = selected ? 0 : -1;
    if (selected) focusTarget = radio;
    const head = element("span", "route-head");
    head.append(element("strong", "route-name", card.name), element("span", "route-tag", card.tag));
    const facts = [t("workout.minutes", { n: card.minutes }), card.cafe].filter(Boolean).join(" · ");
    const strip = element("div", "block-strip");
    card.strip.forEach((segment, i) => {
      const text = t("workout.summary.seconds", { label: segment.label, s: segment.seconds });
      const part = element("div", segment.kind === "rest" ? "strip-segment rest" : "strip-segment");
      part.dataset.segment = String(i);
      part.style.flexGrow = String(segment.fraction);
      if (segment.exercise) part.style.background = EXERCISE_COLORS[segment.exercise];
      part.title = text;
      part.setAttribute("aria-label", text);
      part.addEventListener("click", () => {
        const hint = document.getElementById("workout-hint");
        if (hint) hint.textContent = text;
      });
      strip.append(part);
    });
    radio.append(head, element("span", "route-stats", facts), element("span", "route-description", card.description), strip);
    radio.addEventListener("click", () => onSelect(card.id));
    radio.addEventListener("keydown", (event) => {
      const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
      if (!step) return;
      event.preventDefault();
      onSelect(plans[(index + step + plans.length) % plans.length].id);
    });
    wrapper.append(radio);
    if (selected) {
      const chips = element("div", "figure-chips");
      chips.setAttribute("role", "group");
      chips.setAttribute("aria-label", t("workout.figures"));
      card.figures.forEach((figure, i) => {
        const chip = element("button", "figure-chip");
        chip.type = "button";
        chip.dataset.figure = String(i);
        chip.setAttribute("aria-pressed", String(figureIndex === i));
        const dot = element("span", "figure-dot");
        dot.style.background = figure.color;
        chip.append(dot, element("span", "figure-label", figure.label));
        chip.addEventListener("click", () => onFigure(card.id, figureIndex === i ? null : i));
        chips.append(chip);
      });
      wrapper.append(chips);
    }
    return wrapper;
  });
  container.replaceChildren(...cards);
  if (hadFocus) focusTarget?.focus();
}
