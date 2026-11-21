/**
 * Setting, changing and removing a rider's PIN (#114) as conversations with the PIN card.
 * `ask` is the card's `ask` (view/pinDialog.js): it resolves to an accepted PIN, or null when
 * the rider backs out, and keeps the card open while `check` returns a problem. Each flow
 * resolves to the new roster, or null when the rider backed out or the change was refused.
 * Nothing here saves; the caller does. All texts come in through `texts`.
 */

import { isValidPin } from "./pin.js";
import { changePin, removePin, setPin, unlock } from "./pinLock.js";

/** A new PIN, typed twice. Null when the rider backs out at either step. */
async function askNewPin({ ask, texts }) {
  const first = await ask({
    title: texts.newTitle,
    hint: texts.newHint,
    action: texts.next,
    failed: texts.failed,
    check: async (pin) => (isValidPin(pin) ? null : texts.invalid),
  });
  if (first === null) return null;
  const again = await ask({
    title: texts.confirmTitle,
    hint: texts.confirmHint,
    action: texts.save,
    failed: texts.failed,
    check: async (pin) => (pin === first ? null : texts.mismatch),
  });
  return again === null ? null : first;
}

/** The rider's current PIN, checked. Null when the rider backs out. */
const askCurrentPin = ({ roster, id, ask, deps, texts, title, action }) =>
  ask({
    title,
    action,
    failed: texts.failed,
    check: async (pin) => ((await unlock(roster, id, pin, deps)) ? null : texts.wrong),
  });

export async function setPinFlow({ roster, id, ask, deps, texts }) {
  const pin = await askNewPin({ ask, texts });
  return pin === null ? null : setPin(roster, id, pin, deps);
}

export async function changePinFlow({ roster, id, ask, deps, texts }) {
  const current = await askCurrentPin({ roster, id, ask, deps, texts, title: texts.currentTitle, action: texts.next });
  if (current === null) return null;
  const pin = await askNewPin({ ask, texts });
  return pin === null ? null : changePin(roster, id, current, pin, deps);
}

export async function removePinFlow({ roster, id, ask, deps, texts }) {
  const current = await askCurrentPin({ roster, id, ask, deps, texts, title: texts.removeTitle, action: texts.remove });
  return current === null ? null : removePin(roster, id, current, deps);
}
