/**
 * The account service at `/id` (ADR 0032): sign-in by emailed code or passkey,
 * linking rider keys and backing them up. The session is an HttpOnly cookie the
 * browser sends by itself; this module never sees it.
 *
 * `fetch` is injected for tests.
 */

export class AccountError extends Error {
  /**
   * @param {string} code the server's error code, or "offline"
   * @param {number} status the HTTP status, 0 without an answer
   */
  constructor(code, status) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

const enc = encodeURIComponent;

export class AccountClient {
  /** @param {{fetch?: typeof fetch, base?: string}} [deps] */
  constructor({ fetch = globalThis.fetch?.bind(globalThis), base = "/id/v1" } = {}) {
    this.fetch = fetch;
    this.base = base;
  }

  /** The answer's JSON (null for 204); throws an AccountError for anything else. */
  async #request(method, path, body) {
    const init = {
      method,
      credentials: "same-origin",
      // The server takes changes only as JSON from its own origin: no form can forge one.
      headers: method === "GET" ? { Accept: "application/json" } : { "Content-Type": "application/json", Accept: "application/json" },
      ...(method === "GET" ? {} : { body: JSON.stringify(body ?? {}) }),
    };
    let response;
    try {
      response = await this.fetch(`${this.base}${path}`, init);
    } catch {
      throw new AccountError("offline", 0);
    }
    if (response.status === 204) return null;
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new AccountError(data?.error ?? `http_${response.status}`, response.status);
    return data;
  }

  /** The signed-in account (email, passkeys, riders), or null when signed out. */
  async me() {
    try {
      return await this.#request("GET", "/me");
    } catch (error) {
      if (error.status === 401) return null;
      throw error;
    }
  }

  startEmail(email, lang) {
    return this.#request("POST", "/email/start", { email, lang });
  }

  /** Signs in; the answer is `me()` plus `created` (a new account). */
  verifyEmail(email, code) {
    return this.#request("POST", "/email/verify", { email, code });
  }

  logout() {
    return this.#request("POST", "/logout");
  }

  /** Deletes the account; `lang` is the language of the confirmation mail. */
  deleteAccount(lang) {
    return this.#request("DELETE", "/account", { lang });
  }

  passkeyRegisterOptions() {
    return this.#request("POST", "/passkeys/register/options");
  }

  passkeyRegister(body) {
    return this.#request("POST", "/passkeys/register", body);
  }

  passkeyLoginOptions() {
    return this.#request("POST", "/passkeys/login/options");
  }

  passkeyLogin(body) {
    return this.#request("POST", "/passkeys/login", body);
  }

  deletePasskey(id) {
    return this.#request("DELETE", `/passkeys/${enc(id)}`);
  }

  async riderChallenge() {
    return (await this.#request("POST", "/riders/challenge")).challenge;
  }

  /** Links the rider key; resolves with the rider's id at the service. */
  async linkRider({ publicKey, challenge, signature, name }) {
    return (await this.#request("POST", "/riders", { public_key: publicKey, challenge, signature, name })).rider_id;
  }

  putSnapshot(riderId, snapshot) {
    return this.#request("PUT", `/riders/${enc(riderId)}/snapshot`, snapshot);
  }

  async rideIds(riderId) {
    return (await this.#request("GET", `/riders/${enc(riderId)}/rides`)).ids;
  }

  putRide(riderId, rideId, ride) {
    return this.#request("PUT", `/riders/${enc(riderId)}/rides/${enc(rideId)}`, ride);
  }
}
