import { t } from "../i18n/i18n.js";
import { activityUrl } from "../net/strava.js";
import { StravaUpload } from "../net/stravaUpload.js";

/** One state-appropriate action, shared by the summary and recovered ride. */
export function uploadPresentation(state, account) {
  const view = { busy: false, action: null, connect: false, activity: null, status: "", detail: "" };
  if (state.phase === "success") return { ...view, status: t("strava.state.success"), activity: activityUrl(state.activityId) };
  const authError = ["not_connected", "upload_not_allowed"].includes(state.code);
  if (!account?.can_upload || authError) return { ...view, connect: true, detail: t(account && state.code !== "not_connected" ? "strava.permission" : "strava.connectHint") };
  switch (state.phase) {
    case "uploading":
    case "processing":
      return { ...view, busy: true, action: t(state.phase === "uploading" ? "strava.uploading" : "strava.action.checking"), status: t(state.phase === "uploading" ? "strava.state.uploading" : "strava.state.processing") };
    case "pending":
    case "check-failed":
      return { ...view, action: t("strava.action.check"), status: t(state.phase === "pending" ? "strava.state.pending" : "strava.state.check-failed"), detail: t("strava.checkHint") };
    case "uncertain":
      return { ...view, action: t("strava.action.again"), status: t("strava.state.uncertain"), detail: t("strava.uncertainHint"), activity: "https://www.strava.com/athlete/training" };
    case "rejected":
      return { ...view, status: t("strava.state.rejected"), detail: t("strava.rejectedHint", { message: state.error }) };
    case "failed":
      return { ...view, action: t("strava.action.retry"), status: t("strava.state.failed"), detail: t("strava.failedHint") };
    default:
      return { ...view, action: t("unfinished.uploadStrava") };
  }
}

/** Bind a single ride's panel; disposing prevents late effects on another ride. */
export function bindStravaUpload({ elements, client, receipts, key, account, makeFile, name, onSuccess = () => {}, confirm = () => false }) {
  const job = account ? new StravaUpload({ client, receipts, key }) : null;
  let notified = false;
  const render = (state) => {
    const view = uploadPresentation(state, account);
    elements.panel.dataset.state = state.phase;
    elements.panel.setAttribute("aria-busy", String(view.busy));
    elements.account.textContent = account ? t("strava.account", { name: account.name }) : "";
    elements.account.hidden = !account;
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
    elements.activity.textContent = t(state.phase === "success" ? "strava.view" : "strava.action.open");
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
  elements.action.addEventListener("click", run);
  return {
    get state() { return job?.state; },
    dispose() {
      unsubscribe?.();
      job?.dispose();
      elements.action.removeEventListener("click", run);
    },
  };
}
