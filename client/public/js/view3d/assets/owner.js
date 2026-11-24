/**
 * What one maker owns: it registers each resource it creates (with a scene's
 * tracker, if given) and frees them all with `disposeAll()`, so its own
 * `dispose()` is one line. Shared by plant assets and scene layers.
 */

/**
 * @param {(resource: any) => any} [track] called on every resource first (a scene's tracker registers them)
 * @returns {{own: <T>(resource: T) => T, disposeAll: () => void}}
 */
export function createOwner(track = (resource) => resource) {
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
