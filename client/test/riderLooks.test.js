import { test } from "node:test";
import assert from "node:assert/strict";

import { RiderLooks } from "../public/js/view3d/riderLooks.js";
import { encodeLook, rolledChoice } from "../public/js/profile/riderLook.js";

test("bots, riders without a look and unreadable codes keep the rolled look", () => {
  const looks = new RiderLooks();
  const code = encodeLook(rolledChoice(2));
  assert.deepEqual(looks.of({ id: 1, is_bot: true, look: code }, false), { classic: false });
  assert.deepEqual(looks.of({ id: 1 }, false), { classic: false });
  assert.deepEqual(looks.of({ id: 1, look: "9x" }, false), { classic: false });
  assert.equal(looks.of({ id: 1, look: code }, false).lookKey, code);
});

test("my own look comes from this device", () => {
  const looks = new RiderLooks();
  const theirs = encodeLook(rolledChoice(3));
  assert.deepEqual(looks.of({ id: 1, look: theirs }, true), { classic: false }, "no look set: the rolled one, not the echo");
  const mine = encodeLook({ ...rolledChoice(3), style: "classic" });
  looks.setMine(mine);
  const dressed = looks.of({ id: 1, look: theirs }, true);
  assert.equal(dressed.lookKey, mine);
  assert.equal(dressed.classic, true);
});
