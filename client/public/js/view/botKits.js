/**
 * Bot teams' kit colours (#64). The server sends each bot's `team`; its jersey
 * takes the team's colour in the 3D view. None is orange (me) or sky blue
 * (humans), so bots still read as bots. Unknown teams keep the bot grey.
 */
export const TEAM_KITS = Object.freeze({
  zitrone: "#f2cf2a",
  moos: "#4f8f3a",
  kirsche: "#b3263a",
  lavendel: "#8c6bc8",
  kreide: "#ecebe4",
  schiefer: "#2f3339",
  petrol: "#1f7f7a",
  rose: "#e58fb2",
});

/** A bot's kit colour (`#rrggbb`), or null for humans and unknown teams. */
export function botKit(rider) {
  return (rider?.is_bot && Object.hasOwn(TEAM_KITS, rider.team) && TEAM_KITS[rider.team]) || null;
}
