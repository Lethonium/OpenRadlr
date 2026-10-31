// The top bar's View popover: camera, layout, 3D/2D and time of day, built
// from `viewControls`. A pick applies at once (`onPick(kind, id)`) and the
// popover stays open until a tap outside, the button again, or Esc (it sits
// on the panel stack). Anchored under the button, a bottom sheet when narrow:
// `data-sheet` on root tells the CSS which.
import { t } from "../i18n/i18n.js";

// Small static drawings of where each camera sits (no live preview).
const BIKE = `<circle cx="22" cy="25" r="4.5" /><circle cx="35" cy="25" r="4.5" /><path d="M22 25l5-8h6l2 8M27 17l-1.5-3" /><circle cx="29" cy="10" r="2.2" />`;
const LENS = (x, y) => `<rect class="cam" x="${x - 3}" y="${y - 2.5}" width="6" height="5" rx="1" />`;
const SIGHT = (x1, y1, x2, y2) => `<path class="sight" d="M${x1} ${y1}L${x2} ${y2}" />`;
const svg = (body) => `<svg viewBox="0 0 48 32" aria-hidden="true">${body}</svg>`;
const ROOM = `<rect x="3" y="3" width="42" height="26" rx="3" /><circle cx="15" cy="20" r="2" /><circle cx="24" cy="20" r="2" /><circle cx="33" cy="20" r="2" />`;
const CAMERA_ART = {
  chase: svg(BIKE + SIGHT(9, 12, 22, 18) + LENS(6, 11)),
  close: svg(BIKE + SIGHT(15, 15, 22, 18) + LENS(12, 14)),
  drone: svg(BIKE + SIGHT(10, 6, 24, 16) + LENS(7, 4)),
  side: svg(BIKE + SIGHT(28, 4, 28, 13) + LENS(28, 3)),
  seat: svg(BIKE + SIGHT(9, 14, 22, 18) + LENS(6, 13)),
  wide: svg(ROOM + LENS(24, 9)),
  coach: svg(ROOM.replace(`<circle cx="24" cy="20" r="2" />`, "") + `<circle cx="24" cy="10" r="2.5" />` + LENS(24, 25)),
};

const ROWS = [
  { kind: "camera", heading: "viewPopover.camera", items: (c) => c.cameras },
  { kind: "layout", heading: "viewPopover.layout", items: (c) => c.layouts ?? [] },
  { kind: "mode", heading: "viewPopover.mode", items: (c) => c.modes },
  { kind: "time", heading: "drawer.timeOfDay", items: (c) => (c.showTime ? c.times : []) },
];

export function createViewPopover({
  root, button, controls, stack, matchNarrow, onPick, selected = () => ({}), doc = document,
}) {
  let removePanel = null;
  const options = [];
  const rows = {};

  function build() {
    const sections = [];
    for (const row of ROWS) {
      const items = row.items(controls);
      if (items.length === 0) continue;
      const section = doc.createElement("section");
      section.className = `view-row view-row-${row.kind}`;
      const heading = doc.createElement("h3");
      heading.textContent = t(row.heading);
      const group = doc.createElement("div");
      group.className = "view-options";
      group.setAttribute("role", "group");
      group.setAttribute("aria-label", t(row.heading));
      for (const item of items) {
        const option = doc.createElement("button");
        option.type = "button";
        option.className = "view-option";
        option.dataset.kind = row.kind;
        option.dataset.id = item.id;
        option.setAttribute("aria-pressed", "false");
        const label = doc.createElement("span");
        label.textContent = item.label;
        if (CAMERA_ART[item.id] && row.kind === "camera") {
          const art = doc.createElement("span");
          art.className = "view-art";
          art.innerHTML = CAMERA_ART[item.id];
          option.append(art);
        }
        option.append(label);
        option.addEventListener("click", () => pick(row.kind, item.id));
        group.append(option);
        options.push(option);
      }
      section.append(heading, group);
      sections.push(section);
      rows[row.kind] = section;
    }
    root.replaceChildren(...sections);
  }

  function render() {
    const current = selected();
    for (const option of options) {
      option.setAttribute("aria-pressed", String(current[option.dataset.kind] === option.dataset.id));
    }
    // Camera and time of day belong to the 3D view; a camera not offered here
    // (the workout's gym camera) cannot be changed, so the row goes.
    const flat = current.mode === "2d";
    const offered = controls.cameras.some((camera) => camera.id === current.camera);
    if (rows.camera) rows.camera.hidden = (flat && controls.modes.length > 0) || !offered;
    if (rows.time) rows.time.hidden = flat;
    for (const option of options) {
      if (option.dataset.kind === "mode" && option.dataset.id === "3d") option.disabled = current.has3d === false;
    }
    root.setAttribute("data-sheet", String(Boolean(matchNarrow.matches)));
  }

  function pick(kind, id) {
    onPick(kind, id);
    if (removePanel) render();
  }

  function onOutside(event) {
    if (root.contains(event.target) || button.contains(event.target)) return;
    close();
  }

  function open() {
    if (removePanel) return;
    removePanel = stack.push({ close });
    render();
    root.hidden = false;
    button.setAttribute("aria-expanded", "true");
    doc.addEventListener("pointerdown", onOutside);
  }

  function close() {
    if (!removePanel) return;
    removePanel();
    removePanel = null;
    if (root.contains(doc.activeElement)) button.focus();
    root.hidden = true;
    button.setAttribute("aria-expanded", "false");
    doc.removeEventListener("pointerdown", onOutside);
  }

  const toggle = () => (removePanel ? close() : open());
  const onNarrow = () => removePanel && render();

  build();
  root.hidden = true;
  button.setAttribute("aria-expanded", "false");
  button.addEventListener("click", toggle);
  matchNarrow.addEventListener("change", onNarrow);

  return {
    open,
    close,
    /** Re-reads the current choices (after a key changed one). */
    refresh() { if (removePanel) render(); },
    get isOpen() { return Boolean(removePanel); },
    dispose() {
      close();
      button.removeEventListener("click", toggle);
      matchNarrow.removeEventListener("change", onNarrow);
      root.replaceChildren();
    },
  };
}
