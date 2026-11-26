import { test } from "node:test";
import assert from "node:assert/strict";
import { createPasskey, getPasskey, passkeysAvailable, toBase64Url, fromBase64Url } from "../public/js/net/passkeys.js";

const bytes = (...values) => new Uint8Array(values).buffer;

test("base64url round-trips bytes without padding", () => {
  const encoded = toBase64Url(bytes(251, 255, 0));
  assert.equal(encoded, "-_8A");
  assert.deepEqual([...new Uint8Array(fromBase64Url(encoded))], [251, 255, 0]);
});

test("creating a passkey turns the server's options into buffers and the answer into base64url", async () => {
  let asked;
  const credentials = {
    create: async (options) => {
      asked = options.publicKey;
      return {
        id: "Y3JlZA",
        response: {
          clientDataJSON: bytes(1),
          getAuthenticatorData: () => bytes(2),
          getPublicKey: () => bytes(3),
        },
      };
    },
  };
  const options = {
    challenge: "AQID",
    rp: { id: "app.openradlr.com", name: "OpenRadlr" },
    user: { id: "YWNj", name: "anna@example.org", displayName: "anna@example.org" },
    pubKeyCredParams: [{ type: "public-key", alg: -7 }],
    excludeCredentials: [{ type: "public-key", id: "AAE" }],
  };
  const body = await createPasskey(options, { credentials, name: "Laptop" });
  assert.deepEqual([...new Uint8Array(asked.challenge)], [1, 2, 3]);
  assert.ok(asked.user.id instanceof ArrayBuffer);
  assert.ok(asked.excludeCredentials[0].id instanceof ArrayBuffer);
  assert.deepEqual(body, {
    challenge: "AQID",
    credential_id: "Y3JlZA",
    client_data_json: "AQ",
    authenticator_data: "Ag",
    public_key: "Aw",
    name: "Laptop",
  });
});

test("a passkey without an ES256 key is refused before it is sent", async () => {
  const credentials = {
    create: async () => ({ id: "x", response: { clientDataJSON: bytes(1), getAuthenticatorData: () => bytes(2), getPublicKey: () => null } }),
  };
  const options = { challenge: "AQID", rp: {}, user: { id: "YQ" }, pubKeyCredParams: [], excludeCredentials: [] };
  await assert.rejects(createPasskey(options, { credentials }), /unsupported/);
});

test("signing in with a passkey sends what the server checks", async () => {
  const credentials = {
    get: async () => ({
      id: "Y3JlZA",
      response: { clientDataJSON: bytes(1), authenticatorData: bytes(2), signature: bytes(3) },
    }),
  };
  const body = await getPasskey({ challenge: "AQID", rpId: "app.openradlr.com" }, { credentials });
  assert.deepEqual(body, { challenge: "AQID", credential_id: "Y3JlZA", client_data_json: "AQ", authenticator_data: "Ag", signature: "Aw" });
});

test("passkeys are offered in a browser with WebAuthn, not in the native app", () => {
  assert.equal(passkeysAvailable({ PublicKeyCredential: function () {}, isSecureContext: true }), true);
  assert.equal(passkeysAvailable({ PublicKeyCredential: undefined, isSecureContext: true }), false);
  assert.equal(passkeysAvailable({ PublicKeyCredential: function () {}, isSecureContext: true, Capacitor: {} }), false);
  assert.equal(passkeysAvailable({ PublicKeyCredential: function () {}, isSecureContext: false }), false);
});
