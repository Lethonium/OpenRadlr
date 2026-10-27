/**
 * Start menu: server status and the route picker (routes plus the spin
 * studio). Pure helpers decide what to show; `renderRoutes` writes it into
 * the DOM with textContent only, because route names come from the server.
 */

import { PRESETS } from "../workout/presets.js";
import { planDuration } from "../workout/plan.js";
import { distanceUnit, formatDistance, formatDistanceWithUnit, formatDuration, formatElevation } from "../util/format.js";

/** "3 riding now · 50 max" style status, or a hint when the server is unreachable. */
export function serverStatus(info) {
  if (!info) return { text: "Server unreachable", full: false, online: false };
  const players = info.players ?? 0;
  const phones = Math.min(info.phone_players ?? 0, players);
  // Phone riders have seats of their own, so only the others count against `max_players`.
  const seated = players - phones;
  const max = info.max_players ?? 0;
  const full = max > 0 && seated >= max;
  const phoneMax = info.max_phone_players ?? 0;
  const phoneFull = phoneMax > 0 && phones >= phoneMax;
  const riding = players === 1 ? "1 rider" : `${players} riders`;
  const mix = phones > 0 ? ` (${phones} 📱)` : "";
  return { text: full ? `Full · ${riding}${mix} online` : `${riding}${mix} online · room for ${Math.max(0, max - seated)} more`, full, phoneFull, online: true };
}

/** The server's name for the status pill, empty for the default "OpenRadlr" (the logo says it already). */
export function serverName(info) {
  const name = info?.name;
  return name && name !== "OpenRadlr" ? name : "";
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
  const details = [version, part("client", client), server ? part("server", server) : "server unreachable"]
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
  const amount = (metres) => `${Number(formatDistance(metres, 0)).toLocaleString("en-US")} ${distanceUnit()}`;
  return `Ridden on this server: ${amount(totals.trainer)} on trainers · ${amount(totals.paddle)} on phones`;
}

export const WORKOUT_TAGLINE = "Bodyweight circuit at the café's outdoor gym. No bike needed.";

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
  const workout = [{ id: "workout", kind: "workout", name: "Workout" }];
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
  return `${presets.length} workouts · ${low === high ? low : `${low}–${high}`} min`;
}

/** "HIIT 30/30 starts in 4:12" during the lobby, else what runs and what's next. */
export function studioTagline(studio, nowS = Date.now() / 1000) {
  const startsIn = studio.class.starts_at_s - nowS;
  if (startsIn > 0) return `${studio.class.name} starts in ${formatDuration(Math.ceil(startsIn))}`;
  const nextIn = Math.max(0, studio.next.starts_at_s - nowS);
  return `${studio.class.name} running · next: ${studio.next.name} in ${formatDuration(Math.ceil(nextIn))}`;
}

/** The saved route if the server still has it, else the server's default (first). */
export function pickRoute(routes, savedId) {
  return routes.find((route) => route.id === savedId) ?? routes[0] ?? null;
}

/** "6.8 km · 27 m up" (or "4.2 mi · 89 ft up") */
export function routeStats(route) {
  return `${formatDistanceWithUnit(route.length_m ?? 0, 1)} · ${formatElevation(route.elevation_gain_m ?? 0)} up`;
}

export const STUDIO_TAGLINE = "Ride a class together: bikes side by side, targets from your FTP.";

/** The headline: the picked route's or class's name, a question for the workout, the events tab's title. */
export function stageHeadline(picked, activity = activityOf(picked)) {
  if (activity === "events") return "Events";
  if (picked?.kind === "workout") return "Pick your workout";
  return picked?.name ?? "Where do you want to ride?";
}

/** The line under the headline: what the pick is like, or how riding together works. */
export function stageLede(picked, activity = activityOf(picked)) {
  if (activity === "events") return "Group rides and races on a schedule. Join one and you ride its route.";
  if (picked?.kind === "workout") return "Bodyweight circuit at the café's outdoor gym.";
  if (picked?.kind === "studio") return STUDIO_TAGLINE;
  return picked?.description || "Everyone on the same route rides together — friends, strangers and bots.";
}

/** The workout card keeps only the heart-rate row of the devices, so without Bluetooth the heading goes. */
export function devicesVisible(picked, bluetooth) {
  return picked?.kind !== "workout" || bluetooth;
}

