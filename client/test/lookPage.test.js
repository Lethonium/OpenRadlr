import { test } from "node:test";
import assert from "node:assert/strict";

import { LOOK_GROUPS, heightLabel, lookPageModel, renderLookPage, unlockLine } from "../public/js/view/lookPage.js";
import { LOOK_SLOTS, rolledChoice } from "../public/js/profile/riderLook.js";
import en from "../public/js/i18n/en.js";
import de from "../public/js/i18n/de.js";

const slotOf = (model, id) => model.flatMap((group) => group.slots).find((slot) => slot.id === id);

test("every slot shows on the page, in its group, in catalogue order", () => {
  const model = lookPageModel(rolledChoice(1), {});
  assert.deepEqual(model.map((group) => group.id), LOOK_GROUPS);
  assert.deepEqual(model.flatMap((group) => group.slots.map((slot) => slot.id)), Object.keys(LOOK_SLOTS));
});

test("the chosen piece is selected, locked pieces say what unlocks them", () => {
  const model = lookPageModel({ ...rolledChoice(1), sockHeight: "crew" }, {});
  const socks = slotOf(model, "sockHeight");
  assert.equal(socks.kind, "chips");
  assert.deepEqual(socks.options.filter((o) => o.selected).map((o) => o.id), ["crew"]);
  const tall = socks.options.find((o) => o.id === "tall");
  assert.equal(tall.locked, true);
  assert.match(tall.hint, new RegExp(en["achievement.weeks4.name"]));
  const knee = socks.options.find((o) => o.id === "knee");
  assert.equal(knee.hint, en["look.unlockSecret"], "a secret achievement keeps its name");
  assert.equal(slotOf(lookPageModel(rolledChoice(1), { weeks4: 1 }), "sockHeight").options.find((o) => o.id === "tall").locked, false);
});

test("colours and skins are swatches, height a range", () => {
  const model = lookPageModel({ ...rolledChoice(1), height: 180 }, {}, "imperial");
  assert.equal(slotOf(model, "primary").kind, "colour");
  assert.match(slotOf(model, "primary").options[0].colour, /^#[0-9a-f]{6}$/);
  assert.equal(slotOf(model, "skin").kind, "colour");
  assert.match(slotOf(model, "skin").options[0].colour, /^#[0-9a-f]{6}$/);
  const height = slotOf(model, "height");
  assert.deepEqual([height.kind, height.min, height.max, height.value, height.text], ["range", 150, 205, 180, "5′11″"]);
});

test("heights read in metres or feet and inches", () => {
  assert.equal(heightLabel(180), "1.80 m");
  assert.equal(heightLabel(152, "imperial"), "5′0″");
});

test("every group, slot and option has English and German text", () => {
  const keys = [...LOOK_GROUPS.map((g) => `look.group.${g}`)];
  for (const [slot, { options, colour }] of Object.entries(LOOK_SLOTS)) {
    keys.push(`look.slot.${slot}`);
    if (!colour) for (const option of options) keys.push(`look.option.${slot}.${option.id}`);
  }
  for (const key of keys) {
    assert.ok(en[key], `en ${key}`);
    assert.ok(de[key], `de ${key}`);
  }
});

test("the gold frame has its own name in the unlock line", () => {
  assert.equal(unlockLine("km1000"), "Unlocks for your look: Gold frame");
});

/** Just enough of a document for renderLookPage: elements with children, dataset, attributes, events and focus. */
function fakeDocument() {
  const doc = { activeElement: null };
  doc.createElement = (tag) => {
    const listeners = {};
    const node = {
      tagName: tag.toUpperCase(),
      ownerDocument: doc,
      children: [],
      dataset: {},
      attributes: {},
      style: { setProperty() {} },
      classList: { add() {} },
      setAttribute(name, value) {
        this.attributes[name] = value;
      },
      append(...nodes) {
        this.children.push(...nodes);
      },
      replaceChildren(...nodes) {
        this.children = nodes;
      },
      addEventListener(type, listener) {
        (listeners[type] ??= []).push(listener);
      },
      dispatch(type) {
        for (const listener of listeners[type] ?? []) listener();
      },
      focus() {
        doc.activeElement = node;
      },
    };
    return node;
  };
  return doc;
}

const allNodes = (node) => [node, ...node.children.flatMap(allNodes)];

test("the height slider keeps the focus through two keyboard steps in a row", () => {
  const doc = fakeDocument();
  const container = doc.createElement("div");
  let choice = rolledChoice(1);
  const picks = [];
  const render = (focus) => renderLookPage(container, lookPageModel(choice, {}), onPick, { focus });
  const onPick = (slot, value) => {
    picks.push(value);
    choice = { ...choice, [slot]: value };
    // The app saves the look and draws the page again, as main.js's keepLook does.
    render({ slot, value });
  };
  render(null);
  const slider = () => allNodes(container).find((node) => node.type === "range");
  slider().focus();
  for (const step of [1, 2]) {
    const focused = doc.activeElement;
    assert.equal(focused?.type, "range", `focus on the slider before step ${step}`);
    focused.value = String(Number(focused.value) + 1);
    focused.dispatch("change");
  }
  assert.deepEqual(picks, [choice.height - 1, choice.height]);
  assert.equal(doc.activeElement, slider());
});

test("a picked chip gets the focus back after the page is drawn again", () => {
  const doc = fakeDocument();
  const container = doc.createElement("div");
  renderLookPage(container, lookPageModel(rolledChoice(1), {}), () => {}, { focus: { slot: "sockHeight", value: "crew" } });
  assert.deepEqual([doc.activeElement?.dataset.slot, doc.activeElement?.dataset.option], ["sockHeight", "crew"]);
});
