const STORAGE_KEY = "openradlr.pairedScreens";
const MAX_SCREENS = 20;

/** The screens this tablet has paired, newest last; only for showing a list. */
export class PairedScreens {
  #storage;

  constructor(storage) {
    this.#storage = storage;
  }

  /** @returns {{ device: string, pairedAt: number }[]} */
  list() {
    try {
      const list = JSON.parse(this.#storage?.getItem(STORAGE_KEY) ?? "[]");
      return Array.isArray(list) ? list.filter((e) => typeof e?.device === "string" && Number.isFinite(e.pairedAt)) : [];
    } catch {
      return [];
    }
  }

  /** One entry per device name: pairing a device again replaces its entry with the new date. */
  add(device, nowMs) {
    this.#save([...this.list().filter((e) => e.device !== device), { device, pairedAt: nowMs }].slice(-MAX_SCREENS));
  }

  clear() {
    this.#storage?.removeItem(STORAGE_KEY);
  }

  #save(list) {
    this.#storage?.setItem(STORAGE_KEY, JSON.stringify(list));
  }
}

/** The indexes of `list` whose device name is among the `watching` names. Equal names are all live. */
export function liveDevices(list, watching) {
  const names = new Set(watching);
  return new Set(list.flatMap((entry, index) => (names.has(entry.device) ? [index] : [])));
}