/** The figures under the headline: "Rolling · 4.8 km · 64 m up · 2 riders", the class running, or the workouts. */
export function stageStats(picked, nowS = Date.now() / 1000) {
  if (!picked) return "";
  if (picked.kind === "studio") return `${studioTagline(picked, nowS)} · ${routeRiders(picked)}`;
  if (picked.kind === "workout") return workoutTagline(PRESETS);
  return `${routeCharacter(picked)} · ${routeStats(picked)} · ${routeRiders(picked)}`;
}

/** What a card is for: riding a route, a studio class or the workout. */
export function activityOf(route) {
  return route?.kind === "studio" || route?.kind === "workout" ? route.kind : "ride";
}

/** The cards on an activity's tab (none on the events tab: it lists events). */
export function routesFor(activity, routes) {
  return routes.filter((route) => activityOf(route) === activity);
}

/** The card to pick when switching to an activity: the preferred one if it belongs there, else the first. */
export function pickForActivity(routes, activity, preferredId) {
  const cards = routesFor(activity, routes);
  return cards.find((route) => route.id === preferredId) ?? cards[0] ?? null;
}

const ACTIVITY_LABELS = { ride: "Ride", studio: "Studio", workout: "Workout", events: "Events" };

/**
 * The tabs above the cards, only for what the server offers. Events count the
 * scheduled ones and are `live` while one can be joined or is running.
 * @param {object[]} routes from `routesOf`
 * @param {{joinable: boolean, countdown: string}[]} events rows from `eventRows`
 */
export function activityTabs(routes, events) {
  const tabs = ["ride", "studio", "workout"]
    .map((id) => ({ id, label: ACTIVITY_LABELS[id], count: routesFor(id, routes).length, live: false }))
    .filter((tab) => tab.count > 0);
  if (events.length) tabs.push({ id: "events", label: ACTIVITY_LABELS.events, count: events.length, live: events.some((row) => row.joinable || row.countdown === "running") });
  return tabs;
}

/** The tab shown: the one chosen while the server still offers it, else the picked card's. */
export function shownActivity(tabs, chosen, picked) {
  return tabs.some((tab) => tab.id === chosen) ? chosen : activityOf(picked);
}

/** Cards are a picker: shown on route tabs with a choice to make. */
export function showsCards(activity, cards) {
  return activity !== "events" && cards.length > 1;
}

/** Rough character of a route from its climbing per kilometre. */
export function routeCharacter(route) {
  const perKm = (route.elevation_gain_m ?? 0) / Math.max(0.1, (route.length_m ?? 0) / 1000);
  if (perKm < 8) return "Flat";
  if (perKm < 18) return "Rolling";
  return "Hilly";
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
  return `${riders === 1 ? "1 rider" : `${riders} riders`}${phones > 0 ? ` · ${phones} 📱` : ""}`;
}

/** The latest select handler per list: a list that isn't redrawn still calls the current one. */
const handlers = new WeakMap();

/**
 * Rewrites `list` only when what it shows changed. The menu refreshes every few
 * seconds; redrawing unchanged cards under the pointer drops their hover state and
 * focus, which reads as a flicker.
 * @param {(select: (id: string) => void) => void} draw
 */
function drawWhenChanged(list, key, onSelect, draw) {
  handlers.set(list, onSelect);
  if (list.dataset.drawn === key) return;
  list.dataset.drawn = key;
  draw((id) => handlers.get(list)(id));
}

/** What a route card shows. */
export function routeCard(route) {
  const studio = route.kind === "studio";
  const workout = route.kind === "workout";
  return {
    id: route.id,
    name: route.name,
    tag: studio ? "Class" : workout ? "Workout" : routeCharacter(route),
    // A route's description is under the headline once picked: the card stays compact.
    description: studio ? STUDIO_TAGLINE : workout ? WORKOUT_TAGLINE : null,
    title: route.description ?? "",
    stats: studio ? studioTagline(route) : workout ? workoutTagline(PRESETS) : routeStats(route),
    riders: workout ? null : routeRiders(route),
    active: (route.players ?? 0) > 0,
    special: studio || workout,
  };
}

/**
 * Renders route cards as radio-style buttons.
 * @param {HTMLElement} list
 * @param {object[]} routes
 * @param {string | null} selectedId
 * @param {(id: string) => void} onSelect
 */
