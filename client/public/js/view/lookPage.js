/**
 * The Profile dialog's Look page (#25): the rider look's choices grouped as Body, Kit, Head and Bike, each piece open
 * or locked behind its achievement. `lookPageModel` is pure; `renderLookPage` writes it into a container.
 */
import { t } from "../i18n/i18n.js";
import { ACHIEVEMENTS } from "../profile/achievements.js";
import { GOLD, LOOK_SLOTS, isUnlocked, piecesOf } from "../profile/riderLook.js";
import { RIDER_SKINS } from "../view3d/assets/riders/look.js";

export const LOOK_GROUPS = ["body", "kit", "head", "bike"];
const SECRET = new Set(ACHIEVEMENTS.filter((a) => a.secret).map((a) => a.id));
const CM_PER_INCH = 2.54;

/** "1.80 m", or 5′11″ in imperial units. */
export function heightLabel(cm, units = "metric") {
  if (units !== "imperial") return `${(cm / 100).toFixed(2)} m`;
  const inches = Math.round(cm / CM_PER_INCH);
  return `${Math.floor(inches / 12)}′${inches % 12}″`;
}

/** A piece's name, as the Look page shows it (the one earned colour, gold, has its own). */
export const pieceName = (slot, id) => (id === GOLD ? t("look.option.frame.gold") : t(`look.option.${slot}.${id}`));

/** "Unlocks for your look: Lemon helmet", or "" for an achievement that unlocks no piece. */
export function unlockLine(achievementId) {
  const pieces = piecesOf(achievementId);
  return pieces.length ? t("look.unlocks", { pieces: pieces.map(({ slot, id }) => pieceName(slot, id)).join(", ") }) : "";
}

/** What a locked piece says: the achievement that unlocks it, or that it is a secret one. */
const lockHint = (unlock) => (SECRET.has(unlock) ? t("look.unlockSecret") : t("look.unlock", { name: t(`achievement.${unlock}.name`) }));

/**
 * The page's groups and slots for a choice.
 * @param {Record<string, string | number>} choice a full choice (`sanitizeLook`)
 * @param {Record<string, number>} earned the earned achievements
 * @param {"metric" | "imperial"} [units]
 */
export function lookPageModel(choice, earned, units = "metric") {
  return LOOK_GROUPS.map((group) => ({
    id: group,
    title: t(`look.group.${group}`),
    slots: Object.entries(LOOK_SLOTS)
      .filter(([, slot]) => slot.group === group)
      .map(([id, slot]) => {
        const label = t(`look.slot.${id}`);
        if (slot.range) return { id, label, kind: "range", min: slot.range[0], max: slot.range[1], value: choice[id], text: heightLabel(choice[id], units), units };
        const swatches = slot.colour || id === "skin";
        return {
          id,
          label,
          kind: swatches ? "colour" : "chips",
          options: slot.options.map((option, index) => {
            const locked = !isUnlocked(option, earned);
            return {
              id: option.id,
              label: swatches ? t(id === "skin" ? `look.option.skin.${option.id}` : "look.colour", { n: index + 1 }) : t(`look.option.${id}.${option.id}`),
              colour: swatches ? (RIDER_SKINS[option.id] ?? option.id) : null,
              selected: choice[id] === option.id,
              locked,
              hint: locked ? lockHint(option.unlock) : "",
            };
          }),
        };
      }),
  }));
}

/**
 * Writes the model into `container` (replacing what was there); `onPick(slot, value)` gets every choice made.
 * `focus` (`{slot, value}`, the choice just made) puts the keyboard focus back on its control in the new page: the
 * picked chip or swatch, or the slider itself, so arrow keys keep moving it.
 * @param {HTMLElement} container
 * @param {ReturnType<typeof lookPageModel>} model
 * @param {(slot: string, value: string | number) => void} onPick
 * @param {{focus?: {slot: string, value: string | number} | null}} [options]
 */
export function renderLookPage(container, model, onPick, { focus = null } = {}) {
  const doc = container.ownerDocument;
  const el = (tag, className, text) => {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  let focusTarget = null;
  const groups = model.map((group) => {
    const section = el("section", "look-group");
    section.append(el("h3", "", group.title));
    for (const slot of group.slots) {
      const row = el("div", "look-slot");
      const name = el("span", "look-slot-label", slot.label);
      name.id = `look-slot-${slot.id}`;
      row.append(name);
      if (slot.kind === "range") {
        const input = el("input");
        Object.assign(input, { type: "range", min: String(slot.min), max: String(slot.max), step: "1", value: String(slot.value) });
        input.setAttribute("aria-labelledby", name.id);
        input.dataset.slot = slot.id;
        if (focus?.slot === slot.id) focusTarget = input;
        const output = el("output", "look-range-value", slot.text);
        input.addEventListener("input", () => (output.textContent = heightLabel(Number(input.value), slot.units)));
        input.addEventListener("change", () => onPick(slot.id, Number(input.value)));
        row.append(input, output);
      } else {
        const options = el("div", slot.kind === "colour" ? "look-swatches" : "look-chips");
        // A tap on a locked piece says what unlocks it, here under the row (touch has no tooltips).
        const note = el("p", "look-note");
        note.setAttribute("aria-live", "polite");
        note.hidden = true;
        options.setAttribute("role", "group");
        options.setAttribute("aria-labelledby", name.id);
        for (const option of slot.options) {
          const button = el("button", slot.kind === "colour" ? "look-swatch" : "look-chip", slot.kind === "colour" ? "" : option.label);
          button.type = "button";
          Object.assign(button.dataset, { slot: slot.id, option: option.id });
          if (focus?.slot === slot.id && focus.value === option.id) focusTarget = button;
          button.setAttribute("aria-pressed", String(option.selected));
          if (slot.kind === "colour") {
            button.style.setProperty("--swatch", option.colour);
            button.setAttribute("aria-label", option.label);
          }
          if (option.locked) {
            button.setAttribute("aria-disabled", "true");
            button.classList.add("locked");
            button.title = option.hint;
            button.setAttribute("aria-label", `${option.label}: ${option.hint}`);
            button.addEventListener("click", () => {
              note.textContent = `${option.label}: ${option.hint}`;
              note.hidden = false;
            });
          } else button.addEventListener("click", () => onPick(slot.id, option.id));
          options.append(button);
        }
        row.append(options, note);
      }
      section.append(row);
    }
    return section;
  });
  container.replaceChildren(...groups);
  focusTarget?.focus();
}
