/**
 * Loads the route the host's rider is on, for the cockpit's map and profile
 * tiles: once per route, dropping an answer that arrives after the rider
 * moved on. A failed load waits for the next route change.
 */
import { RouteGeometry } from "../route/geometry.js";

export class RouteFollower {
  #fetchRoute;
  #onRoute;
  #wanted = null;

  /**
   * @param {{fetchRoute: (id: string) => Promise<object>, onRoute: (route: RouteGeometry) => void}} deps
   *   fetchRoute resolves to a route file
   */
  constructor({ fetchRoute, onRoute }) {
    this.#fetchRoute = fetchRoute;
    this.#onRoute = onRoute;
  }

  /** The rider's route id; null (studio, own road) keeps what is loaded. */
  follow(id) {
    if (!id || id === this.#wanted) return;
    this.#wanted = id;
    this.#fetchRoute(id).then(
      (file) => {
        if (this.#wanted === id) this.#onRoute(new RouteGeometry(file));
      },
      (error) => console.warn(`cockpit: route ${id} did not load`, error), // i18n-ok (console)
    );
  }
}