export function renderRoutes(list, routes, selectedId, onSelect) {
  const cards = routes.map(routeCard);
  drawWhenChanged(list, JSON.stringify([selectedId, cards]), onSelect, (select) =>
    list.replaceChildren(
      ...cards.map((card) => {
        const item = element("li");
        const button = element("button", "route-card");
        button.type = "button";
        button.setAttribute("aria-pressed", String(card.id === selectedId));
        if (card.special) button.classList.add("studio-card");
        if (card.title) button.title = card.title;
        const head = element("span", "route-head");
        head.append(element("strong", "route-name", card.name), element("span", "route-tag", card.tag));
        button.append(head);
        if (card.description) button.append(element("span", "route-description", card.description));
        const foot = element("span", "route-foot");
        foot.append(element("span", "route-stats", card.stats));
        if (card.riders !== null) foot.append(element("span", card.active ? "route-riders active" : "route-riders", card.riders));
        button.append(foot);
        button.addEventListener("click", () => select(card.id));
        item.append(button);
        return item;
      }),
    ),
  );
}

/**
 * Renders the activity tabs: a tablist with arrow keys moving between tabs.
 * @param {HTMLElement} list
 * @param {{id: string, label: string, count: number, live: boolean}[]} tabs
 * @param {string} current
 * @param {(id: string) => void} onSelect
 */
export function renderActivityTabs(list, tabs, current, onSelect) {
  drawWhenChanged(list, JSON.stringify([current, tabs]), onSelect, (select) => {
    const buttons = tabs.map((tab) => {
      const button = element("button", "activity-tab", tab.label);
      button.type = "button";
      button.setAttribute("role", "tab");
      button.id = `tab-${tab.id}`;
      button.setAttribute("aria-controls", "activity-panel");
      const selected = tab.id === current;
      button.setAttribute("aria-selected", String(selected));
      button.tabIndex = selected ? 0 : -1;
      // A count only where there's a choice to make; a dot while an event can be joined.
      if (tab.count > 1 || tab.id === "events") button.append(element("span", "tab-count", String(tab.count)));
      if (tab.live) button.append(element("span", "tab-live", ""));
      button.addEventListener("click", () => select(tab.id));
      return button;
    });
    buttons.forEach((button, index) => {
      button.addEventListener("keydown", (event) => {
        const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
        if (!step) return;
        event.preventDefault();
        const next = buttons[(index + step + buttons.length) % buttons.length];
        next.focus();
        next.click();
      });
    });
    // Redrawing replaces the buttons: keep the keyboard on the selected tab.
    const focused = list.contains(list.ownerDocument?.activeElement);
    list.replaceChildren(...buttons);
    if (focused) buttons.find((button) => button.tabIndex === 0)?.focus();
    list.parentElement?.querySelector("#activity-panel")?.setAttribute("aria-labelledby", `tab-${current}`);
  });
}

/**
 * The Strava line of the start menu. `required`: the server rides with Strava
 * accounts only and this rider has none connected yet.
 * @returns {{shown: boolean, connected: boolean, required: boolean, text: string}}
 */
export function stravaLine(info, account) {
  const strava = info?.strava;
  if (!strava?.enabled) return { shown: false, connected: false, required: false, text: "" };
  if (account) return { shown: true, connected: true, required: false, text: account.name };
  return strava.required
    ? { shown: true, connected: false, required: true, text: "This server needs a Strava account to ride. It keeps bots out; uploading stays your choice." }
    : { shown: true, connected: false, required: false, text: "Upload your rides to Strava" };
}

/**
 * What the main button does: one action at a time. A typed vehicle code turns
 * Ride into Board; a server that needs Strava sends the rider there first.
 * @returns {{kind: "full" | "strava" | "board" | "workout" | "ride", label: string, disabled: boolean}}
 */
export function joinAction({ selected, full, needsStrava, boardCode }) {
  if (full) return { kind: "full", label: "Server is full", disabled: true };
  if (needsStrava) return { kind: "strava", label: "Connect with Strava to ride", disabled: false };
  if (boardCode && selected?.kind !== "workout") return { kind: "board", label: `Board ${boardCode}`, disabled: false };
  if (selected?.kind === "workout") return { kind: "workout", label: "Start workout", disabled: false };
  return { kind: "ride", label: selected ? `Ride ${selected.name}` : "Ride", disabled: false };
}
