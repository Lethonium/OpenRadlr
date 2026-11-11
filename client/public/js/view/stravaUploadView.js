import { t } from "../i18n/i18n.js";
import { activityUrl } from "../net/strava.js";
import { StravaUpload } from "../net/stravaUpload.js";

/** One state-appropriate action, shared by the summary and recovered ride. */
export function uploadPresentation(state, account) {
  const view = { busy: false, spinner: false, tone: "neutral", action: null, connect: false, activity: null, activityLabel: null, status: "", detail: "" };
  if (state.phase === "success") return { ...view, tone: "success", status: t("strava.state.success"), activity: activityUrl(state.activityId), activityLabel: t("strava.state.success") };
  const authError = ["not_connected", "upload_not_allowed"].includes(state.code);
  if (!account?.can_upload || authError) return { ...view, tone: account || authError ? "error" : "neutral", connect: true, detail: t(account && state.code !== "not_connected" ? "strava.permission" : "strava.connectHint") };
  switch (state.phase) {
    case "uploading":
    case "processing": {
      const label = t(state.phase === "uploading" ? "strava.state.uploading" : "strava.state.processing");
      return { ...view, busy: true, spinner: true, action: label, status: label };
    }
    case "pending":
      return { ...view, action: t("strava.action.check"), status: t("strava.state.pending"), detail: t("strava.checkHint") };
    case "check-failed":
      return { ...view, tone: "error", action: t("strava.action.retryCheck"), status: t("strava.state.check-failed"), detail: t("strava.checkHint") };
    case "uncertain":
      return { ...view, tone: "error", action: t("strava.action.again"), status: t("strava.state.uncertain"), detail: t("strava.uncertainHint"), activity: "https://www.strava.com/athlete/training", activityLabel: t("strava.action.open") };
    case "rejected":
      return { ...view, tone: "error", status: t("strava.state.rejected"), detail: t("strava.rejectedHint", { message: state.error }), activity: "https://www.strava.com/athlete/training", activityLabel: t("strava.state.rejected") };
    case "failed":
      return { ...view, tone: "error", action: t("strava.action.retry"), status: t("strava.state.failed"), detail: t("strava.failedHint") };
    default:
      return { ...view, action: t("unfinished.uploadStrava") };
  }
}

/** Bind a single ride's panel; disposing prevents late effects on another ride. */
export function bindStravaUpload({ elements, client, receipts, key, account, makeFile, name, onSuccess = () => {}, onConnect, confirm = () => false }) {
  const job = account ? new StravaUpload({ client, receipts, key }) : null;
  let notified = false;
  const render = (state) => {
    const view = uploadPresentation(state, account);
    elements.panel.dataset.state = state.phase;
    elements.panel.dataset.spinner = String(view.spinner);
    elements.panel.dataset.tone = state.persisted === false && view.tone === "neutral" ? "warning" : view.tone;
    elements.action.setAttribute("aria-busy", String(view.busy));
    const explanation = [view.status, view.detail, state.persisted === false ? t("strava.storageWarning") : ""].filter(Boolean).join(" ");
    elements.panel.title = explanation;
    elements.action.title = explanation || t("strava.uploadTitle");
    elements.connect.title = explanation;
    elements.activity.title = state.phase === "success" ? t("strava.view") : explanation;
    elements.activity.setAttribute("aria-label", state.phase === "success" ? t("strava.view") : view.activityLabel ?? "");
    elements.account.textContent = account ? t("strava.account", { name: account.name }) : "";
    elements.account.hidden = !account;
    elements.account.title = account?.name ?? "";
    elements.status.textContent = view.status;
    elements.status.hidden = !view.status;
    elements.detail.textContent = view.detail;
    elements.detail.hidden = !view.detail;
    elements.action.textContent = view.action ?? "";
    elements.action.hidden = !view.action;
    elements.action.disabled = view.busy;
    elements.connect.hidden = !view.connect;
    elements.connect.textContent = t(account ? "strava.action.reconnect" : "strava.action.connect");
    elements.activity.hidden = !view.activity;
    elements.activity.href = view.activity ?? "";
    elements.activity.textContent = view.activityLabel ?? "";
    elements.storage.hidden = state.persisted !== false;
    if (state.phase === "success" && !notified) { notified = true; onSuccess(); }
  };
  const unsubscribe = job?.subscribe(render);
  if (!job) render({ phase: "idle", persisted: true });
  const run = () => {
    const resubmit = job?.state.phase === "uncertain";
    if (resubmit && !confirm(t("strava.confirmAgain"))) return;
    return job?.run(makeFile, name, { resubmit });
  };
  const connect = (event) => {
    if (!onConnect) return;
    event.preventDefault();
    return onConnect();
  };
  elements.action.addEventListener("click", run);
  elements.connect.addEventListener("click", connect);
  return {
    get state() { return job?.state; },
    dispose() {
      unsubscribe?.();
      job?.dispose();
      elements.action.removeEventListener("click", run);
      elements.connect.removeEventListener("click", connect);
    },
  };
}
