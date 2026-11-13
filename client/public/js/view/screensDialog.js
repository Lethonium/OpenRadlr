import { liveDevices } from "../net/pairedScreens.js";
import { countdownShare, groupCode } from "./codeInput.js";

// How often the list asks who is watching right now.
const LIST_REFRESH_MS = 5000;

/**
 * The tablet's side of the second-screen panel: shows the pairing code (grouped) with a countdown
 * bar, offers a new code when it runs out, lists the paired screens with a dot for the ones
 * watching right now, and unpairs all screens. Which view of the panel is showing is the caller's
 * business. DOM elements, the sessions, the clock and timers are injected; UI text comes from `t`.
 */
export function createScreensDialog({ els, createSession, now, setInterval, clearInterval, confirm, onUnpair, paired, doc, formatDate, t }) {
  let session = null;
  let listSession = null;
  let listTimer = null;
  let watching = [];
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

  function renderList() {
    const entries = paired.list();
    const live = liveDevices(entries, watching);
    els.empty.hidden = entries.length > 0;
    els.list.replaceChildren(
      ...entries.map((entry, index) => {
        const isLive = live.has(index);
        const dot = doc.createElement("span");
        dot.className = isLive ? "screens-dot is-live" : "screens-dot";
        dot.setAttribute("aria-hidden", "true");
        const name = doc.createElement("span");
        name.textContent = entry.device;
        const meta = doc.createElement("span");
        meta.className = "hint";
        meta.textContent = isLive ? `${formatDate(entry.pairedAt)} · ${t("screens.live")}` : formatDate(entry.pairedAt);
        const item = doc.createElement("li");
        item.className = "screens-device";
        item.append(dot, name, meta);
        return item;
      }),
    );
  }

  /** Asks the server who watches, over a short connection of its own (an idle one is closed by the server). */
  function refreshWatching() {
    listSession?.close();
    const asked = createSession();
    listSession = asked;
    asked.on("watching", (devices) => {
      if (asked !== listSession) return;
      watching = devices;
      renderList();
      asked.close();
    });
    asked.on("error", () => asked.close());
    asked.start({ offer: false });
    asked.query();
  }

  function stopList() {
    if (listTimer !== null) clearInterval(listTimer);
    listTimer = null;
    listSession?.close();
    listSession = null;
  }

  /** Has the server send the watchers of the current key back to pairing; it is renewed right after. */
  function revokeKey() {
    const revoker = createSession();
    const finish = () => revoker.close();
    revoker.on("watching", finish);
    revoker.on("error", finish);
    revoker.start({ offer: false });
    revoker.revoke();
  }

  function end() {
    stopTimer();
    stopList();
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
    revokeKey();
    onUnpair();
    paired.clear();
    watching = [];
    renderList();
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
      session.on("claimed", ({ device }) => {
        paired.add(device ?? t("screens.deviceUnknown"), now());
        renderList();
        els.status.textContent = device ? t("screens.pairedDevice", { device }) : t("screens.paired");
      });
      session.on("error", ({ code }) => {
        if (code === "pair_code_expired") return;
        els.status.textContent = t("screens.error");
      });
      session.start();
    },
    /** Shows the paired screens and keeps asking which of them are live. */
    showList() {
      end();
      watching = [];
      renderList();
      refreshWatching();
      listTimer = setInterval(refreshWatching, LIST_REFRESH_MS);
    },
    close() {
      end();
    },
  };
  return api;
}
