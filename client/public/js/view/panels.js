import { formatCountdown } from "./events.js";
import { formatDuration, formatGap } from "../util/format.js";

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
      return `Race starts in ${Math.ceil(race.remaining_s)} s · ${race.laps} ${race.laps === 1 ? "lap" : "laps"}`;
    case "running":
      return myLap
        ? `Lap ${myLap}/${race.laps} · ${formatDuration(race.elapsed_s)}`
        : `Race in progress · ${formatDuration(race.elapsed_s)} · you are free riding`;
    case "finished":
      return "Race finished";
    default:
      return "Free ride";
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
  const people = (n) => (n === 1 ? "1 rider" : `${n} riders`);
  const parts = [`${people(online)} online`];
  if (online !== humans) parts.push(`${humans} on this route`);
  if (bots > 0) parts.push(bots === 1 ? "1 bot" : `${bots} bots`);
  return { count: online, text: parts.join(" · ") };
}

/** `myVehicleId`: the vehicle I sit in, so only its changes are announced. */
export function describeEvent(event, myId, myVehicleId = null) {
  const who = (id, name, isBot) => (id === myId ? "You" : `${name}${isBot ? " (bot)" : ""}`);
  switch (event.kind) {
    case "rider_joined":
      return event.is_bot ? null : `${who(event.rider_id, event.name, false)} joined`;
    case "rider_left":
      return null;
    case "race_countdown":
      return `Race over ${event.laps} ${event.laps === 1 ? "lap" : "laps"} starts in ${Math.round(event.seconds)} s`;
    case "race_started":
      return "Race started — go!";
    case "rider_finished":
      return `#${event.position} ${who(event.rider_id, event.name, event.is_bot)} · ${formatDuration(event.time_s)}`;
    case "race_finished":
      return "Race finished";
    case "event_lobby":
      return `${event.name} starts in ${formatCountdown(event.starts_in_s)} · J to join`;
    case "event_started":
      // A race already announces itself with race_started.
      return event.event_kind === "race" ? null : "Event started — go!";
    case "event_finished": {
      if (event.event_kind === "race") return null;
      if (event.event_kind !== "group_ride") return "Event finished";
      const giver = event.results.reduce((top, r) => (r.given_kj > (top?.given_kj ?? 0) ? r : top), null);
      return giver && giver.given_kj >= 1
        ? `Event finished · thanks ${giver.name} for sharing ${Math.round(giver.given_kj)} kJ`
        : "Event finished";
    }
    case "vehicle_boarded":
      return myVehicleId !== null && event.vehicle_id === myVehicleId ? `${who(event.rider_id, event.name)} boarded` : null;
    case "vehicle_left":
      return myVehicleId !== null && event.vehicle_id === myVehicleId ? `${who(event.rider_id, event.name)} left` : null;
    case "captain_changed":
      if (myVehicleId === null || event.vehicle_id !== myVehicleId) return null;
      return event.rider_id === myId ? "You are now the captain" : `${event.name} is now the captain`;
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
  badge.title = "Rides with phone paddles";
  return badge;
}

/** "Anna (bot)", "Ben 📱" for plain-text lists. */
export function riderName(rider) {
  if (rider.is_bot) return `${rider.name} (bot)`;
  return isPaddler(rider) ? `${rider.name} ${PADDLE_BADGE}` : rider.name;
}

export function renderRiderList(list, entries, myId) {
  list.replaceChildren(
    ...entries.map(({ rider, gap, routeName }) => {
      const item = element("li", rider.id === myId ? "rider me" : "rider");
      const name = element("span", "rider-name", rider.name);
      if (rider.is_bot) name.append(element("span", "badge", "bot"));
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
      if (result.is_bot) name.append(element("span", "badge", "bot"));
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
