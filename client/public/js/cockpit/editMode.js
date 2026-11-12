/**
 * Edit mode of the cockpit: choose, reorder and resize tiles, built for a
 * phone's touchscreen (pointer events, 44 px targets, no library).
 *
 * Outside edit mode no handles or buttons exist. The layout is saved on every
 * change, so leaving the page never loses an edit; "Done" just leaves the mode.
 */
import { t } from "../i18n/i18n.js";
import { addTile, hiddenTiles, moveTile, removeTile, resetLayout, resizeTile, saveLayout } from "./layout.js";
import { tileById } from "./tiles.js";

const EDGE = 70; // px from the top or bottom edge where dragging scrolls the page
const SCROLL_STEP = 16;

const distance = (from, low, high) => Math.max(low - from, 0, from - high);

/** The index of the rectangle under (x, y), else the nearest one; -1 without rectangles. */
export function dropIndex(rects, x, y) {
  let best = -1;
  let bestDistance = Infinity;
  rects.forEach((rect, index) => {
    const d = Math.hypot(distance(x, rect.left, rect.right), distance(y, rect.top, rect.bottom));
    if (d < bestDistance) {
      best = index;
      bestDistance = d;
    }
  });
  return best;
}

export class EditMode {
  /**
   * @param {{ root: Element, layout: Array, storage: Storage, onChange: (layout: Array, editing: boolean) => void,
   *   confirm?: (text: string) => boolean }} options
   * `root` holds the tiles section (`#cockpit-tiles`), the controls `#cockpit-edit`, `#cockpit-add`,
   * `#cockpit-reset`, `#cockpit-done`, the toolbar `#cockpit-toolbar` and the sheet `#cockpit-sheet`.
   */
  constructor({ root, layout, storage, onChange, confirm = (text) => globalThis.confirm(text) }) {
    this.root = root;
    this.layout = layout;
    this.storage = storage;
    this.onChange = onChange;
    this.confirm = confirm;
    this.editing = false;
    const $ = (id) => root.querySelector(`#${id}`);
    this.tiles = $("cockpit-tiles");
    this.sheet = $("cockpit-sheet");
    this.toolbar = $("cockpit-toolbar");
    this.editButton = $("cockpit-edit");
    $("cockpit-edit").addEventListener("click", () => this.#setEditing(!this.editing));
    $("cockpit-done").addEventListener("click", () => this.#setEditing(false));
    $("cockpit-add").addEventListener("click", () => this.#openSheet());
    $("cockpit-reset").addEventListener("click", () => this.#reset());
    $("cockpit-sheet-close").addEventListener("click", () => this.#closeSheet());
    this.#setEditing(false);
  }

  /** Adds the edit controls to the element of the tile at `index` (call only while editing). */
  decorate(element, index) {
    const doc = element.ownerDocument;
    const entry = this.layout[index];
    const tools = doc.createElement("div");
    tools.className = "tile-tools";
    const handle = this.#button(doc, "tile-handle", "⠿", t("cockpit.move"));
    handle.addEventListener("pointerdown", (event) => this.#startDrag(event, element, index));
    tools.append(handle);
    if (tileById(entry.id).sizes.length > 1) {
      const size = this.#button(doc, "tile-resize", "⤢", t("cockpit.resize"));
      size.addEventListener("click", () => this.#change(resizeTile(this.layout, index)));
      tools.append(size);
    }
    const remove = this.#button(doc, "tile-remove", "✕", t("cockpit.remove"));
    remove.addEventListener("click", () => this.#change(removeTile(this.layout, index)));
    tools.append(remove);
    element.prepend(tools);
  }

  #button(doc, className, glyph, label) {
    const button = doc.createElement("button");
    button.type = "button";
    button.className = className;
    button.textContent = glyph;
    button.title = label;
    button.setAttribute("aria-label", label);
    return button;
  }

  #setEditing(editing) {
    this.editing = editing;
    this.toolbar.hidden = !editing;
    this.editButton.hidden = editing;
    this.tiles.classList.toggle("editing", editing);
    if (!editing) this.#closeSheet();
    this.onChange(this.layout, editing);
  }

  #change(layout) {
    this.layout = layout;
    saveLayout(this.storage, layout);
    this.onChange(layout, this.editing);
    if (!this.sheet.hidden) this.#fillSheet();
  }

  #reset() {
    if (this.confirm(t("cockpit.resetConfirm"))) this.#change(resetLayout());
  }

  #openSheet() {
    this.#fillSheet();
    this.sheet.hidden = false;
  }

  #closeSheet() {
    this.sheet.hidden = true;
  }

  #fillSheet() {
    const list = this.sheet.querySelector("#cockpit-sheet-list");
    const doc = this.sheet.ownerDocument;
    const hidden = hiddenTiles(this.layout);
    list.replaceChildren(
      ...hidden.map((tile) => {
        const item = this.#button(doc, "sheet-item", t(tile.labelKey), t(tile.labelKey));
        item.addEventListener("click", () => {
          this.#change(addTile(this.layout, tile.id));
          if (hiddenTiles(this.layout).length === 0) this.#closeSheet();
        });
        return item;
      }),
    );
    if (hidden.length === 0) this.#closeSheet();
  }

  /** Drags the tile by its handle; the slot under the pointer lights up, releasing moves it there. */
  #startDrag(event, element, from) {
    if (event.button > 0) return;
    event.preventDefault();
    const handle = event.currentTarget;
    const view = element.ownerDocument.defaultView;
    const elements = [...this.tiles.children];
    // Page coordinates measured once: the dragged tile moves, the others don't, and scrolling doesn't change them.
    const rects = elements.map((el) => {
      const r = el.getBoundingClientRect();
      return { left: r.left + view.scrollX, top: r.top + view.scrollY, right: r.right + view.scrollX, bottom: r.bottom + view.scrollY };
    });
    const startX = event.clientX + view.scrollX;
    const startY = event.clientY + view.scrollY;
    let target = from;
    handle.setPointerCapture?.(event.pointerId);
    element.classList.add("tile-dragging");

    const move = (e) => {
      if (e.clientY < EDGE) view.scrollBy(0, -SCROLL_STEP);
      else if (e.clientY > view.innerHeight - EDGE) view.scrollBy(0, SCROLL_STEP);
      const x = e.clientX + view.scrollX;
      const y = e.clientY + view.scrollY;
      element.style.transform = `translate(${x - startX}px, ${y - startY}px)`;
      const next = dropIndex(rects, x, y);
      if (next !== target) {
        elements[target]?.classList.remove("tile-drop");
        target = next;
        if (target !== from) elements[target]?.classList.add("tile-drop");
      }
    };
    const finish = (e) => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", finish);
      handle.removeEventListener("pointercancel", finish);
      handle.releasePointerCapture?.(e.pointerId);
      element.classList.remove("tile-dragging");
      element.style.transform = "";
      elements[target]?.classList.remove("tile-drop");
      if (e.type === "pointerup" && target !== from) this.#change(moveTile(this.layout, from, target));
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", finish);
    handle.addEventListener("pointercancel", finish);
  }
}
