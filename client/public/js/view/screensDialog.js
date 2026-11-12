/**
 * The "Pair a second screen" dialog: shows the pairing code with a countdown,
 * offers a new code when it runs out, and unpairs all screens. DOM elements,
 * the session, the clock and timers are injected; UI text comes from `t`.
 */
export function createScreensDialog({ els, createSession, now, setInterval, clearInterval, confirm, onUnpair, t }) {
  let session = null;
  let timer = null;
  let expiresAt = 0;

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
      return;
    }
    els.countdown.textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
  }

  function end() {
    stopTimer();
    session?.close();
    session = null;
  }

  els.renew.addEventListener("click", () => {
    els.renew.hidden = true;
    els.status.textContent = "";
    if (session) session.renew();
    else api.open();
  });
  els.unpair.addEventListener("click", () => {
    if (!confirm(t("screens.unpairConfirm"))) return;
    end();
    onUnpair();
    els.status.textContent = t("screens.unpaired");
    els.code.textContent = "";
    els.countdown.textContent = "";
    els.renew.hidden = false;
  });

  const api = {
    open() {
      end();
      els.code.textContent = "";
      els.countdown.textContent = "";
      els.status.textContent = "";
      els.renew.hidden = true;
      session = createSession();
      session.on("code", ({ code, expiresInS }) => {
        els.code.textContent = code;
        els.status.textContent = "";
        els.renew.hidden = true;
        expiresAt = now() + expiresInS * 1000;
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
      els.dialog.showModal?.();
    },
    close() {
      end();
      els.dialog.close?.();
    },
  };
  return api;
}
