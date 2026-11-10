import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { BOT_CALLS, BotCalls } from "../public/js/ride/botCalls.js";
import { TEAM_KITS, botKit } from "../public/js/view/botKits.js";
import { botBadgeText } from "../public/js/view/panels.js";
import { setLocale } from "../public/js/i18n/i18n.js";

afterEach(() => setLocale("en"));

// --- kits --------------------------------------------------------------------------

const rgb = (hex) => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
const hue = ([r, g, b]) => {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return null;
  const d = max - min;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
};

test("no team rides in my orange or the humans' sky blue", () => {
  const me = hue(rgb("#ff7a1a"));
  const human = hue(rgb("#4cc3ff"));
  for (const [team, hex] of Object.entries(TEAM_KITS)) {
    const h = hue(rgb(hex));
    if (h === null) continue;
    const apart = (a, b) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));
    assert.ok(apart(h, me) > 15, `${team} is too close to orange`);
    assert.ok(apart(h, human) > 15, `${team} is too close to sky blue`);
  }
});

test("a bot wears its team's kit; humans and unknown teams none", () => {
  assert.equal(botKit({ is_bot: true, team: "moos" }), TEAM_KITS.moos);
  assert.equal(botKit({ is_bot: true, team: "nowhere" }), null);
  assert.equal(botKit({ is_bot: true, team: "toString" }), null);
  assert.equal(botKit({ is_bot: true }), null);
  assert.equal(botKit({ is_bot: false, team: "moos" }), null);
});

// --- the badge --------------------------------------------------------------------

test("the bot badge names the riding type, in the rider's language", () => {
  assert.equal(botBadgeText({ is_bot: true, style: "climber" }), "climber bot");
  assert.equal(botBadgeText({ is_bot: true }), "bot");
  assert.equal(botBadgeText({ is_bot: true, style: "unicyclist" }), "bot");
  setLocale("de");
  assert.equal(botBadgeText({ is_bot: true, style: "climber" }), "Kletterer-Bot");
});

// --- ticker calls -----------------------------------------------------------------

const route = { signedGap: (from, to) => to - from };
const me = { id: 1, route: "r", distance: 1000 };
const bot = (move, distance = 1050, extra = {}) => ({ id: 7, name: "Gus Tailwind", is_bot: true, route: "r", distance, move, ...extra });

function calls(frames) {
  const watch = new BotCalls();
  return frames.map(({ riders, nowS }) => watch.update({ riders, me, route, nowS }));
}

test("a bot near me starting an attack is called out once", () => {
  const out = calls([
    { riders: [bot(undefined)], nowS: 0 },
    { riders: [bot("attack")], nowS: 1 },
    { riders: [bot("attack")], nowS: 2 },
  ]);
  assert.deepEqual(out, [[], [{ id: 7, name: "Gus Tailwind", move: "attack" }], []]);
});

test("a bot first seen mid-move, far away, on another route or a human is not called out", () => {
  for (const [first, second] of [
    [null, bot("attack")],
    [bot(undefined, 1000 + BOT_CALLS.reachM + 50), bot("attack", 1000 + BOT_CALLS.reachM + 50)],
    [bot(undefined, 1050, { route: "other" }), bot("attack", 1050, { route: "other" })],
    [bot(undefined, 1050, { is_bot: false }), bot("attack", 1050, { is_bot: false })],
  ]) {
    const out = calls([
      { riders: first ? [first] : [], nowS: 0 },
      { riders: [second], nowS: 1 },
    ]);
    assert.deepEqual(out[1], [], JSON.stringify(second));
  }
});

test("a chase is only called out when the bot comes after me", () => {
  const ahead = calls([
    { riders: [bot(undefined, 1030)], nowS: 0 },
    { riders: [bot("answer", 1030)], nowS: 1 },
  ]);
  assert.deepEqual(ahead[1], []);
  const behind = calls([
    { riders: [bot(undefined, 970)], nowS: 0 },
    { riders: [bot("answer", 970)], nowS: 1 },
  ]);
  assert.equal(behind[1][0].move, "answer");
});

test("calls are spaced out and the same bot's move isn't repeated soon", () => {
  const other = (move) => ({ ...bot(move), id: 8, name: "Sally Sprocket" });
  const out = calls([
    { riders: [bot(undefined), other(undefined)], nowS: 0 },
    { riders: [bot("attack"), other("pull")], nowS: 1 },
    { riders: [bot(undefined), other(undefined)], nowS: 5 },
    { riders: [bot("attack"), other("pull")], nowS: 10 },
    { riders: [bot(undefined), other(undefined)], nowS: 30 },
    { riders: [bot("attack"), other("pull")], nowS: 40 },
  ]);
  assert.equal(out[1].length, 1, "one line at a time");
  assert.deepEqual(out[3], [], `within ${BOT_CALLS.everyS} s of the last line`);
  assert.deepEqual(out[5], [{ id: 8, name: "Sally Sprocket", move: "pull" }], "Gus's attack was called less than 90 s ago");
});
