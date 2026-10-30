import { formatCountdown } from "./events.js";
import { formatDuration, formatGap } from "../util/format.js";
import { t, tn } from "../i18n/i18n.js";

/**
 * Side panels (rider list, race status, event feed). Pure functions decide
 * what to show; small render functions write it into the DOM using
 * textContent only, because rider names come from other players.
 */

const nearestFirst = (a, b) => Math.abs(a.gap) - Math.abs(b.gap);
const aheadFirst = (a, b) => b.gap - a.gap;

/** Riders on my route with their gap to me. */
function withGaps(me, riders, route) {
  return riders.map((rider) => ({ rider, gap: route.signedGap(me.distance, rider.distance) }));
}

/**
 * Closest riders to me for a short list: humans first, the nearest bots fill
 * the rows that are left. Each group runs from furthest ahead to furthest behind.
 */
export function nearbyRiders(me, riders, route, limit = 9) {
  const entries = withGaps(me, riders, route).sort(nearestFirst);
  const humans = entries.filter((e) => !e.rider.is_bot).slice(0, limit);
  const bots = entries.filter((e) => e.rider.is_bot).slice(0, limit - humans.length);
  return [...humans.sort(aheadFirst), ...bots.sort(aheadFirst)];
}

/**
 * The Riders drawer: every human (on my route by gap, then those on other
 * routes by route name) and, apart, the closest bots.
 * @param {{rider: object, routeName: string}[]} elsewhere humans on other routes
 */
export function riderSections(me, riders, route, elsewhere = [], botLimit = 9) {
  const entries = withGaps(me, riders, route);
  const humans = entries.filter((e) => !e.rider.is_bot).sort(aheadFirst);
  const away = elsewhere.map(({ rider, routeName }) => ({ rider, gap: null, routeName }));
  const bots = entries.filter((e) => e.rider.is_bot).sort(nearestFirst).slice(0, botLimit).sort(aheadFirst);
  return { humans: [...humans, ...away], bots };
}

/** True if I'm in the race: entered during the countdown, or racing (a lap). */
export function inRace(race, me, myId) {
  if (race?.phase === "countdown") return (race.entrants ?? []).includes(myId);
  if (race?.phase === "running") return me?.lap !== null && me?.lap !== undefined;
  return false;
}

/** One-line race status for the HUD. */
export function raceStatus(race, myLap) {
  switch (race?.phase) {
    case "countdown":
      return t("panels.race.starts", { s: Math.ceil(race.remaining_s), laps: tn("panels.lap", race.laps) });
    case "running":
      return myLap
        ? t("panels.race.lap", { lap: myLap, laps: race.laps, time: formatDuration(race.elapsed_s) })
        : t("panels.race.inProgress", { time: formatDuration(race.elapsed_s) });
    case "finished":
      return t("panels.race.finished");
    default:
      return t("panels.freeRide");
  }
}

/** Human-readable text for a game event, or null to ignore it. */
/**
 * Who is riding right now: humans on the whole server (from /api/info) and
 * humans and bots on your route (from the world state).
 * @param {number | null} serverPlayers null while unknown
 * @param {{is_bot: boolean}[]} riders
 */
export function onlineSummary(serverPlayers, riders, routeRiders = null) {
  // The server counts everyone on the route (#14); the riders listed are only those in view.
  const humans = routeRiders?.humans ?? riders.filter((rider) => !rider.is_bot).length;
  const bots = routeRiders?.bots ?? riders.length - humans;
  const online = Math.max(serverPlayers ?? humans, humans);
  const parts = [t("panels.online", { riders: tn("menu.riders", online) })];
  if (online !== humans) parts.push(t("panels.onRoute", { n: humans }));
  if (bots > 0) parts.push(tn("panels.bots", bots));
  return { count: online, text: parts.join(" · ") };
}

