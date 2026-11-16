/**
 * Loads the scenery kits a rider picked (#117).
 *
 * The kits live under `assets/scenery/` as a manifest per kit and one file per
 * model. They are fetched once and kept, so switching scenery on and off, or
 * moving between routes, does not download them again.
 *
 * A kit that fails to load is not fatal: the ride falls back to the biome's own
 * trees, which is exactly the world every rider had before.
 */

/** Where the kits are served from. */
const KITS_PATH = "assets/scenery";

/**
 * The kits a scenery level uses. `off` uses none; `models` is the modelled
 * world; `racing` keeps Kenney's Racing Kit beside it, since a racing island
 * with barriers and flags on the verges is a different look worth trying.
 */
export const KITS_OF = Object.freeze({ off: [], models: ["nature"], racing: ["racing"] });

/** What the worker needs: manifests with their models inlined, since functions cannot travel. */
let loaded = null;

/** Fetches a kit's manifest and every model it names. */
export async function loadKit(name, { fetchJson = defaultFetchJson } = {}) {
  const manifest = await fetchJson(`${KITS_PATH}/${name}/manifest.json`);
  const files = {};
  for (const model of Object.values(manifest.models ?? {})) {
    const id = model.file ?? model.near;
    if (!id || files[id]) continue;
    files[id] = await fetchJson(`${KITS_PATH}/${name}/${id}.geo.json`);
  }
  return { ...manifest, name, files };
}

/**
 * The scenery settings for `buildScene`, or `null` when no kit is wanted or the
 * kit could not be loaded.
 */
export async function loadScenery(level, { fetchJson = defaultFetchJson, nearRange = 150 } = {}) {
  const names = KITS_OF[level] ?? [];
  if (names.length === 0) return null;
  if (loaded?.level === level) return { kits: loaded.kits, nearRange };
  try {
    const kits = await Promise.all(names.map((name) => loadKit(name, { fetchJson })));
    loaded = { level, kits };
    return { kits, nearRange };
  } catch (error) {
    console.warn("Scenery could not be loaded, keeping the woods as they are:", error);
    return null;
  }
}

async function defaultFetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  return response.json();
}

/** Forgets the loaded kits (tests, and a build that went stale). */
export function forgetScenery() {
  loaded = null;
}
