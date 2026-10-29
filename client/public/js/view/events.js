import { formatDistanceWithUnit, formatDuration } from "../util/format.js";
import { getLocale, t, tn } from "../i18n/i18n.js";

/** Pure helpers for scheduled events: the menu list, lobby banner, power sharing and results. */

const ICONS = { race: "🏁", group_ride: "👥" };

/** Seconds → "12:40" / "1:02:05"; negative counts as zero. */
export const formatCountdown = (seconds) => formatDuration(seconds);

/**
 * Rows for the events list from /api/info, sorted by start. Times are shifted by
 * the difference between the server clock and ours so server time counts.
 * @param {object} info
 * @param {number} nowMs
 * @param {{locale?: string, timeZone?: string}} format
 * @param {string | null} enteredId the event I'm entered in, if any
 */
export function eventRows(info, nowMs = Date.now(), { locale, timeZone } = {}, enteredId = null) {
  const clock = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", hour12: false, hourCycle: "h23", timeZone });
  const skewMs = info.now_s * 1000 - nowMs;
  const label = (seconds) => clock.format(new Date(seconds * 1000 - skewMs));
  const routeNames = new Map((info.routes ?? []).map((route) => [route.id, route.name]));
  return [...(info.events ?? [])]
    .sort((a, b) => a.starts_at_s - b.starts_at_s)
    .map((event) => ({
      id: event.id,
      icon: ICONS[event.kind] ?? ICONS.race,
      name: event.name,
      routeId: event.route_id,
      routeName: routeNames.get(event.route_id) ?? event.route_id,
      startLabel: label(event.starts_at_s),
      countdown: event.phase === "running" ? t("events.running") : t("events.in", { time: formatCountdown(event.starts_at_s - info.now_s) }),
      entrants: event.entrants,
      entered: event.id === enteredId,
      joinable: event.id !== enteredId && (event.phase === "lobby" || (event.phase === "running" && event.kind === "group_ride")),
      note: event.phase === "upcoming" ? t("events.lobbyOpens", { time: label(event.lobby_opens_at_s) }) : "",
    }));
}

/** The lobby line shown while an event waits to start, or null. */
export function eventBanner(event) {
  if (!event || event.phase !== "lobby") return null;
  const kind = { race: t("events.kind.race"), group_ride: t("events.kind.groupRide") }[event.kind] ?? t("events.kind.event");
  return t("events.banner", { kind, time: formatCountdown(event.starts_in_s), action: event.entered ? t("events.youreIn") : t("events.jToJoin") });
}

/** Power given to or received from the group, "" when negligible. */
export function sharingLine(sharing) {
  if (!sharing) return "";
  if (sharing.given_w >= 5) return t("events.sharing.given", { w: Math.round(sharing.given_w), to: sharing.to.join(", ") });
  if (sharing.received_w >= 5) return t("events.sharing.received", { w: Math.round(sharing.received_w), from: sharing.from.join(", ") });
  return "";
}

/** Time gap to the middle of the group (positive is ahead); "" when unknown. */
export function groupGapLine(gapS) {
  if (!Number.isFinite(gapS)) return "";
  if (Math.abs(gapS) < 5) return t("events.withGroup");
  const time = formatCountdown(Math.round(Math.abs(gapS)));
  return t(gapS > 0 ? "events.ahead" : "events.behind", { time });
}

export function eventRideName(kind, routeName) {
  return `OpenRadlr ${kind === "race" ? "race" : "group ride"} · ${routeName}`; // i18n-ok (ride name in exported files)
}

/** One text line per result. */
export function eventResultRows(results, kind, myId) {
  return results.map((result) => {
    const name = result.rider_id === myId ? t("panels.you") : `${result.name}${result.is_bot ? ` ${t("panels.botSuffix")}` : ""}`;
    const wkg = `${result.avg_wkg.toFixed(1)} W/kg`;
    if (kind === "race") {
      return result.place === undefined || result.place === null ? t("events.dnf", { name }) : `#${result.place} ${name} · ${formatDuration(result.time_s)} · ${wkg}`;
    }
    const parts = [name, formatDistanceWithUnit(result.distance_m, 1), wkg];
    if (result.given_kj >= 1) parts.push(t("events.gave", { kj: Math.round(result.given_kj) }));
    return parts.join(" · ");
  });
}

function eventDetail(row) {
  const riders = tn("events.entered", row.entrants);
  return [row.routeName, `${row.startLabel} (${row.countdown})`, riders, row.note].filter(Boolean).join(" · ");
}

/** Writes the events list; `onJoin(row)` runs for the Join button of a joinable row, `onLeave(row)` for the Leave button of the one I'm in. Text only: names come from the server. */
export function renderEventList(list, rows, onJoin, onLeave) {
  // Same events as before: only refresh the texts, so focus and clicks survive.
  const key = rows.map((row) => [row.id, row.name, row.routeId, row.joinable, row.entered, getLocale()].join("|")).join("\n");
  if (list.dataset.key === key) {
    rows.forEach((row, i) => (list.children[i].querySelector(".muted").textContent = eventDetail(row)));
    return;
  }
  list.dataset.key = key;
  list.replaceChildren(
    ...rows.map((row) => {
      const item = document.createElement("li");
      item.className = "event-row";
      const text = document.createElement("span");
      text.className = "event-text";
      const title = document.createElement("strong");
      title.textContent = `${row.icon} ${row.name}`;
      const detail = document.createElement("span");
      detail.className = "muted";
      detail.textContent = eventDetail(row);
      text.append(title, detail);
      item.append(text);
      if (row.entered) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "secondary";
        button.textContent = t("events.leave");
        button.title = t("events.youreIn");
        button.addEventListener("click", () => onLeave(row));
        item.append(button);
      } else if (row.joinable) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "primary-small";
        button.textContent = t("events.join");
        button.addEventListener("click", () => onJoin(row));
        item.append(button);
      }
      return item;
    }),
  );
}
