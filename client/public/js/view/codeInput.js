// The pairing code entry: six boxes in the app's input style, one status line. DOM, document and
// text lookup are injected. The pure parts (cleaning, grouping, the state reducer, the countdown
// share) are exported on their own.
export const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const CODE_LENGTH = 6;

/** Upper-cases, drops every character outside the alphabet and keeps the first six. */
export function cleanCode(text) {
  return [...String(text ?? "").toUpperCase()].filter((ch) => CODE_ALPHABET.includes(ch)).slice(0, CODE_LENGTH).join("");
}

/** "ABC234" shown as "ABC 234". */
export const groupCode = (code) => `${code.slice(0, 3)} ${code.slice(3)}`.trim();

/** idle -> connecting -> (paired | invalid | offline) -> idle on edit. */
export function codeEntryState(event, state) {
  if (event.type === "submit") return "connecting";
  if (event.type === "claimed") return "paired";
  if (event.type === "failed") return event.code === "pair_code_invalid" ? "invalid" : "offline";
  if (event.type === "edit" && (state === "invalid" || state === "offline")) return "idle";
  return state;
}

/** How much of a code's life is left, from 1 (just issued) to 0 (expired). */
export const countdownShare = (expiresAtS, nowS, ttlS = 300) => Math.min(1, Math.max(0, (expiresAtS - nowS) / ttlS));

const STATE_TEXT = { connecting: "screens.connecting", paired: "screens.claimed", invalid: "screens.codeInvalid", offline: "screens.cannotConnect" };

/**
 * Builds the entry inside `root`. `onSubmit(code)` returns a promise that rejects with the server's
 * `code` set when the code was refused. Returns { focus, reset }.
 */
export function mountCodeInput(root, { onSubmit, t, doc = root.ownerDocument }) {
  const group = doc.createElement("div");
  group.className = "code-boxes";
  group.setAttribute("role", "group");
  group.setAttribute("aria-label", t("screens.codeLabel"));
  const status = doc.createElement("p");
  status.className = "hint code-status";
  status.setAttribute("role", "status");
  const boxes = Array.from({ length: CODE_LENGTH }, (_, i) => {
    const box = doc.createElement("input");
    box.className = "code-box";
    box.setAttribute("type", "text");
    box.setAttribute("autocomplete", "off");
    box.setAttribute("autocapitalize", "characters");
    box.setAttribute("spellcheck", "false");
    box.setAttribute("inputmode", "text");
    box.setAttribute("aria-label", t("screens.codeBox", { n: i + 1 }));
    return box;
  });
  group.append(...boxes);
  root.append(group, status);

  let state = "idle";
  const step = (event) => {
    state = codeEntryState(event, state);
    status.textContent = STATE_TEXT[state] ? t(STATE_TEXT[state]) : "";
  };
  const code = () => boxes.map((b) => b.value).join("");

  async function submit() {
    step({ type: "submit" });
    try {
      await onSubmit(code());
      step({ type: "claimed" });
    } catch (error) {
      step({ type: "failed", code: error?.code });
    }
  }

  /** Writes `text` into the boxes from `start` on; returns the index after the last one filled. */
  function fill(start, text) {
    const chars = [...cleanCode(text)];
    chars.forEach((ch, k) => {
      if (boxes[start + k]) boxes[start + k].value = ch;
    });
    return Math.min(start + chars.length, CODE_LENGTH - 1);
  }

  const settle = (focusIndex) => {
    boxes[focusIndex].focus();
    if (code().length === CODE_LENGTH && state !== "connecting") submit();
  };

  boxes.forEach((box, i) => {
    box.addEventListener("input", () => {
      const typed = box.value;
      box.value = "";
      step({ type: "edit" });
      const clean = cleanCode(typed);
      if (!clean) return;
      const last = fill(i, clean);
      settle(clean.length > 1 || i === CODE_LENGTH - 1 ? last : i + 1);
    });
    box.addEventListener("paste", (event) => {
      event.preventDefault();
      step({ type: "edit" });
      const text = cleanCode(event.clipboardData?.getData("text") ?? "");
      if (!text) return;
      boxes.forEach((b) => (b.value = ""));
      settle(fill(0, text));
    });
    box.addEventListener("keydown", (event) => {
      if (event.key !== "Backspace" /* i18n-ok */ || box.value || i === 0) return;
      event.preventDefault();
      boxes[i - 1].value = "";
      step({ type: "edit" });
      boxes[i - 1].focus();
    });
  });

  return {
    focus: () => boxes[0].focus(),
    reset() {
      boxes.forEach((b) => (b.value = ""));
      state = "idle";
      status.textContent = "";
    },
  };
}

/**
 * The "Pair now" part of the cockpit and VR pages: a button that opens the code entry in place.
 * `pair(code)` claims the code; `onPaired()` runs after it worked (the page reloads).
 */
export function mountPairNow({ button, entry, pair, onPaired, t, doc }) {
  let mounted = null;
  button.addEventListener("click", () => {
    entry.hidden = false;
    mounted ??= mountCodeInput(entry, {
      t,
      doc,
      onSubmit: async (code) => {
        await pair(code);
        onPaired();
      },
    });
    mounted.focus();
  });
}
