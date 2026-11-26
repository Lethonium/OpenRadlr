import { test } from "node:test";
import assert from "node:assert/strict";
import { AccountFlow, errorKey } from "../public/js/profile/accountFlow.js";
import { AccountError } from "../public/js/net/account.js";

const ANNA = { email: "anna@example.org", passkeys: [], riders: [] };

function fakeClient(overrides = {}) {
  const calls = [];
  const record = (name, value) => async (...args) => (calls.push([name, ...args]), typeof value === "function" ? value(...args) : value);
  return {
    calls,
    me: record("me", null),
    startEmail: record("startEmail", null),
    verifyEmail: record("verifyEmail", { ...ANNA, created: true }),
    logout: record("logout", null),
    deleteAccount: record("deleteAccount", null),
    passkeyLoginOptions: record("passkeyLoginOptions", { challenge: "c" }),
    passkeyLogin: record("passkeyLogin", ANNA),
    passkeyRegisterOptions: record("passkeyRegisterOptions", { challenge: "c" }),
    passkeyRegister: record("passkeyRegister", { ...ANNA, passkeys: [{ id: "p1", name: "Laptop" }] }),
    deletePasskey: record("deletePasskey", null),
    ...overrides,
  };
}

function fakeBackup({ linked = false } = {}) {
  const backup = {
    linkedRider: linked ? "rider-1" : null,
    links: 0,
    runs: 0,
    forgotten: 0,
    riderId: () => backup.linkedRider,
    linkedTo: (me) => Boolean(backup.linkedRider && me?.riders?.some((r) => r.rider_id === backup.linkedRider)),
    link: async () => ((backup.links += 1), (backup.linkedRider = "rider-1")),
    run: async () => ((backup.runs += 1), { ok: true, rides: 2 }),
    forget: () => ((backup.forgotten += 1), (backup.linkedRider = null)),
    backedUpAt: () => null,
  };
  return backup;
}

function flow({ client = fakeClient(), backup = fakeBackup(), passkeys = { available: true, create: async () => ({ body: 1 }), get: async () => ({ body: 2 }) } } = {}) {
  const changes = [];
  const instance = new AccountFlow({
    client,
    backup: () => backup,
    rider: () => ({ name: "Anna", publicKey: "pk" }),
    passkeys,
    lang: () => "en",
    onChange: (state) => changes.push(state),
  });
  return { instance, client, backup, changes };
}

test("signed out, the flow asks for an email", async () => {
  const { instance } = flow();
  await instance.refresh();
  assert.equal(instance.state.phase, "signedOut");
});

test("sending a code moves on to the code, remembering the address", async () => {
  const { instance, client } = flow();
  await instance.sendCode(" anna@example.org ");
  assert.deepEqual(client.calls.at(-1), ["startEmail", "anna@example.org", "en"]);
  assert.equal(instance.state.phase, "codeSent");
  assert.equal(instance.state.email, "anna@example.org");
});

test("a valid code signs in, saves this rider and backs it up", async () => {
  const { instance, backup, client } = flow();
  client.me = async () => ({ ...ANNA, riders: [{ rider_id: "rider-1" }] });
  await instance.sendCode("anna@example.org");
  await instance.verify("123456");
  assert.equal(instance.state.phase, "signedIn");
  assert.equal(instance.state.created, true);
  assert.equal(backup.links, 1);
  assert.equal(backup.runs, 1);
  assert.equal(instance.state.linked, true);
});

test("a wrong code stays on the code with an error", async () => {
  const client = fakeClient({ verifyEmail: async () => Promise.reject(new AccountError("wrong_code", 401)) });
  const { instance } = flow({ client });
  await instance.sendCode("anna@example.org");
  await instance.verify("000000");
  assert.equal(instance.state.phase, "codeSent");
  assert.equal(instance.state.error, "account.error.wrongCode");
});

test("an empty address is not sent", async () => {
  const { instance, client } = flow();
  await instance.sendCode("  ");
  assert.equal(client.calls.length, 0);
  assert.equal(instance.state.error, "account.error.badEmail");
});

test("a passkey signs in", async () => {
  const { instance, client } = flow();
  await instance.passkeySignIn();
  assert.deepEqual(client.calls.map((c) => c[0]), ["passkeyLoginOptions", "passkeyLogin", "me"]);
  assert.equal(instance.state.phase, "signedIn");
});

test("cancelling the passkey dialog is not an error", async () => {
  const cancelled = Object.assign(new Error("cancelled"), { name: "NotAllowedError" });
  const { instance } = flow({ passkeys: { available: true, get: async () => Promise.reject(cancelled) } });
  await instance.refresh();
  await instance.passkeySignIn();
  assert.equal(instance.state.phase, "signedOut");
  assert.equal(instance.state.error, null);
});

test("adding a passkey shows it in the list", async () => {
  const { instance, client } = flow({ client: fakeClient({ me: async () => ANNA }) });
  await instance.refresh();
  await instance.addPasskey("Laptop");
  assert.equal(instance.state.me.passkeys[0].name, "Laptop");
  assert.equal(client.calls.find((c) => c[0] === "passkeyRegister")[1].lang, "en");
});

test("signed in on another rider, the rider is saved only when asked", async () => {
  const { instance, backup } = flow({ client: fakeClient({ me: async () => ANNA }) });
  await instance.refresh();
  assert.equal(instance.state.linked, false);
  assert.equal(backup.links, 0);
  await instance.saveRider();
  assert.equal(backup.links, 1);
});

