/**
 * Where to join the route, from `?at=<metres>`: a distance along the road, so a
 * screenshot can be taken at a chosen spot without riding there first. Returns
 * `null` when the address does not ask for one, or asks for something unusable.
 */
export function joinAtMetres(search) {
  const param = new URLSearchParams(search).get("at");
  if (param === null || param.trim() === "") return null;
  const metres = Number(param);
  return Number.isFinite(metres) && metres >= 0 ? metres : null;
}
