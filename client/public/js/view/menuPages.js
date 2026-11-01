// Page model of the in-game menu: which pages exist, their one-line status,
// and which one is open. Pure: no DOM; callers pass already-translated labels
// (camera, vehicle, workout names) and the raw training state.
import { t, tn } from "../i18n/i18n.js";

export const MENU_PAGES = ["overview", "view", "vehicle", "race", "events", "training", "settings"];

// The studio's View page would hold only road controls.
const STUDIO_HIDDEN = new Set(["view", "vehicle", "race", "events"]);

export function visiblePages({ studio, hasEvents }) {
  return MENU_PAGES.filter((id) => {
    if (studio && STUDIO_HIDDEN.has(id)) return false;
    if (id === "events" && !hasEvents) return false;
    return true;
  });
}

const TITLE_KEYS = {
  overview: "menuPage.overview", view: "menuPage.view", vehicle: "menuPage.vehicle", race: "menuPage.race",
  events: "menuPage.events", training: "menuPage.training", settings: "menuPage.settings",
};

export function pageTitle(id) {
  return t(TITLE_KEYS[id]);
}

const RACE_PHASES = { countdown: "menuPage.race.countdown", running: "menuPage.race.running", finished: "menuPage.race.finished" };

export function pageStatus(id, ctx) {
  switch (id) {
    case "view":
      return ctx.viewMode === "2d" ? t("menuPage.status.view2d")
        : t("menuPage.status.view3d", { camera: ctx.cameraLabel });
    case "vehicle":
      return ctx.vehicleLabel ?? t("menuPage.status.notBoarded");
    case "race":
      return RACE_PHASES[ctx.racePhase] ? t(RACE_PHASES[ctx.racePhase]) : t("menuPage.status.noRace");
    case "training":
      return trainingStatus(ctx);
    case "events":
      return tn("menuPage.status.events", ctx.eventCount);
    case "settings":
      return ctx.units === "imperial" ? t("menuPage.status.imperial") : t("menuPage.status.metric");
    default:
      return "";
  }
}

/** Studio trainer mode, else the running workout, else ERG with its target, else the road simulation. */
function trainingStatus({ studio, studioErg, workoutName, trainingMode, ergTarget }) {
  if (studio) return studioErg ? "ERG" : t("drawer.roadSim"); // i18n-ok: a mode name, as on the toggle
  if (workoutName) return workoutName;
  if (trainingMode === "erg") return t("menuPage.status.erg", { watts: ergTarget });
  return t("drawer.roadSim");
}

/** `page` is null on a phone's list screen. */
export function createMenuNav(initialPages) {
  let pages = [...initialPages];
  let page = null;
  return {
    get page() { return page; },
    open(id) { if (pages.includes(id)) page = id; },
    back() { page = null; },
    setPages(next) {
      pages = [...next];
      if (page !== null && !pages.includes(page)) page = pages[0] ?? null;
    },
  };
}
