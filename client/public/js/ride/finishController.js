import { t } from "../i18n/i18n.js";

/**
 * Finishes a ride exactly once: leaves the world, frees the trainer and keeps
 * the ride in history. Every side effect is injected.
 * `leaveWorld` must not read the live connection; pass a closure over one
 * captured before `detachConnection` runs.
 *
 * @param {{
 *   recorder: {empty: boolean},
 *   closePause: () => void,
 *   saveHistory: () => Promise<void>,
 *   markAutosaveFinished: () => Promise<void>,
 *   detachConnection: () => void,
 *   leaveWorld: () => void,
 *   releaseTrainer: () => void,
 *   exportable: boolean,
 * }} deps `exportable` is false for paddle rides
 * @returns {{finish: () => void, readonly finished: boolean, readonly canRecord: boolean}}
 */
export function createFinishController({ recorder, closePause, saveHistory, markAutosaveFinished, detachConnection, leaveWorld, releaseTrainer, exportable }) {
  let done = false;
  return {
    finish() {
      if (done) return;
      done = true;
      closePause();
      detachConnection();
      leaveWorld();
      releaseTrainer();
      if (recorder.empty) return;
      saveHistory();
      if (exportable) markAutosaveFinished();
    },
    get finished() { return done; },
    get canRecord() { return !done; },
  };
}

/**
 * The question to ask before going back to the menu, or null when nothing
 * would be lost (the ride is unsaved, not empty and exportable, or photos exist).
 * @param {{exportable: boolean, saved: boolean, empty: boolean, albumSize: number}} state
 * @returns {string | null}
 */
export function backToMenuWarning({ exportable, saved, empty, albumSize }) {
  const unsaved = (exportable && !saved && !empty) || albumSize > 0;
  if (!unsaved) return null;
  return exportable ? t("ride.confirmBack.exportable") : t("ride.confirmBack.photos");
}
