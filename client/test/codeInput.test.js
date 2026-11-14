import { test } from "node:test";
import assert from "node:assert/strict";
import { CODE_ALPHABET, cleanCode, codeEntryState, countdownShare, groupCode, mountCodeInput, mountPairNow } from "../public/js/view/codeInput.js";

test("the alphabet leaves out the look-alikes", () => {
  assert.equal(CODE_ALPHABET, "ABCDEFGHJKMNPQRSTUVWXYZ23456789");
});

test("cleanCode upper-cases", () => {
  assert.equal(cleanCode("abc234"), "ABC234");
});

test("cleanCode drops spaces and dashes", () => {
  assert.equal(cleanCode("abc-def"), "ABCDEF");
  assert.equal(cleanCode(" ABC DEF "), "ABCDEF");
});

test("cleanCode drops look-alikes", () => {
  assert.equal(cleanCode("O0I1L"), "");
});

test("cleanCode keeps the first six", () => {
  assert.equal(cleanCode("ABCDEFGHJK"), "ABCDEF");
});

test("cleanCode accepts nothing", () => {
  assert.equal(cleanCode(undefined), "");
});

test("groupCode splits three and three", () => {
  assert.equal(groupCode("ABC234"), "ABC 234");
});

test("groupCode leaves a short code in one group", () => {
  assert.equal(groupCode("AB"), "AB");
});

test("submitting goes to connecting", () => {
  assert.equal(codeEntryState({ type: "submit" }, "idle"), "connecting");
});

test("a claimed code goes to paired", () => {
  assert.equal(codeEntryState({ type: "claimed" }, "connecting"), "paired");
});

test("pair_code_invalid goes to invalid", () => {
  assert.equal(codeEntryState({ type: "failed", code: "pair_code_invalid" }, "connecting"), "invalid");
});

test("a connection failure goes to offline", () => {
  assert.equal(codeEntryState({ type: "failed" }, "connecting"), "offline");
});

test("editing after an error goes back to idle", () => {
  assert.equal(codeEntryState({ type: "edit" }, "invalid"), "idle");
  assert.equal(codeEntryState({ type: "edit" }, "offline"), "idle");
});

test("editing while connecting changes nothing", () => {
  assert.equal(codeEntryState({ type: "edit" }, "connecting"), "connecting");
});

test("countdownShare is 1 at issue and 0 at expiry", () => {
  assert.equal(countdownShare(1300, 1000), 1);
  assert.equal(countdownShare(1300, 1300), 0);
});

test("countdownShare is half halfway", () => {
  assert.equal(countdownShare(1300, 1150), 0.5);
});

test("countdownShare never goes below 0 or above 1", () => {
  assert.equal(countdownShare(1300, 1400), 0);
  assert.equal(countdownShare(1300, 900), 1);
});

// --- the mounted entry, on fake elements ---

function fakeElement(tag) {
  const listeners = {};
  const el = {
    tag, children: [], attrs: {}, value: "", textContent: "", className: "", focused: false,
    append(...nodes) { this.children.push(...nodes); },
    setAttribute(name, value) { this.attrs[name] = value; },
    addEventListener(type, fn) { (listeners[type] ??= []).push(fn); },
    focus() { this.focused = true; el.doc.active = el; },
    fire(type, event = {}) { (listeners[type] ?? []).forEach((fn) => fn({ preventDefault() {}, target: el, ...event })); },
  };
  return el;
}

function mount(onSubmit) {
  const doc = { active: null, createElement: (tag) => Object.assign(fakeElement(tag), { doc }) };
  const root = Object.assign(fakeElement("div"), { doc });
  const entry = mountCodeInput(root, { onSubmit, t: (key) => key, doc });
  const [group, status] = root.children;
  return { entry, root, boxes: group.children, status, doc };
}

test("six boxes and a status element are built", () => {
  const { boxes, status } = mount(async () => {});
  assert.equal(boxes.length, 6);
  assert.equal(status.attrs.role, "status");
});

test("typing a character moves on to the next box", () => {
  const { boxes, doc } = mount(async () => {});
  boxes[0].value = "a";
  boxes[0].fire("input");
  assert.equal(boxes[0].value, "A");
  assert.equal(doc.active, boxes[1]);
});

test("a character outside the alphabet is dropped", () => {
  const { boxes } = mount(async () => {});
  boxes[0].value = "0";
  boxes[0].fire("input");
  assert.equal(boxes[0].value, "");
});

test("backspace in an empty box goes back and clears the one before", () => {
  const { boxes, doc } = mount(async () => {});
  boxes[0].value = "A";
  boxes[1].fire("keydown", { key: "Backspace" });
  assert.equal(boxes[0].value, "");
  assert.equal(doc.active, boxes[0]);
});

test("a pasted code fills the boxes and submits once", async () => {
  const submitted = [];
  const { boxes } = mount(async (code) => submitted.push(code));
  boxes[0].fire("paste", { clipboardData: { getData: () => "abc-def" } });
  assert.deepEqual(boxes.map((b) => b.value), [..."ABCDEF"]);
  assert.deepEqual(submitted, ["ABCDEF"]);
});

test("typing the sixth character submits", async () => {
  const submitted = [];
  const { boxes } = mount(async (code) => submitted.push(code));
  for (const [i, ch] of [..."ABCDEF"].entries()) {
    boxes[i].value = ch;
    boxes[i].fire("input");
  }
  assert.deepEqual(submitted, ["ABCDEF"]);
});

test("a rejected code shows the invalid text, editing clears it", async () => {
  const { boxes, status } = mount(async () => { throw Object.assign(new Error("no"), { code: "pair_code_invalid" }); });
  boxes[0].fire("paste", { clipboardData: { getData: () => "ABCDEF" } });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(status.textContent, "screens.codeInvalid");
  boxes[5].value = "";
  boxes[5].fire("input");
  assert.equal(status.textContent, "");
});

test("a failed connection shows the offline text", async () => {
  const { boxes, status } = mount(async () => { throw new Error("cannot connect"); });
  boxes[0].fire("paste", { clipboardData: { getData: () => "ABCDEF" } });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(status.textContent, "screens.cannotConnect");
});

function mountNow(pair, onPaired) {
  const doc = { active: null, createElement: (tag) => Object.assign(fakeElement(tag), { doc }) };
  const button = Object.assign(fakeElement("button"), { doc });
  const entry = Object.assign(fakeElement("div"), { doc, hidden: true });
  mountPairNow({ button, entry, pair, onPaired, t: (key) => key, doc });
  return { button, entry };
}

test("Pair now opens the entry and focuses the first box", () => {
  const { button, entry } = mountNow(async () => {}, () => {});
  button.fire("click");
  assert.equal(entry.hidden, false);
  assert.equal(entry.children[0].children[0].focused, true);
});

test("a code entered after Pair now is claimed, then the page carries on", async () => {
  const claimed = [];
  let paired = 0;
  const { button, entry } = mountNow(async (code) => claimed.push(code), () => paired++);
  button.fire("click");
  entry.children[0].children[0].fire("paste", { clipboardData: { getData: () => "ABCDEF" } });
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(claimed, ["ABCDEF"]);
  assert.equal(paired, 1);
});

test("a refused code does not carry on", async () => {
  let paired = 0;
  const { button, entry } = mountNow(async () => { throw new Error("no"); }, () => paired++);
  button.fire("click");
  entry.children[0].children[0].fire("paste", { clipboardData: { getData: () => "ABCDEF" } });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(paired, 0);
});
