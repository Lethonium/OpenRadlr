/**
 * The confirmation every delete in the profile goes through: a card over the
 * profile that says what is deleted, what changes because of it, what stays
 * and that it cannot be undone. Cancel has the focus, so a stray Enter or a
 * second tap deletes nothing. `onExport` may resolve false: its error then
 * shows in the card. The DOM elements, the panel stack (Esc) and the
 * document are injected.
 */

import { t, tn } from "../i18n/i18n.js";

const ITEMS = {
  ride: (f) => ({ title: t("profilePage.delete.ride.title"), lines: [t("profilePage.delete.ride.what", { date: f.date ?? "" }), t("profilePage.delete.ride.totals"), t("profilePage.delete.ride.strava")], action: t("profilePage.delete.ride.action"), offerExport: false }),
  rides: (f) => ({ title: t("profilePage.delete.rides.title"), lines: [tn("profilePage.delete.rides.what", f.count, { from: f.from ?? "", to: f.to ?? "" }), t("profilePage.delete.rides.totals"), t("profilePage.delete.rides.strava")], action: tn("profilePage.delete.rides.action", f.count) }),
  bestLaps: (f) => ({ title: t("profilePage.delete.bestLaps.title"), lines: [tn("profilePage.delete.bestLaps.what", f.count), t("profilePage.delete.bestLaps.ghosts")], action: tn("profilePage.delete.bestLaps.action", f.count) }),
  goal: (f) => ({ title: t("profilePage.delete.goal.title"), lines: [t("profilePage.delete.goal.what", { title: f.title ?? "" }), t("profilePage.delete.goal.rides")], action: t("profilePage.delete.goal.action"), offerExport: false }),
  goals: (f) => ({ title: t("profilePage.delete.goals.title"), lines: [tn("profilePage.delete.goals.what", f.count), t("profilePage.delete.goal.rides")], action: tn("profilePage.delete.goals.action", f.count) }),
  profile: () => ({ title: t("profilePage.delete.profile.title"), lines: [t("profilePage.delete.profile.what"), t("profilePage.delete.profile.server"), t("profilePage.delete.profile.stays")], action: t("profilePage.delete.profile.action") }),
  progress: (f) => ({ title: t("profilePage.delete.progress.title"), lines: [t("profilePage.delete.progress.what", { summits: f.summits ?? 0, lemons: f.lemons ?? 0 }), t("profilePage.delete.progress.again")], action: t("profilePage.delete.progress.action") }),
  unfinished: () => ({ title: t("profilePage.delete.unfinished.title"), lines: [t("profilePage.delete.unfinished.what")], action: t("profilePage.delete.unfinished.action") }),
  settings: () => ({ title: t("profilePage.delete.settings.title"), lines: [t("profilePage.delete.settings.what"), t("profilePage.delete.settings.devices")], action: t("profilePage.delete.settings.action") }),
  everything: (f) => ({ title: t("profilePage.delete.everything.title"), lines: [tn("profilePage.delete.everything.what", f.count ?? 0), t("profilePage.delete.everything.newRider"), t("profilePage.delete.rides.strava")], action: t("profilePage.delete.everything.action"), requireTick: true }),
};

/**
 * What a delete means, for the confirmation.
 * @param {"ride" | "rides" | "bestLaps" | "goal" | "goals" | "profile" | "progress" | "unfinished" | "settings" | "everything"} item
 * @param {{count?: number, from?: string, to?: string, date?: string, title?: string, summits?: number, lemons?: number}} facts
 */
export function deleteTexts(item, facts = {}) {
  const texts = ITEMS[item]({ count: 0, ...facts });
  return { offerExport: true, requireTick: false, ...texts, lines: [...texts.lines, t("profilePage.delete.undo")] };
}

/**
 * @param {{els: Record<"root" | "title" | "lines" | "tickRow" | "tick" | "error" | "exportButton" | "cancel" | "go", any>, stack: {push: (panel: {close: () => void}) => () => void}, doc?: Document}} options
 */
export function createDeleteConfirm({ els, stack, doc = globalThis.document }) {
  let current = null;

  // While the delete runs, backing out would hide whether it happened.
  let busy = false;

  function finish(answer) {
    if (!current || busy) return;
    const { resolve, remove } = current;
    current = null;
    remove();
    els.root.hidden = true;
    resolve(answer);
  }

  function syncGo() {
    els.go.disabled = Boolean(current?.texts.requireTick) && !els.tick.checked;
  }

  els.cancel.addEventListener("click", () => finish(false));
  els.root.addEventListener("click", (event) => {
    if (event.target === els.root) finish(false);
  });
  els.tick.addEventListener("change", syncGo);
  els.exportButton.addEventListener("click", async () => {
    const asked = current;
    if (!asked?.onExport) return;
    els.error.hidden = true;
    const exported = await asked.onExport();
    if (current !== asked || exported !== false) return;
    els.error.textContent = t("profilePage.data.exportFailed");
    els.error.hidden = false;
  });
  els.go.addEventListener("click", async () => {
    if (!current || els.go.disabled) return;
    const asked = current;
    els.go.disabled = true;
    busy = true;
    const done = await asked.onConfirm().catch(() => false);
    busy = false;
    if (current !== asked) return;
    if (done) return finish(true);
    els.error.textContent = t("profilePage.delete.failed");
    els.error.hidden = false;
    syncGo();
  });

  return {
    /** Shows the card; resolves true once `onConfirm` succeeded, false when the rider backed out. */
    ask({ texts, onConfirm, onExport }) {
      finish(false);
      return new Promise((resolve) => {
        current = { texts, onConfirm, onExport, resolve, remove: stack.push({ close: () => finish(false) }) };
        els.title.textContent = texts.title;
        els.lines.replaceChildren(...texts.lines.map((line) => Object.assign(doc.createElement("li"), { textContent: line })));
        els.go.textContent = texts.action;
        els.exportButton.hidden = !(texts.offerExport && onExport);
        els.tickRow.hidden = !texts.requireTick;
        els.tick.checked = false;
        els.error.hidden = true;
        els.error.textContent = "";
        syncGo();
        els.root.hidden = false;
        els.cancel.focus();
      });
    },
    get isOpen() {
      return current !== null;
    },
  };
}
