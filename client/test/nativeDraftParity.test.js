import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { draftInfo } from "../public/js/ride/draft.js";
import { effectiveGrade } from "../public/js/ride/virtualShifting.js";
import { onRoute } from "../public/js/ride/roadRiders.js";
import { RouteGeometry } from "../public/js/route/geometry.js";

// Android's RideEngineTest reads this same file as a JVM test resource.
const fixture = JSON.parse(readFileSync(new URL("./fixtures/native-drafting.json", import.meta.url), "utf8"));
for (const row of fixture.cases) {
  test(`web/native drafting parity: ${row.name}`, () => {
    const route = new RouteGeometry({ id: "r", loop: row.loop, points: [[0, 0, 0], [500, 0, 0], [0, 0, 0]] });
    const riders = [row.me, ...row.others].filter((rider) => onRoute(rider, route.id));
    const saving = draftInfo(row.me, riders, route)?.savingPercent ?? 0;
    assert.equal(saving, row.savingPercent);
    assert.equal(effectiveGrade({ ...fixture.physics, gradePercent: 0, dragFactor: 1 - saving / 100 }), row.grade);
  });
}
