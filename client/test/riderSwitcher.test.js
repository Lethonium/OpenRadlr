import { test } from "node:test";
import assert from "node:assert/strict";
import { riderRows } from "../public/js/view/riderSwitcher.js";

const names = { main: "Ralf", k3x9q2ab: "", z: "élise" };
const nameOf = (id) => names[id] ?? "";

test("rows follow the roster order and flag the active rider", () => {
  const rows = riderRows({ active: "k3x9q2ab", ids: ["main", "k3x9q2ab"] }, nameOf);
  assert.deepEqual(rows.map((row) => [row.id, row.active]), [["main", false], ["k3x9q2ab", true]]);
});

test("a rider without a name shows the unnamed label and a question mark", () => {
  const [row] = riderRows({ active: "k3x9q2ab", ids: ["k3x9q2ab"] }, nameOf);
  assert.equal(row.name, "New rider");
  assert.equal(row.initial, "?");
});

test("the initial is the first letter, uppercased", () => {
  const [row] = riderRows({ active: "z", ids: ["z"] }, nameOf);
  assert.equal(row.initial, "É");
});