/** `myVehicleId`: the vehicle I sit in, so only its changes are announced. */
export function describeEvent(event, myId, myVehicleId = null) {
  const who = (id, name, isBot) => (id === myId ? t("panels.you") : `${name}${isBot ? ` ${t("panels.botSuffix")}` : ""}`);
  switch (event.kind) {
    case "rider_joined":
      if (event.is_bot) return null;
      return event.rider_id === myId ? t("panels.joinedYou") : t("panels.joined", { who: event.name });
    case "rider_left":
      return null;
    case "race_countdown":
      return t("panels.race.countdown", { laps: tn("panels.lap", event.laps), s: Math.round(event.seconds) });
    case "race_started":
      return t("panels.race.started");
    case "rider_finished":
      return t("panels.riderFinished", { position: event.position, who: who(event.rider_id, event.name, event.is_bot), time: formatDuration(event.time_s) });
    case "race_finished":
      return t("panels.race.finished");
    case "event_lobby":
      return t("panels.event.lobby", { name: event.name, time: formatCountdown(event.starts_in_s) });
    case "event_started":
      // A race already announces itself with race_started.
      return event.event_kind === "race" ? null : t("panels.event.started");
    case "event_finished": {
      if (event.event_kind === "race") return null;
      if (event.event_kind !== "group_ride") return t("panels.event.finished");
      const giver = event.results.reduce((top, r) => (r.given_kj > (top?.given_kj ?? 0) ? r : top), null);
      return giver && giver.given_kj >= 1
        ? t("panels.event.thanks", { name: giver.name, kj: Math.round(giver.given_kj) })
        : t("panels.event.finished");
    }
    case "vehicle_boarded":
      return myVehicleId !== null && event.vehicle_id === myVehicleId ? (event.rider_id === myId ? t("panels.boardedYou") : t("panels.boarded", { who: event.name })) : null;
    case "vehicle_left":
      return myVehicleId !== null && event.vehicle_id === myVehicleId ? (event.rider_id === myId ? t("panels.leftYou") : t("panels.left", { who: event.name })) : null;
    case "captain_changed":
      if (myVehicleId === null || event.vehicle_id !== myVehicleId) return null;
      return event.rider_id === myId ? t("panels.captain.you") : t("panels.captain.named", { name: event.name });
    default:
      return null;
  }
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Riders on phone paddles get a badge: they tap, they don't pedal. */
export const isPaddler = (rider) => rider?.device === "paddle";
export const PADDLE_BADGE = "📱";

function paddleBadge() {
  const badge = element("span", "badge badge-paddle", PADDLE_BADGE);
  badge.title = t("panels.paddleTitle");
  return badge;
}

/** "Anna (bot)", "Ben 📱" for plain-text lists. */
export function riderName(rider) {
  if (rider.is_bot) return `${rider.name} ${t("panels.botSuffix")}`;
  return isPaddler(rider) ? `${rider.name} ${PADDLE_BADGE}` : rider.name;
}

export function renderRiderList(list, entries, myId) {
  list.replaceChildren(
    ...entries.map(({ rider, gap, routeName }) => {
      const item = element("li", rider.id === myId ? "rider me" : "rider");
      const name = element("span", "rider-name", rider.name);
      if (rider.is_bot) name.append(element("span", "badge", t("panels.bot")));
      if (isPaddler(rider)) name.append(paddleBadge());
      item.append(name, element("span", "rider-power", `${Math.round(rider.power)} W`), element("span", "rider-gap", rider.id === myId ? "" : gap === null ? routeName : formatGap(gap)));
      return item;
    }),
  );
}

/** @param {(riderId: number) => object | undefined} [riderOf] the rider behind a result, for its badge */
export function renderResults(list, results, myId, riderOf = () => undefined) {
  list.replaceChildren(
    ...results.map((result, index) => {
      const item = element("li", result.rider_id === myId ? "result me" : "result");
      const name = element("span", "rider-name", `${index + 1}. ${result.name}`);
      if (result.is_bot) name.append(element("span", "badge", t("panels.bot")));
      if (isPaddler(riderOf(result.rider_id))) name.append(paddleBadge());
      item.append(name, element("span", "result-time", formatDuration(result.time_s)));
      return item;
    }),
  );
}

export function appendFeed(feed, text, kind = "event", maxItems = 50) {
  const item = element("li", `feed-${kind}`, text);
  feed.append(item);
  while (feed.children.length > maxItems) feed.firstElementChild.remove();
  feed.scrollTop = feed.scrollHeight;
}
