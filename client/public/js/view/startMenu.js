/**
 * Start menu: server status and the route picker (routes plus the spin
 * studio). Pure helpers decide what to show; `renderRoutes` writes it into
 * the DOM with textContent only, because route names come from the server.
 */

import { PRESETS } from "../workout/presets.js";
import { planDuration } from "../workout/plan.js";
import { distanceUnit, formatDistance, formatDistanceWithUnit, formatDuration, formatElevation } from "../util/format.js";
import { t, tn } from "../i18n/i18n.js";

/** "3 riding now · 50 max" style status, or a hint when the server is unreachable. */
export function serverStatus(info) {
  if (!info) return { text: t("menu.server.unreachable"), full: false, online: false };
  const players = info.players ?? 0;
  const phones = Math.min(info.phone_players ?? 0, players);
  // Phone riders have seats of their own, so only the others count against `max_players`.
  const seated = players - phones;
  const max = info.max_players ?? 0;
  const full = max > 0 && seated >= max;
  const phoneMax = info.max_phone_players ?? 0;
  const phoneFull = phoneMax > 0 && phones >= phoneMax;
  const riders = tn("menu.riders", players) + (phones > 0 ? ` (${phones} 📱)` : "");
  const text = full ? t("menu.server.full", { riders }) : t("menu.server.room", { riders, n: Math.max(0, max - seated) });
  return { text, full, phoneFull, online: true };
}

/**
 * The small build label in the start menu: `v0.1.0 · 3f2a9c1`, the details for
 * a bug report, and whether a cached client is older than the server.
 */
export function buildLabel(info, client) {
  const server = info?.build;
  const version = info?.version ? `v${info.version}` : "";
  const known = (sha) => Boolean(sha) && sha !== "dev";
  const stale = known(client?.sha) && known(server?.sha) && client.sha !== server.sha;
  const part = (name, build) => `${name} ${build?.sha ?? "unknown"}${build?.date ? ` (${build.date})` : ""}`;
  // Copied into bug reports for the maintainers, so it stays English.
  const details = [version, part("client", client), server ? part("server", server) : "server unreachable"] // i18n-ok
    .concat(info?.protocol_version ? [`protocol ${info.protocol_version}`] : [])
    .filter(Boolean)
    .join(" · ");
  return { text: [version, client?.sha ?? "dev"].filter(Boolean).join(" · "), details, stale };
}

/**
 * "Ridden on this server: 12,345 km on trainers · 678 km on phones", in the
 * rider's units; `null` for servers that don't report it (older ones).
 */
export function communityDistance(info) {
  const totals = info?.distance_m;
  if (!totals || !Number.isFinite(totals.trainer) || !Number.isFinite(totals.paddle)) return null;
  const amount = (metres) => `${formatDistance(metres, 0)} ${distanceUnit()}`;
  return t("menu.community", { trainers: amount(totals.trainer), phones: amount(totals.paddle) });
}

/** The routes a server offers (older servers only report one), then its spin studio and the workout. */
/** The server's privacy policy link (/api/info), or null; only http(s) addresses. */
export function privacyUrl(info) {
  const url = info?.privacy_url;
  return typeof url === "string" && /^https?:\/\//.test(url) ? url : null;
}

export function routesOf(info) {
  if (!info) return [];
  const studio = info.studio ? [{ ...info.studio, kind: "studio" }] : [];
  // The workout happens at a café of a real route, so it needs one.
  const workout = [{ id: "workout", kind: "workout", name: t("menu.workout") }];
  if (Array.isArray(info.routes) && info.routes.length) return [...info.routes, ...studio, ...workout];
  return info.route ? [{ ...info.route, players: info.players ?? 0 }, ...studio, ...workout] : studio;
}

/** The route whose world the workout joins: the server's default (first). */
export function workoutRoute(info) {
  return routesOf(info).find((route) => route.kind === undefined)?.id ?? null;
}

/** "3 workouts · 4–12 min" */
export function workoutTagline(presets) {
  const minutes = presets.map((plan) => Math.round(planDuration(plan) / 60));
  const low = Math.min(...minutes);
  const high = Math.max(...minutes);
  return tn("menu.workouts", presets.length, { range: low === high ? low : `${low}–${high}` });
}

