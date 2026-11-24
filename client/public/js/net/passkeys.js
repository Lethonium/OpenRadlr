/**
 * Passkeys over WebAuthn (ADR 0032): turns the account service's options
 * (base64url strings) into what `navigator.credentials` takes, and its answer
 * into what the service checks. ES256 only: the service reads the key from
 * `getPublicKey()`, which is null for other algorithms.
 *
 * Not offered in the native app: its web view has no dependable WebAuthn, and
 * riders there sign in with an emailed code.
 */

/** @param {ArrayBuffer | ArrayBufferView} buffer */
export function toBase64Url(buffer) {
  const view = buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  return btoa(String.fromCharCode(...view)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** @returns {ArrayBuffer} */
export function fromBase64Url(text) {
  const base64 = text.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4)), (c) => c.charCodeAt(0)).buffer;
}

/** Whether this page can offer passkeys. */
export function passkeysAvailable(scope = globalThis) {
  return typeof scope.PublicKeyCredential === "function" && scope.isSecureContext === true && !scope.Capacitor;
}

/**
 * Makes a passkey for the signed-in account; resolves with the body for `passkeyRegister`.
 * @param {any} options the service's register options
 */
export async function createPasskey(options, { credentials = globalThis.navigator?.credentials, name = "" } = {}) {
  const publicKey = {
    ...options,
    challenge: fromBase64Url(options.challenge),
    user: { ...options.user, id: fromBase64Url(options.user.id) },
    excludeCredentials: (options.excludeCredentials ?? []).map((entry) => ({ ...entry, id: fromBase64Url(entry.id) })),
  };
  const credential = await credentials.create({ publicKey });
  const key = credential.response.getPublicKey?.();
  const authData = credential.response.getAuthenticatorData?.();
  if (!key || !authData) throw new Error("unsupported"); // i18n-ok (an error code, not shown)
  return {
    challenge: options.challenge,
    credential_id: credential.id,
    client_data_json: toBase64Url(credential.response.clientDataJSON),
    authenticator_data: toBase64Url(authData),
    public_key: toBase64Url(key),
    name,
  };
}

/**
 * Signs in with a passkey of this site; resolves with the body for `passkeyLogin`.
 * @param {any} options the service's login options
 */
export async function getPasskey(options, { credentials = globalThis.navigator?.credentials } = {}) {
  const credential = await credentials.get({ publicKey: { ...options, challenge: fromBase64Url(options.challenge) } });
  return {
    challenge: options.challenge,
    credential_id: credential.id,
    client_data_json: toBase64Url(credential.response.clientDataJSON),
    authenticator_data: toBase64Url(credential.response.authenticatorData),
    signature: toBase64Url(credential.response.signature),
  };
}
