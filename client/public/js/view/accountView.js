/**
 * The account card in the profile dialog, the account line on the start menu
 * and the offer on the ride summary (ADR 0032). The models are pure; `render`
 * writes them into the page. Email addresses and passkey names are set as text.
 */

import { t } from "../i18n/i18n.js";

/** The rider row's second line: where this rider's progress is kept; null hides it. */
export function riderBadge(state) {
  switch (state?.phase) {
    case "signedOut":
    case "codeSent":
      return { key: "account.status.local", params: {}, ok: false };
    case "signedIn":
      if (!state.linked) return { key: "account.status.notSaved", params: {}, ok: false };
      if (state.backup?.running) return { key: "account.status.backingUp", params: {}, ok: true };
      return { key: "account.status.saved", params: { email: state.me?.email ?? "" }, ok: true };
    default:
      return null;
  }
}

/** The rider menu's offer to save, until the rider is saved; then null (the account is in the profile). */
export function accountMenuItem(state) {
  if (state?.phase === "signedIn") return state.linked ? null : { key: "account.saveRider", params: {} };
  return { key: "account.menu.save", params: {} };
}

/** Whether the ride summary offers to save the progress. */
export const finishOffer = (state) => ["signedOut", "codeSent"].includes(state.phase) || (state.phase === "signedIn" && !state.linked);

/** The rider card: title and detail keys, a tone, and when the last backup finished (ms or null). */
export function riderStatus(state, backedUpAt) {
  if (!state.linked) return { title: "account.rider.notSaved.title", detail: "account.rider.notSaved.detail", tone: "warning", when: null };
  if (state.backup?.running) return { title: "account.rider.backingUp.title", detail: null, tone: "busy", when: null };
  if (state.backup?.reason === "quota_exceeded") return { title: "account.rider.full.title", detail: "account.rider.full.detail", tone: "warning", when: null };
  if (state.backup && !state.backup.ok) return { title: "account.rider.failed.title", detail: "account.rider.failed.detail", tone: "warning", when: null };
  return { title: "account.rider.saved.title", detail: backedUpAt ? "account.rider.saved.detail" : "account.rider.saved.detailNew", tone: "ok", when: backedUpAt ?? null };
}

const formatWhen = (ms, locale) => new Date(ms).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" });
const formatDate = (ms, locale) => new Date(ms).toLocaleDateString(locale, { dateStyle: "medium" });

/**
 * Renders the flow's state into the Account page.
 * @param {Record<string, HTMLElement>} els
 * @param {object} state AccountFlow.state
 * @param {{passkeys: boolean, riderName: string, backedUpAt: number | null, locale: string, onRemovePasskey: (id: string) => void}} options
 */
export function renderAccount(els, state, { passkeys, riderName, backedUpAt, locale, onRemovePasskey }) {
  const signedIn = state.phase === "signedIn";
  els.signedOut.hidden = signedIn || state.phase === "loading" || state.phase === "offline";
  els.signedIn.hidden = !signedIn;
  els.emailForm.hidden = state.phase !== "signedOut";
  els.codeForm.hidden = state.phase !== "codeSent";
  els.signedOut.dataset.step = state.phase === "codeSent" ? "code" : "email";
  els.passkeyOr.hidden = !passkeys;
  els.passkey.hidden = !passkeys;
  els.codeSent.textContent = t(state.sends > 1 ? "account.code.resent" : "account.code.sent", { email: state.email });
  for (const button of [els.emailSend, els.codeVerify, els.codeResend, els.passkey, els.saveRider, els.backupButton, els.passkeyAdd, els.signOut, els.deleteGo]) {
    button.disabled = state.busy;
  }
  els.error.hidden = !state.error;
  els.error.textContent = state.error ? t(state.error) : "";
  els.note.hidden = signedIn;
  if (!signedIn) {
    els.deleteConfirm.hidden = true;
    return;
  }

  const email = state.me?.email ?? "";
  els.avatar.textContent = email.slice(0, 1).toUpperCase();
  els.who.textContent = email;
  els.methodEmail.textContent = email;
  els.since.textContent = state.created ? t("account.welcome") : state.me?.created_s ? t("account.since", { date: formatDate(state.me.created_s * 1000, locale) }) : "";
  const status = riderStatus(state, backedUpAt);
  els.riderCard.dataset.tone = status.tone;
  els.riderStatus.textContent = t(status.title, { name: riderName });
  els.riderDetail.hidden = !status.detail;
  els.riderDetail.textContent = status.detail ? t(status.detail, { when: status.when ? formatWhen(status.when, locale) : "" }) : "";
  els.saveRider.hidden = state.linked;
  els.backupButton.hidden = !state.linked || Boolean(state.backup?.running);
  els.passkeysSection.hidden = !passkeys;
  els.passkeyList.replaceChildren(
    ...(state.me?.passkeys ?? []).map((key) => {
      const item = document.createElement("li");
      item.className = "account-row";
      const icon = document.createElement("span");
      icon.className = "account-row-icon account-icon-key";
      icon.setAttribute("aria-hidden", "true");
      const text = document.createElement("div");
      text.className = "account-row-text";
      const name = document.createElement("p");
      name.className = "account-row-title";
      name.textContent = key.name;
      const added = document.createElement("p");
      added.className = "account-fine";
      added.textContent = key.created_s ? t("account.passkeys.added", { date: formatDate(key.created_s * 1000, locale) }) : "";
      text.append(name, added);
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "secondary small account-row-action";
      remove.textContent = t("account.passkeys.remove");
      remove.setAttribute("aria-label", t("account.passkeys.removeLabel", { name: key.name }));
      remove.disabled = state.busy;
      remove.addEventListener("click", () => onRemovePasskey(key.id));
      item.append(icon, text, remove);
      return item;
    }),
  );
}
