/**
 * The card that asks for a rider's PIN (#114), over the start menu. It reuses the delete
 * confirmation's pattern: the DOM elements, the panel stack (Esc) and the document are
 * injected. `ask` resolves to the typed PIN, to null when the rider backs out, or to
 * PIN_FORGOTTEN when they chose the forgot link (only shown when the caller gives it a text).
 * The caller's `check(pin)` returns a problem text to keep the card open (a wrong PIN), or
 * null to accept; the PIN itself never leaves this function except as the answer.
 */

/** The answer when the rider says they forgot the PIN. */
export const PIN_FORGOTTEN = Symbol("pin forgotten");

/**
 * @param {{els: Record<"root" | "form" | "title" | "hint" | "input" | "error" | "cancel" | "forgot" | "go", any>, stack: {push: (panel: {close: () => void}) => () => void}, doc?: Document, fallbackFocus?: () => any}} options
 */
export function createPinDialog({ els, stack, doc = globalThis.document, fallbackFocus = () => null }) {
  let current = null;

  // While the check runs, backing out would hide whether the PIN was accepted.
  let busy = false;

  function finish(answer) {
    if (!current || busy) return;
    const { resolve, remove, opener } = current;
    current = null;
    remove();
    els.root.hidden = true;
    els.input.value = "";
    if (answer === null || answer === PIN_FORGOTTEN) (opener?.isConnected ? opener : fallbackFocus())?.focus();
    resolve(answer);
  }

  // A numeric keypad types digits only; a pasted PIN keeps just its digits.
  els.input.addEventListener("input", () => {
    els.input.value = els.input.value.replace(/\D/g, "");
  });
  els.cancel.addEventListener("click", () => finish(null));
  els.forgot.addEventListener("click", () => finish(PIN_FORGOTTEN));
  els.root.addEventListener("click", (event) => {
    if (event.target === els.root) finish(null);
  });
  els.form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!current || busy) return;
    const asked = current;
    const pin = els.input.value;
    busy = true;
    els.go.disabled = true;
    let problem;
    try {
      problem = await asked.check(pin);
    } catch {
      problem = asked.failed;
    }
    busy = false;
    els.go.disabled = false;
    if (current !== asked) return;
    if (problem) {
      els.error.textContent = problem;
      els.error.hidden = false;
      els.input.value = "";
      els.input.focus();
      return;
    }
    finish(pin);
  });

  return {
    /** Shows the card; resolves to the accepted PIN, null when the rider backed out, or PIN_FORGOTTEN. */
    ask({ title, hint = "", action, check = async () => null, failed = "", forgot = "" }) {
      finish(null);
      return new Promise((resolve) => {
        current = { check, failed, resolve, opener: doc.activeElement, remove: stack.push({ close: () => finish(null) }) };
        els.title.textContent = title;
        els.hint.textContent = hint;
        els.hint.hidden = hint === "";
        els.forgot.textContent = forgot;
        els.forgot.hidden = forgot === "";
        els.go.textContent = action;
        els.error.hidden = true;
        els.error.textContent = "";
        els.input.value = "";
        els.root.hidden = false;
        els.input.focus();
      });
    },
    get isOpen() {
      return current !== null;
    },
  };
}