/** "HIIT 30/30 starts in 4:12" during the lobby, else what runs and what's next. */
export function studioTagline(studio, nowS = Date.now() / 1000) {
  const startsIn = studio.class.starts_at_s - nowS;
  if (startsIn > 0) return t("menu.studio.startsIn", { name: studio.class.name, time: formatDuration(Math.ceil(startsIn)) });
  const nextIn = Math.max(0, studio.next.starts_at_s - nowS);
  return t("menu.studio.running", { name: studio.class.name, next: studio.next.name, time: formatDuration(Math.ceil(nextIn)) });
}

/** The saved route if the server still has it, else the server's default (first). */
export function pickRoute(routes, savedId) {
  return routes.find((route) => route.id === savedId) ?? routes[0] ?? null;
}

/** "6.8 km · 27 m up" (or "4.2 mi · 89 ft up") */
export function routeStats(route) {
  return t("menu.routeStats", { distance: formatDistanceWithUnit(route.length_m ?? 0, 1), gain: formatElevation(route.elevation_gain_m ?? 0) });
}

/** The stage headline: the workout card asks for a workout, the others for a place to ride. */
export function stageHeadline(picked) {
  return picked?.kind === "workout" ? t("menu.stage.pickWorkout") : t("menu.routes.title");
}

/** The line under the stage headline: where the workout happens, or how riding together works. */
export function stageLede(picked) {
  return picked?.kind === "workout" ? t("menu.workout.lede") : t("menu.routes.lede");
}

/** The workout card keeps only the heart-rate row of the devices, so without Bluetooth the heading goes. */
export function devicesVisible(picked, bluetooth) {
  return picked?.kind !== "workout" || bluetooth;
}

/** The line under the menu stage's title for the picked card. */
export function stageStats(picked) {
  if (!picked) return "";
  if (picked.kind === "studio") return t("menu.stage.spinClass");
  if (picked.kind === "workout") return workoutTagline(PRESETS);
  return routeStats(picked);
}

/** Rough character of a route from its climbing per kilometre. */
export function routeCharacter(route) {
  const perKm = (route.elevation_gain_m ?? 0) / Math.max(0.1, (route.length_m ?? 0) / 1000);
  if (perKm < 8) return t("menu.route.flat");
  if (perKm < 18) return t("menu.route.rolling");
  return t("menu.route.hilly");
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** "3 riders", or "3 riders · 1 📱" when some of them pedal with phone paddles. */
export function routeRiders(route) {
  const riders = route.players ?? 0;
  const phones = Math.min(route.phone_players ?? 0, riders);
  const text = tn("menu.riders", riders);
  return phones > 0 ? t("menu.riders.withPhones", { riders: text, phones }) : text;
}

/**
 * Renders route cards as radio-style buttons.
 * @param {HTMLElement} list
 * @param {object[]} routes
 * @param {string | null} selectedId
 * @param {(id: string) => void} onSelect
 */
export function renderRoutes(list, routes, selectedId, onSelect) {
  list.replaceChildren(
    ...routes.map((route) => {
      const item = element("li");
      const button = element("button", "route-card");
      button.type = "button";
      button.setAttribute("aria-pressed", String(route.id === selectedId));
      const studio = route.kind === "studio";
      const workout = route.kind === "workout";
      if (studio || workout) button.classList.add("studio-card");
      const head = element("span", "route-head");
      head.append(element("strong", "route-name", route.name), element("span", "route-tag", studio ? t("menu.route.class") : workout ? t("menu.workout") : routeCharacter(route)));
      button.append(head);
      const description = studio ? t("menu.studio.description") : workout ? t("menu.workout.tagline") : route.description;
      if (description) button.append(element("span", "route-description", description));
      const foot = element("span", "route-foot");
      const riders = route.players ?? 0;
      const stats = studio ? studioTagline(route) : workout ? workoutTagline(PRESETS) : routeStats(route);
      foot.append(element("span", "route-stats", stats));
      if (!workout) foot.append(element("span", riders > 0 ? "route-riders active" : "route-riders", routeRiders(route)));
      button.append(foot);
      button.addEventListener("click", () => onSelect(route.id));
      item.append(button);
      return item;
    }),
  );
}
