/**
 * The ride stores of one rider (#112): the autosave, the ride history and the ghost laps,
 * each over an IndexedDB named for that rider alone. The stores are pinned to the rider at
 * construction, because their operations span awaits — a lap is offered with a read and a
 * write, the finish saves and then reads back — and the active rider can change while such
 * an operation is out (the rider finished, returned to the menu and another one rides).
 * A store built for a rider keeps that rider's databases for good, so the start menu builds
 * these for the active rider and builds them again whenever it changes.
 */

import { RideAutosave, indexedDbStore } from "./rideAutosave.js";
import { RideHistory } from "./rideHistory.js";
import { GhostStore } from "./ghostLap.js";
import { riderDbName } from "../profile/riderStorage.js";

/**
 * The autosave, history and ghosts of rider `riderId`, each pinned to the databases
 * named for them (main's are unprefixed, see profile/riderStorage.js).
 * @param {string} riderId
 * @param {{idb?: IDBFactory}} [options]
 */
export function rideStores(riderId, { idb = globalThis.indexedDB } = {}) {
  const store = (base) => indexedDbStore(riderDbName(base, riderId), { idb });
  return {
    autosave: new RideAutosave({ store: store("openradlr-autosave") }),
    history: new RideHistory({ store: store("openradlr-history") }),
    ghosts: new GhostStore({ store: store("openradlr-ghosts") }),
  };
}
