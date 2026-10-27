import { test } from "node:test";
import assert from "node:assert/strict";
import { pickRoute, routeCharacter, routeStats, routesOf, serverStatus, studioTagline, buildLabel, communityDistance, routeRiders, workoutRoute, workoutTagline, stageStats, stageHeadline, stageLede, devicesVisible, privacyUrl, serverName, activityOf, routesFor, pickForActivity, activityTabs, shownActivity, showsCards, routeCard, stravaLine, joinAction } from "../public/js/view/startMenu.js";
import { PRESETS } from "../public/js/workout/presets.js";

const routes = [
  { id: "rolling-hills", name: "Rolling Hills", length_m: 4828, elevation_gain_m: 64, players: 2 },
  { id: "riverside-flats", name: "Riverside Flats", length_m: 6792, elevation_gain_m: 27, players: 0 },
  { id: "col", name: "Col", length_m: 8598, elevation_gain_m: 157, players: 0 },
];

test("server status shows riders, room left and when it is full", () => {
  assert.deepEqual(serverStatus({ players: 3, max_players: 50 }), { text: "3 riders online · room for 47 more", full: false, phoneFull: false, online: true });
  assert.equal(serverStatus({ players: 1, max_players: 5 }).text, "1 rider online · room for 4 more");
  assert.equal(serverStatus({ players: 3, phone_players: 2, max_players: 50 }).text, "3 riders (2 📱) online · room for 49 more");
  assert.equal(routeRiders({ players: 3, phone_players: 1 }), "3 riders · 1 📱");
  assert.equal(routeRiders({ players: 1 }), "1 rider");
  assert.deepEqual(serverStatus({ players: 5, max_players: 5 }), { text: "Full · 5 riders online", full: true, phoneFull: false, online: true });
  // Phone riders have seats of their own: they don't use up the trainer seats.
  const phones = serverStatus({ players: 6, phone_players: 3, max_players: 5, max_phone_players: 3 });
  assert.deepEqual([phones.text, phones.full, phones.phoneFull], ["6 riders (3 📱) online · room for 2 more", false, true]);
  assert.deepEqual(serverStatus(null), { text: "Server unreachable", full: false, online: false });
});

test("routes come from the list, or from the single route of older servers", () => {
  assert.deepEqual(routesOf({ routes }).slice(0, 3), routes);
  assert.deepEqual(routesOf({ route: { id: "x", name: "X" }, players: 4 }), [{ id: "x", name: "X", players: 4 }, { id: "workout", kind: "workout", name: "Workout" }]);
  assert.deepEqual(routesOf(null), []);
});

const studio = {
  id: "spin-studio",
  name: "Spin Studio",
  players: 3,
  class: { class_id: "hiit", name: "HIIT 30/30", starts_at_s: 10_300 },
  next: { class_id: "climb-pyramid", name: "Climb Pyramid", starts_at_s: 12_100 },
};

test("the spin studio is offered after the routes", () => {
  const worlds = routesOf({ routes, studio });
  assert.deepEqual(worlds[3], { ...studio, kind: "studio" });
  assert.equal(pickRoute(worlds, "spin-studio").kind, "studio");
});

test("the studio card says which class runs or starts next", () => {
  assert.equal(studioTagline(studio, 10_000), "HIIT 30/30 starts in 5:00");
  assert.equal(studioTagline(studio, 10_299.4), "HIIT 30/30 starts in 0:01");
  assert.equal(studioTagline(studio, 10_300 + 600), "HIIT 30/30 running · next: Climb Pyramid in 20:00");
});

test("the saved route is kept while the server has it, else the default", () => {
  assert.equal(pickRoute(routes, "col").id, "col");
  assert.equal(pickRoute(routes, "gone").id, "rolling-hills");
  assert.equal(pickRoute(routes, null).id, "rolling-hills");
  assert.equal(pickRoute([], "col"), null);
});

test("route stats and character", () => {
  assert.equal(routeStats(routes[1]), "6.8 km · 27 m up");
  assert.equal(routeCharacter(routes[1]), "Flat");
  assert.equal(routeCharacter(routes[0]), "Rolling");
  assert.equal(routeCharacter(routes[2]), "Hilly");
});

test("the build label shows version and commit, and flags a stale cached client", () => {
  const info = { version: "0.1.0", protocol_version: 3, build: { sha: "bbb2222", date: "2026-10-16T09:12Z" } };
  const same = buildLabel(info, { sha: "bbb2222", date: "2026-10-16T09:12Z" });
  assert.equal(same.text, "v0.1.0 · bbb2222");
  assert.equal(same.stale, false);
  assert.match(same.details, /client bbb2222 .*server bbb2222 .*protocol 3/);
  assert.equal(buildLabel(info, { sha: "aaa1111", date: "" }).stale, true);
  assert.equal(buildLabel(info, { sha: "dev", date: "" }).stale, false);
  assert.equal(buildLabel(null, { sha: "dev", date: "" }).text, "dev");
  assert.match(buildLabel(null, { sha: "dev", date: "" }).details, /server unreachable/);
});

