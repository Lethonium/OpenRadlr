/**
 * Keyboard controls. Every input device (keyboard, on-screen buttons and
 * controllers such as a Zwift Click, see input/controller.js) produces the same action names,
 * so the game only handles actions, never devices (see docs/devices.md).
 */

export const KEY_BINDINGS = Object.freeze({
  ArrowLeft: "laneLeft",
  KeyA: "laneLeft",
  ArrowRight: "laneRight",
  KeyD: "laneRight",
  ArrowUp: "powerUp",
  KeyW: "powerUp",
  ArrowDown: "powerDown",
  KeyS: "powerDown",
  KeyE: "shiftUp",
  Equal: "shiftUp",
  NumpadAdd: "shiftUp",
  KeyQ: "shiftDown",
  Minus: "shiftDown",
  NumpadSubtract: "shiftDown",
  KeyV: "toggleView",
  KeyC: "cycleCamera",
  KeyT: "cycleTime",
  KeyL: "cycleLayout",
  KeyJ: "toggleRace",
  KeyM: "toggleMenu",
  KeyP: "takePhoto",
  Space: "togglePause",
  Escape: "closePanels",
});

/** Maps a keyboard event to an action name, ignoring typing in form fields. */
export function actionForKey(event) {
  const tag = event.target?.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return null;
  if (event.altKey || event.ctrlKey || event.metaKey) return null;
  // Space presses a focused button; it must not also pause.
  if (tag === "BUTTON" && event.code === "Space") return null;
  return KEY_BINDINGS[event.code] ?? null;
}

/**
 * Listens for key presses and calls the matching handler.
 * @param {EventTarget} target usually `window`
 * @param {Record<string, () => void>} handlers
 * @returns {() => void} function that removes the listener
 */
export function bindKeyboard(target, handlers) {
  const listener = (event) => {
    const action = actionForKey(event);
    // Holding Space must not flip the pause back and forth.
    if (event.repeat && action === "togglePause") return;
    if (action && handlers[action]) {
      event.preventDefault();
      handlers[action]();
    }
  };
  target.addEventListener("keydown", listener);
  return () => target.removeEventListener("keydown", listener);
}
