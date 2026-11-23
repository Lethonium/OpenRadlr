import { test } from "node:test";
import assert from "node:assert/strict";

import { joinAtMetres } from "../public/js/ride/joinAt.js";

test("reads the join point in metres", () => assert.equal(joinAtMetres("?at=6490"), 6490));

test("no at parameter joins at the start as usual", () => assert.equal(joinAtMetres(""), null));

test("a negative join point is ignored", () => assert.equal(joinAtMetres("?at=-5"), null));

test("a join point that is not a number is ignored", () => assert.equal(joinAtMetres("?at=abc"), null));

test("an empty join point is ignored", () => assert.equal(joinAtMetres("?at="), null));
