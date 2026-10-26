/**
 * Moving the keyboard focus without a keyboard: controllers step through the
 * buttons and fields of whatever is in front (start screen, menu, dialog) and
 * "select" clicks the focused one.
 */

const FOCUSABLE = 'button, a[href], input, select, textarea, summary, [tabindex]:not([tabindex="-1"])';

const isShown = (element) => !element.closest("[hidden]") && element.getClientRects().length > 0;

/**
 * Focusable, enabled and visible elements inside `root`, in document order.
 * Elements marked `data-gesture-only` are skipped: they open a browser prompt
 * (e.g. the Bluetooth picker), which only a real tap or click may do.
 */
export function focusableIn(root, isVisible = isShown) {
  return [...root.querySelectorAll(FOCUSABLE)].filter((element) => !element.disabled && element.dataset?.gestureOnly === undefined && isVisible(element));
}

/**
 * Focuses the next (+1) or previous (−1) element inside `root`, wrapping
 * around. Starts at the first (or last) element if focus is elsewhere.
 * @returns {Element | null} the newly focused element
 */
export function moveFocus(root, direction, { doc = document, isVisible = isShown } = {}) {
  const elements = focusableIn(root, isVisible);
  if (elements.length === 0) return null;
  const index = elements.indexOf(doc.activeElement);
  const next = index < 0 ? (direction > 0 ? 0 : elements.length - 1) : (index + direction + elements.length) % elements.length;
  const element = elements[next];
  element.focus({ focusVisible: true });
  element.scrollIntoView?.({ block: "nearest" });
  return element;
}

/** Clicks the focused element if it is inside `root`. */
export function activateFocused(root, { doc = document } = {}) {
  const element = doc.activeElement;
  if (!element || element === doc.body || !root.contains(element)) return false;
  element.click();
  return true;
}
