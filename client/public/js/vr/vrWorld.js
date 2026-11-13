/**
 * Which world the VR page draws: the host's rider's. Pure decisions plus a
 * builder that always keeps only the newest request.
 */
import { Emitter } from "../util/emitter.js";

/** The host's rider among `riders`, or null while its id is unknown or it is not in the list. */
export function pickHost(riders, riderId) {
  if (riderId === null || riderId === undefined) return null;
  return riders?.find((rider) => rider.id === riderId) ?? null;
}

/**
 * The world a relayed message asks for: the host's route, or the studio.
 * Null keeps the current world: the host is unknown, not in the message, or off every route.
 * @returns {{kind: "route", routeId: string} | {kind: "studio"} | null}
 */
export function worldWanted(message, riderId) {
  if (riderId === null || riderId === undefined) return null;
  if (message.type === "studio_state") return { kind: "studio" };
  const host = pickHost(message.riders, riderId);
  return host?.route ? { kind: "route", routeId: host.route } : null;
}

const keyOf = (wanted) => (wanted.kind === "route" ? `route:${wanted.routeId}` : "studio");

/**
 * Builds the wanted world and emits "world" with it (and "failed" with the
 * error). A want equal to the current one does nothing; a newer want wins
 * over a build still in flight, whose result is dropped.
 */
export class VrWorld extends Emitter {
  #current = null;
  #build = 0;

  /** @param {{buildRouteWorld: (routeId: string) => Promise<object>, buildStudioWorld: () => Promise<object>}} deps */
  constructor({ buildRouteWorld, buildStudioWorld }) {
    super();
    Object.assign(this, { buildRouteWorld, buildStudioWorld });
  }

  want(wanted) {
    if (!wanted) return;
    const key = keyOf(wanted);
    if (key === this.#current) return;
    this.#current = key;
    const build = ++this.#build;
    const made = wanted.kind === "route" ? this.buildRouteWorld(wanted.routeId) : this.buildStudioWorld();
    made.then(
      (world) => {
        if (build === this.#build) this.emit("world", world);
      },
      (error) => {
        if (build === this.#build) this.emit("failed", error);
      },
    );
  }
}
