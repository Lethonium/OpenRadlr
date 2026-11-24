/**
 * Bookkeeping of what a scene creates: every geometry, material, texture and
 * light is tracked, and a test can check that disposing the scene frees them
 * all. Resources are wrapped, not copied: disposing one marks it freed.
 */

/**
 * @typedef {object} Tracker
 * @property {<T extends {dispose: () => void}>(resource: T) => T} track registers a resource and returns it
 * @property {() => number} live how many tracked resources are not disposed yet
 * @property {() => void} disposeAll disposes whatever is still live
 */

/**
 * A new, empty tracker.
 * @returns {Tracker}
 */
export function createTracker() {
  const live = new Set();
  return {
    track(resource) {
      if (live.has(resource)) return resource;
      live.add(resource);
      const dispose = resource.dispose.bind(resource);
      resource.dispose = () => {
        live.delete(resource);
        dispose();
      };
      return resource;
    },
    live: () => live.size,
    disposeAll() {
      for (const resource of [...live]) resource.dispose();
    },
  };
}

/**
 * What one layer owns: it tracks each resource it makes and frees them all
 * with `disposeAll()`, so a layer's `dispose()` is one line.
 * @param {Tracker["track"]} track
 * @returns {{own: Tracker["track"], disposeAll: () => void}}
 */
export function createOwner(track) {
  const owned = [];
  return {
    own(resource) {
      owned.push(track(resource));
      return resource;
    },
    disposeAll() {
      for (const resource of owned.splice(0)) resource.dispose();
    },
  };
}
