/**
 * Riders that other apps share through OpenBikeNet. The server sends them as
 * ordinary riders with an `app` (the other app's id); their names come from
 * outside, so every view writes them with textContent only.
 */

/** True for a rider who is on another app. */
export const isRemote = (rider) => typeof rider?.app === "string" && rider.app !== "";

/** "Ben · incyclist" for a remote rider, "Anna (bot)" for a bot, the name otherwise. */
export function riderLabel(rider, t) {
  if (isRemote(rider)) return `${rider.name} · ${rider.app}`;
  return rider.is_bot ? `${rider.name} ${t("panels.botSuffix")}` : rider.name;
}
