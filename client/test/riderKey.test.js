import { test } from "node:test";
import assert from "node:assert/strict";
import { RiderKey, joinMessage, linkMessage } from "../public/js/profile/riderKey.js";

const subtle = globalThis.crypto.subtle;
const ECDSA = { name: "ECDSA", namedCurve: "P-256" };
const SHA256 = { name: "ECDSA", hash: "SHA-256" };

/** The key-value store `indexedDbStore` gives, in memory. */
function memoryStore() {
  const map = new Map();
  return {
    map,
    get: async (key) => map.get(key),
    put: async (key, value) => void map.set(key, value),
    delete: async (key) => void map.delete(key),
    keys: async () => [...map.keys()],
  };
}

const bytes = (base64) => Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));

async function verifies(publicKey, message, signature) {
  const key = await subtle.importKey("spki", bytes(publicKey), ECDSA, false, ["verify"]);
  return subtle.verify(SHA256, key, bytes(signature), new TextEncoder().encode(message));
}

test("a new rider gets a public key and no private key in the profile", async () => {
  const keys = new RiderKey({ store: memoryStore(), subtle });
  const profile = await keys.ensure({ name: "Anna", publicKey: null });
  assert.match(profile.publicKey, /^[A-Za-z0-9+/=]{80,}$/);
  assert.equal("privateKeyJwk" in profile, false);
});

test("the private key is kept non-extractable", async () => {
  const store = memoryStore();
  await new RiderKey({ store, subtle }).ensure({ name: "Anna", publicKey: null });
  assert.equal(store.map.get("rider").privateKey.extractable, false);
});

test("ensuring twice keeps the same key", async () => {
  const keys = new RiderKey({ store: memoryStore(), subtle });
  const first = await keys.ensure({ name: "Anna", publicKey: null });
  assert.equal(await keys.ensure(first), first);
});

test("a signature verifies against the profile's public key", async () => {
  const keys = new RiderKey({ store: memoryStore(), subtle });
  const { publicKey } = await keys.ensure({ name: "Anna", publicKey: null });
  const message = joinMessage("ab".repeat(32));
  assert.equal(await verifies(publicKey, message, await keys.sign(message)), true);
});

test("an old JWK key is moved into the store, keeping the public key", async () => {
  const pair = await subtle.generateKey(ECDSA, true, ["sign", "verify"]);
  const publicKey = btoa(String.fromCharCode(...new Uint8Array(await subtle.exportKey("spki", pair.publicKey))));
  const privateKeyJwk = await subtle.exportKey("jwk", pair.privateKey);
  const store = memoryStore();
  const keys = new RiderKey({ store, subtle });

  const profile = await keys.ensure({ name: "Anna", publicKey, privateKeyJwk });

  assert.equal(profile.publicKey, publicKey);
  assert.equal("privateKeyJwk" in profile, false);
  assert.equal(await verifies(publicKey, "m", await keys.sign("m")), true);
});

test("a profile that lost its key takes the stored one back", async () => {
  const keys = new RiderKey({ store: memoryStore(), subtle });
  const { publicKey } = await keys.ensure({ name: "Anna", publicKey: null });
  assert.equal((await keys.ensure({ name: "Anna", publicKey: null })).publicKey, publicKey);
});

test("without a key there is nothing to sign with", async () => {
  assert.equal(await new RiderKey({ store: memoryStore(), subtle }).sign("m"), null);
});

test("a store that fails leaves the profile as it was and signs nothing", async () => {
  const broken = { get: async () => Promise.reject(new Error("blocked")), put: async () => Promise.reject(new Error("blocked")) };
  const keys = new RiderKey({ store: broken, subtle });
  const profile = { name: "Anna", publicKey: null };
  assert.equal(await keys.ensure(profile), profile);
  assert.equal(await keys.sign("m"), null);
});

test("join and link sign different messages", () => {
  assert.equal(joinMessage("c"), "openradlr-join\nc");
  assert.equal(linkMessage("c"), "openradlr-link\nc");
});

test("a key that isn't the profile's signs nothing, so the join goes unsigned instead of refused", async () => {
  const keys = new RiderKey({ store: memoryStore(), subtle });
  const { publicKey } = await keys.ensure({ name: "Anna", publicKey: null });
  assert.equal(await keys.sign("m", "another key"), null);
  assert.match(await keys.sign("m", publicKey), /^[A-Za-z0-9+/=]{80,}$/);
});
