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
 * (e.g. the Bluetooth picker), which only a real tap or click may do. So is
 * small print marked `data-nav-skip` (the build label, the privacy link).
 */
export function focusableIn(root, isVisible = isShown) {
  return [...root.querySelectorAll(FOCUSABLE)].filter((element) => !element.disabled && element.dataset?.gestureOnly === undefined && element.dataset?.navSkip === undefined && isVisible(element));
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
  let next = index < 0 ? (direction > 0 ? 0 : elements.length - 1) : (index + direction + elements.length) % elements.length;
  // Focus on an element controllers skip (e.g. the button just clicked to pair): go on from its place.
  if (index < 0) {
    const all = [...root.querySelectorAll(FOCUSABLE)];
    const at = all.indexOf(doc.activeElement);
    if (at >= 0) {
      const after = elements.findIndex((element) => all.indexOf(element) > at);
      if (direction > 0) next = after < 0 ? 0 : after;
      else next = (after < 0 ? elements.length : after) - 1;
      if (next < 0) next = elements.length - 1;
    }
  }
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
