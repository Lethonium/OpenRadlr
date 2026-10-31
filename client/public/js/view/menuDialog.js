// The in-game menu dialog: open/close, page navigation, confirm step, focus
// handling. No markup or user-visible strings here; the markup (Task 8)
// provides these hooks inside `root`:
//   [data-menu-page="<id>"]   page containers (hidden unless active)
//   [data-menu-nav="<id>"]    page list entries (click opens the page)
//   [data-menu-backdrop]      dimmed backdrop (click on it closes)
//   [data-menu-back]          back arrow on a phone's page screen
//   [data-menu-close]         close button
// State is exposed on root for CSS: `hidden`, `aria-modal`, `data-screen`
// ("list" | "page"), `data-page` (open page id) and `data-confirm`.
// `onChange({ open, confirming })` reports every open/close and confirm step,
// however it happened (Esc, backdrop, close button), so callers can sync
// their own state (the opener's aria-expanded, the confirm card).
import { createMenuNav } from "./menuPages.js";

const FOCUSABLE = "button, input, select, textarea, a[href]";

function defaultFocusables(root) {
  return () => [...root.querySelectorAll(FOCUSABLE)]
    .filter((el) => !el.disabled && !el.closest?.("[hidden]") && !el.hidden);
}

export function createMenuDialog({
  root, stack, matchNarrow, onPage = () => {}, onChange = () => {}, pages = [],
  getActiveElement = () => document.activeElement,
  focusables = defaultFocusables(root),
}) {
  let pageIds = [...pages];
  const nav = createMenuNav(pageIds);
  const pageEls = [...root.querySelectorAll("[data-menu-page]")];
  const navEls = [...root.querySelectorAll("[data-menu-nav]")];
  const backdrop = root.querySelector("[data-menu-backdrop]");
  const backEl = root.querySelector("[data-menu-back]");
  const closeEl = root.querySelector("[data-menu-close]");
  let open = false;
  let confirming = false;
  let opener = null;
  let removeDialog = null;
  let removeConfirm = null;
  let reported = null;

  const narrow = () => !!matchNarrow.matches;
  const currentPage = () => (!open ? null : narrow() ? nav.page : (nav.page ?? pageIds[0] ?? null));

  function render() {
    const page = currentPage();
    root.hidden = !open;
    root.setAttribute("aria-modal", "true");
    root.setAttribute("data-screen", page === null ? "list" : "page");
    if (page === null) root.removeAttribute("data-page"); else root.setAttribute("data-page", page);
    for (const el of pageEls) el.hidden = el.dataset.menuPage !== page || !pageIds.includes(page);
    for (const el of navEls) el.hidden = !pageIds.includes(el.dataset.menuNav);
    if (page !== reported) {
      reported = page;
      onPage(page);
    }
  }

  function cancelConfirm() {
    if (!confirming) return;
    confirming = false;
    removeConfirm?.();
    removeConfirm = null;
    root.removeAttribute("data-confirm");
    onChange({ open, confirming });
  }

  function close() {
    if (!open) return;
    cancelConfirm();
    open = false;
    removeDialog?.();
    removeDialog = null;
    render();
    onChange({ open, confirming });
    opener?.focus?.();
    opener = null;
  }

  function openDialog(pageId) {
    if (!open) {
      open = true;
      opener = getActiveElement();
      removeDialog = stack.push({ close });
      if (!narrow()) nav.open(pageIds[0]); else nav.back();
      render();
      onChange({ open, confirming });
    }
    if (pageId !== undefined) nav.open(pageId);
    render();
    focusables()[0]?.focus();
  }

  function showConfirm() {
    if (!open || confirming) return;
    confirming = true;
    root.setAttribute("data-confirm", "");
    removeConfirm = stack.push({ close: cancelConfirm });
    onChange({ open, confirming });
  }

  function onNarrowChange() {
    if (open && !narrow() && nav.page === null) nav.open(pageIds[0]);
    render();
  }

  function onKeydown(event) {
    if (event.key !== "Tab") return; // i18n-ok: key name
    const items = focusables();
    if (items.length === 0) return;
    const firstEl = items[0];
    const lastEl = items[items.length - 1];
    const active = getActiveElement();
    if (event.shiftKey && active === firstEl) {
      event.preventDefault();
      lastEl.focus();
    } else if (!event.shiftKey && active === lastEl) {
      event.preventDefault();
      firstEl.focus();
    }
  }

  const bound = [];
  function on(el, type, fn) {
    if (!el) return;
    el.addEventListener(type, fn);
    bound.push(() => el.removeEventListener(type, fn));
  }
  on(root, "keydown", onKeydown);
  on(backdrop, "click", (event) => { if (event.target === backdrop) close(); });
  // On a phone the list and the page swap places, so the tapped entry (or the
  // back button) disappears: focus moves to what is shown in its place.
  on(backEl, "click", () => {
    const left = nav.page;
    nav.back();
    render();
    navEls.find((el) => el.dataset.menuNav === left)?.focus();
  });
  on(closeEl, "click", () => close());
  for (const el of navEls) {
    on(el, "click", () => {
      nav.open(el.dataset.menuNav);
      render();
      if (narrow()) backEl?.focus();
    });
  }
  matchNarrow.addEventListener("change", onNarrowChange);

  render();

  return {
    open: openDialog,
    close,
    showConfirm,
    cancelConfirm,
    refreshPages(next) {
      pageIds = [...next];
      nav.setPages(pageIds);
      render();
    },
    get isOpen() { return open; },
    get page() { return currentPage(); },
    dispose() {
      matchNarrow.removeEventListener("change", onNarrowChange);
      for (const off of bound.splice(0)) off();
      removeConfirm?.();
      removeDialog?.();
    },
  };
}
