import { test } from "node:test";
import assert from "node:assert/strict";
import { createPinDialog } from "../public/js/view/pinDialog.js";

const fakeEl = (extra = {}) => {
  const handlers = {};
  return {
    hidden: true,
    value: "",
    textContent: "",
    disabled: false,
    focused: 0,
    addEventListener(type, handler) {
      handlers[type] = handler;
    },
    fire(type, event = {}) {
      return handlers[type]?.({ preventDefault() {}, target: this, ...event });
    },
    focus() {
      this.focused += 1;
    },
    ...extra,
  };
};

const setup = () => {
  const els = {
    root: fakeEl(),
    form: fakeEl(),
    title: fakeEl(),
    hint: fakeEl(),
    input: fakeEl(),
    error: fakeEl(),
    cancel: fakeEl(),
    go: fakeEl(),
  };
  const pushed = [];
  const stack = {
    push(panel) {
      pushed.push(panel);
      return () => pushed.splice(pushed.indexOf(panel), 1);
    },
  };
  return { els, pushed, dialog: createPinDialog({ els, stack, doc: { activeElement: null } }) };
};

test("ask_shows_the_texts_and_puts_the_focus_in_the_input", async () => {
  const { els, dialog } = setup();
  const answer = dialog.ask({ title: "PIN for Anna", hint: "Enter it", action: "Open" });
  assert.equal(els.root.hidden, false);
  assert.equal(els.title.textContent, "PIN for Anna");
  assert.equal(els.hint.textContent, "Enter it");
  assert.equal(els.hint.hidden, false);
  assert.equal(els.go.textContent, "Open");
  assert.equal(els.input.focused, 1);
  assert.equal(dialog.isOpen, true);
  els.cancel.fire("click");
  assert.equal(await answer, null);
});

test("ask_without_a_hint_hides_the_hint_line", async () => {
  const { els, dialog } = setup();
  const answer = dialog.ask({ title: "PIN", action: "Open" });
  assert.equal(els.hint.hidden, true);
  els.cancel.fire("click");
  await answer;
});

test("a_pin_the_check_accepts_resolves_with_it_and_closes_the_dialog", async () => {
  const { els, dialog } = setup();
  const answer = dialog.ask({ title: "PIN", action: "Open" });
  els.input.value = "1234";
  await els.form.fire("submit");
  assert.equal(await answer, "1234");
  assert.equal(els.root.hidden, true);
  assert.equal(els.input.value, "");
  assert.equal(dialog.isOpen, false);
});

test("a_pin_the_check_refuses_shows_its_problem_and_stays_open_with_an_empty_input", async () => {
  const { els, dialog } = setup();
  const answer = dialog.ask({ title: "PIN", action: "Open", check: async (pin) => (pin === "1234" ? null : "Wrong PIN") });
  els.input.value = "0000";
  await els.form.fire("submit");
  assert.equal(els.error.hidden, false);
  assert.equal(els.error.textContent, "Wrong PIN");
  assert.equal(els.input.value, "");
  assert.equal(els.root.hidden, false);
  els.input.value = "1234";
  await els.form.fire("submit");
  assert.equal(await answer, "1234");
});

test("a_check_that_throws_shows_the_failed_text", async () => {
  const { els, dialog } = setup();
  const answer = dialog.ask({
    title: "PIN",
    action: "Open",
    failed: "Could not check the PIN",
    check: async () => {
      throw new Error("no crypto");
    },
  });
  els.input.value = "1234";
  await els.form.fire("submit");
  assert.equal(els.error.textContent, "Could not check the PIN");
  assert.equal(els.root.hidden, false);
  els.cancel.fire("click");
  assert.equal(await answer, null);
});

test("cancel_resolves_null_and_clears_what_was_typed", async () => {
  const { els, dialog } = setup();
  const answer = dialog.ask({ title: "PIN", action: "Open" });
  els.input.value = "12";
  els.cancel.fire("click");
  assert.equal(await answer, null);
  assert.equal(els.input.value, "");
  assert.equal(els.root.hidden, true);
});

test("the_panel_stack_closes_the_dialog_like_cancel_does", async () => {
  const { dialog, pushed } = setup();
  const answer = dialog.ask({ title: "PIN", action: "Open" });
  assert.equal(pushed.length, 1);
  pushed[0].close();
  assert.equal(await answer, null);
  assert.equal(pushed.length, 0);
});

test("typing_keeps_only_digits", async () => {
  const { els, dialog } = setup();
  const answer = dialog.ask({ title: "PIN", action: "Open" });
  els.input.value = "12a 4";
  els.input.fire("input");
  assert.equal(els.input.value, "124");
  els.cancel.fire("click");
  await answer;
});

test("a_second_ask_closes_the_first_with_null", async () => {
  const { els, dialog } = setup();
  const first = dialog.ask({ title: "A", action: "Open" });
  const second = dialog.ask({ title: "B", action: "Open" });
  assert.equal(await first, null);
  assert.equal(els.title.textContent, "B");
  els.input.value = "1111";
  await els.form.fire("submit");
  assert.equal(await second, "1111");
});