test("the menu shows the community's kilometres on trainers and on phones", async () => {
  const { setUnits } = await import("../public/js/util/format.js");
  const info = { distance_m: { trainer: 12_345_678, paddle: 678_400 } };
  setUnits("metric");
  assert.equal(communityDistance(info), "Ridden on this server: 12,346 km on trainers · 678 km on phones");
  setUnits("imperial");
  assert.equal(communityDistance(info), "Ridden on this server: 7,671 mi on trainers · 422 mi on phones");
  setUnits("metric");
});

test("servers that don't count distance show nothing", () => {
  assert.equal(communityDistance({}), null);
  assert.equal(communityDistance(null), null);
  assert.equal(communityDistance({ distance_m: { trainer: "x" } }), null);
});

test("the workout card follows the routes and the studio", () => {
  const studioInfo = { id: "studio", name: "Spin studio", class: { name: "HIIT", starts_at_s: 0 }, next: { name: "x", starts_at_s: 0 } };
  const cards = routesOf({ routes, studio: studioInfo });
  assert.deepEqual(cards.at(-1), { id: "workout", kind: "workout", name: "Workout" });
  assert.equal(cards.at(-2).kind, "studio");
  assert.equal(routesOf({ routes: [] }).some((card) => card.kind === "workout"), false);
});

test("the workout joins the first route", () => {
  assert.equal(workoutRoute({ routes }), "rolling-hills");
  assert.equal(workoutRoute(null), null);
});

test("the workout tagline counts presets and their lengths", () => {
  assert.equal(workoutTagline(PRESETS), "3 workouts · 4–12 min");
});

test("the stage stats under the headline: character, figures and riders, the class running or the workouts", () => {
  assert.equal(stageStats({ id: "x", length_m: 4828, elevation_gain_m: 64, players: 2 }), "Rolling · 4.8 km · 64 m up · 2 riders");
  assert.equal(stageStats({ ...studio, kind: "studio" }, 10_000), "HIIT 30/30 starts in 5:00 · 3 riders");
  assert.equal(stageStats({ kind: "workout" }), "3 workouts · 4–12 min");
  assert.equal(stageStats(null), "");
});

test("the headline names the picked route or class, asks for a workout or introduces the events", () => {
  assert.equal(stageHeadline({ id: "x", name: "Col" }), "Col");
  assert.equal(stageHeadline({ ...studio, kind: "studio" }), "Spin Studio");
  assert.equal(stageHeadline({ kind: "workout" }), "Pick your workout");
  assert.equal(stageHeadline({ id: "x", name: "Col" }, "events"), "Events");
  assert.equal(stageHeadline(null), "Where do you want to ride?");
});

test("the line under the headline describes the pick, or how riding together works without a description", () => {
  assert.equal(stageLede({ id: "x", description: "Up the col." }), "Up the col.");
  assert.equal(stageLede({ id: "x" }), "Everyone on the same route rides together — friends, strangers and bots.");
  assert.equal(stageLede(null), stageLede({ id: "x" }));
  assert.equal(stageLede({ kind: "studio" }), "Ride a class together: bikes side by side, targets from your FTP.");
  assert.equal(stageLede({ kind: "workout" }), "Bodyweight circuit at the café's outdoor gym.");
  assert.equal(stageLede({ id: "x" }, "events"), "Group rides and races on a schedule. Join one and you ride its route.");
});

test("each card belongs to an activity: riding a route, a studio class or the workout", () => {
  assert.equal(activityOf({ id: "x" }), "ride");
  assert.equal(activityOf({ kind: "studio" }), "studio");
  assert.equal(activityOf({ kind: "workout" }), "workout");
  assert.equal(activityOf(null), "ride");
});

test("the cards of an activity", () => {
  const worlds = routesOf({ routes, studio });
  assert.deepEqual(routesFor("ride", worlds), routes);
  assert.deepEqual(routesFor("studio", worlds).map((r) => r.id), ["spin-studio"]);
  assert.deepEqual(routesFor("events", worlds), []);
});

test("switching activity keeps the preferred card when it belongs there, else takes the first", () => {
  const worlds = routesOf({ routes, studio });
  assert.equal(pickForActivity(worlds, "ride", "col").id, "col");
  assert.equal(pickForActivity(worlds, "ride", "spin-studio").id, "rolling-hills");
  assert.equal(pickForActivity(worlds, "workout", "col").id, "workout");
  assert.equal(pickForActivity(worlds, "studio", null).id, "spin-studio");
  assert.equal(pickForActivity(routesOf({ routes }), "studio", null), null);
});