test("signing out returns to the email step and keeps the rider's link", async () => {
  const { instance, client, backup } = flow({ client: fakeClient({ me: async () => ANNA }), backup: fakeBackup({ linked: true }) });
  await instance.refresh();
  await instance.signOut();
  assert.ok(client.calls.some((c) => c[0] === "logout"));
  assert.equal(instance.state.phase, "signedOut");
  assert.equal(backup.forgotten, 0);
});

test("deleting the account forgets the rider's link", async () => {
  const { instance, backup, client } = flow({ client: fakeClient({ me: async () => ANNA }), backup: fakeBackup({ linked: true }) });
  await instance.refresh();
  await instance.deleteAccount();
  assert.equal(instance.state.phase, "signedOut");
  assert.equal(backup.forgotten, 1);
  assert.deepEqual(client.calls.find((c) => c[0] === "deleteAccount"), ["deleteAccount", "en"]);
});

test("a backup after a ride runs only for a linked rider", async () => {
  const linked = flow({ client: fakeClient({ me: async () => ({ ...ANNA, riders: [{ rider_id: "rider-1" }] }) }), backup: fakeBackup({ linked: true }) });
  await linked.instance.refresh();
  await linked.instance.backupNow();
  assert.equal(linked.backup.runs, 1);
  const unlinked = flow({ client: fakeClient({ me: async () => ANNA }) });
  await unlinked.instance.refresh();
  await unlinked.instance.backupNow();
  assert.equal(unlinked.backup.runs, 0);
});

test("unreachable on start, the flow is offline with a hint, not signed out", async () => {
  const { instance } = flow({ client: fakeClient({ me: async () => Promise.reject(new AccountError("offline", 0)) }) });
  await instance.refresh();
  assert.equal(instance.state.phase, "offline");
  assert.equal(instance.state.error, "account.error.offline");
});

test("a signed-in rider stays signed in when the account can't be reached", async () => {
  let reachable = true;
  const { instance } = flow({ client: fakeClient({ me: async () => (reachable ? ANNA : Promise.reject(new AccountError("offline", 0))) }) });
  await instance.refresh();
  reachable = false;
  await instance.refresh();
  assert.equal(instance.state.phase, "signedIn");
});

test("signing in leaves a rider saved in another account where it is", async () => {
  const backup = fakeBackup({ linked: true });
  const { instance } = flow({ backup });
  await instance.sendCode("bert@example.org");
  await instance.verify("123456");
  assert.equal(instance.state.phase, "signedIn");
  assert.equal(instance.state.linked, false);
  assert.equal(backup.links, 0);
});

test("a second submit while the code is checked is ignored", async () => {
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  let checks = 0;
  const client = fakeClient({ verifyEmail: async () => (checks++, await gate, { ...ANNA, created: false }) });
  const { instance } = flow({ client, backup: fakeBackup({ linked: true }) });
  await instance.sendCode("anna@example.org");
  const first = instance.verify("123456");
  await instance.verify("123456");
  release();
  await first;
  assert.equal(checks, 1);
  assert.equal(instance.state.error, null);
});

test("saving keeps to the rider it started with", async () => {
  const backups = { a: fakeBackup(), b: fakeBackup() };
  let active = "a";
  const client = fakeClient({ me: async () => ({ ...ANNA, riders: [{ rider_id: "rider-1" }] }) });
  const instance = new AccountFlow({
    client,
    backup: () => backups[active],
    rider: async () => {
      active = "b";
      return { name: "Anna", publicKey: "pk" };
    },
    passkeys: { available: false },
    lang: () => "en",
  });
  await instance.refresh();
  await instance.saveRider();
  assert.deepEqual([backups.a.links, backups.a.runs, backups.b.links, backups.b.runs], [1, 1, 0, 0]);
});

test("each change is reported", async () => {
  const { instance, changes } = flow();
  await instance.sendCode("anna@example.org");
  assert.ok(changes.some((state) => state.busy));
  assert.equal(changes.at(-1).busy, false);
});

test("server codes map to text keys, unknown ones to a generic text", () => {
  assert.equal(errorKey({ code: "too_many_requests" }), "account.error.tooMany");
  assert.equal(errorKey({ code: "mail_failed" }), "account.error.mail");
  assert.equal(errorKey({ code: "something" }), "account.error.generic");
});

test("switching riders re-reads whether the new one is saved, without a request", async () => {
  const backup = fakeBackup({ linked: true });
  const { instance, client } = flow({ client: fakeClient({ me: async () => ({ ...ANNA, riders: [{ rider_id: "rider-1" }] }) }), backup });
  await instance.refresh();
  assert.equal(instance.state.linked, true);
  backup.linkedRider = null;
  const calls = client.calls.length;
  instance.riderChanged();
  assert.equal(instance.state.linked, false);
  assert.equal(client.calls.length, calls);
});

test("a new code goes to the same address and is counted", async () => {
  const { instance, client } = flow();
  await instance.sendCode("anna@example.org");
  await instance.resend();
  assert.deepEqual(client.calls.map((c) => c.slice(0, 2)), [["startEmail", "anna@example.org"], ["startEmail", "anna@example.org"]]);
  assert.equal(instance.state.sends, 2);
  assert.equal(instance.state.phase, "codeSent");
});
