import { countdownShare, groupCode } from "./codeInput.js";

/**
 * The tablet's side of the second-screen panel: shows the pairing code (grouped) with a countdown
 * bar, offers a new code when it runs out, and unpairs all screens. Which view of the panel is
 * showing is the caller's business. DOM elements, the session, the clock and timers are injected;
 * UI text comes from `t`.
 */
export function createScreensDialog({ els, createSession, now, setInterval, clearInterval, confirm, onUnpair, t }) {
  let session = null;
  let timer = null;
  let expiresAt = 0;
  let ttlMs = 300_000;

  const stopTimer = () => {
    if (timer !== null) clearInterval(timer);
    timer = null;
  };

  function tick() {
    const left = Math.max(0, Math.ceil((expiresAt - now()) / 1000));
    if (left === 0) {
      stopTimer();
      els.countdown.textContent = t("screens.expired");
      els.renew.hidden = false;
      els.bar.style.setProperty("--share", "0");
      return;
    }
    els.bar.style.setProperty("--share", String(countdownShare(expiresAt / 1000, now() / 1000, ttlMs / 1000)));
    els.countdown.textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
  }

  function end() {
    stopTimer();
    session?.close();
    session = null;
  }

  els.renew.addEventListener("click", () => {
    els.renew.hidden = true;
    els.status.textContent = t("screens.waiting");
    if (session) session.renew();
    else api.open();
  });
  els.unpair.addEventListener("click", () => {
    if (!confirm(t("screens.unpairConfirm"))) return;
    end();
    onUnpair();
    els.note.textContent = t("screens.unpaired");
  });

  const api = {
    open() {
      end();
      els.code.textContent = "";
      els.countdown.textContent = "";
      els.status.textContent = t("screens.waiting");
      els.renew.hidden = true;
      els.bar.style.setProperty("--share", "1");
      els.note.textContent = "";
      session = createSession();
      session.on("code", ({ code, expiresInS }) => {
        els.code.textContent = groupCode(code);
        els.status.textContent = t("screens.waiting");
        els.renew.hidden = true;
        ttlMs = expiresInS * 1000;
        expiresAt = now() + ttlMs;
        stopTimer();
        timer = setInterval(tick, 1000);
        tick();
      });
      session.on("claimed", () => {
        els.status.textContent = t("screens.paired");
      });
      session.on("error", ({ code }) => {
        if (code === "pair_code_expired") return;
        els.status.textContent = t("screens.error");
      });
      session.start();
    },
    close() {
      end();
    },
  };
  return api;
}