test("the activity tabs: only what the server offers, events with their count and whether one is open", () => {
  const worlds = routesOf({ routes, studio });
  assert.deepEqual(activityTabs(worlds, []), [
    { id: "ride", label: "Ride", count: 3, live: false },
    { id: "studio", label: "Studio", count: 1, live: false },
    { id: "workout", label: "Workout", count: 1, live: false },
  ]);
  const rows = [
    { id: "a", joinable: false, countdown: "in 2h" },
    { id: "b", joinable: true, countdown: "in 3:00" },
  ];
  assert.deepEqual(activityTabs(routesOf({ routes }), rows).map((tab) => [tab.id, tab.count, tab.live]), [
    ["ride", 3, false],
    ["workout", 1, false],
    ["events", 2, true],
  ]);
  assert.equal(activityTabs(worlds, [{ id: "c", joinable: false, countdown: "running" }]).at(-1).live, true);
});

test("the shown activity: the chosen tab while it exists, else the picked card's", () => {
  const tabs = activityTabs(routesOf({ routes }), []);
  assert.equal(shownActivity(tabs, "events", { id: "col" }), "ride");
  assert.equal(shownActivity(tabs, "workout", { id: "col" }), "workout");
  assert.equal(shownActivity(tabs, null, { kind: "workout" }), "workout");
  assert.equal(shownActivity(tabs, null, null), "ride");
});

test("a picker needs at least two cards: a single route or the studio stands alone", () => {
  assert.equal(showsCards("ride", routes), true);
  assert.equal(showsCards("ride", routes.slice(0, 1)), false);
  assert.equal(showsCards("events", routes), false);
});

test("the workout card keeps the devices heading only for the heart-rate row, which needs Bluetooth", () => {
  assert.equal(devicesVisible({ kind: "workout" }, true), true);
  assert.equal(devicesVisible({ kind: "workout" }, false), false);
  assert.equal(devicesVisible({ id: "x" }, false), true);
});

test("the privacy link comes from the server, only as a web address", () => {
  assert.equal(privacyUrl({ privacy_url: "https://example.org/privacy/" }), "https://example.org/privacy/");
  assert.equal(privacyUrl({}), null);
  assert.equal(privacyUrl(null), null);
  assert.equal(privacyUrl({ privacy_url: "javascript:alert(1)" }), null);
});

test("the server pill names the server only when it isn't the default OpenRadlr", () => {
  assert.equal(serverName({ name: "Club Tuesday" }), "Club Tuesday");
  assert.equal(serverName({ name: "OpenRadlr" }), "");
  assert.equal(serverName({}), "");
  assert.equal(serverName(null), "");
});

test("a route card: name, character, figures and riders; its description waits under the headline", () => {
  assert.deepEqual(routeCard({ ...routes[0], description: "Hills." }), {
    id: "rolling-hills",
    name: "Rolling Hills",
    tag: "Rolling",
    description: null,
    title: "Hills.",
    stats: "4.8 km · 64 m up",
    riders: "2 riders",
    active: true,
    special: false,
  });
  assert.equal(routeCard({ id: "workout", kind: "workout", name: "Workout" }).riders, null);
  assert.equal(routeCard({ ...studio, kind: "studio" }).tag, "Class");
});

test("the Strava line: hidden without Strava, a connect offer, the account once connected, a callout when required", () => {
  assert.equal(stravaLine({ strava: { enabled: false } }, null).shown, false);
  assert.equal(stravaLine(null, null).shown, false);
  const offer = stravaLine({ strava: { enabled: true } }, null);
  assert.deepEqual([offer.shown, offer.connected, offer.required], [true, false, false]);
  assert.match(offer.text, /Upload your rides/);
  const required = stravaLine({ strava: { enabled: true, required: true } }, null);
  assert.equal(required.required, true);
  assert.match(required.text, /needs a Strava account/);
  const connected = stravaLine({ strava: { enabled: true, required: true } }, { name: "Thore K.", can_upload: true });
  assert.deepEqual([connected.connected, connected.required, connected.text], [true, false, "Thore K."]);
});

test("the main button does one thing: ride, start the workout, board a friend's vehicle or connect Strava first", () => {
  const route = { id: "col", name: "Col" };
  const base = { selected: route, full: false, needsStrava: false, boardCode: null };
  assert.deepEqual(joinAction(base), { kind: "ride", label: "Ride Col", disabled: false });
  assert.deepEqual(joinAction({ ...base, selected: { id: "workout", kind: "workout" } }), { kind: "workout", label: "Start workout", disabled: false });
  assert.deepEqual(joinAction({ ...base, boardCode: "K7XQ2M" }), { kind: "board", label: "Board K7XQ2M", disabled: false });
  assert.deepEqual(joinAction({ ...base, needsStrava: true, boardCode: "K7XQ2M" }), { kind: "strava", label: "Connect with Strava to ride", disabled: false });
  assert.deepEqual(joinAction({ ...base, full: true }), { kind: "full", label: "Server is full", disabled: true });
  assert.equal(joinAction({ ...base, selected: null }).label, "Ride");
});
