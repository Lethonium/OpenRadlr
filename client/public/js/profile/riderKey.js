/**
 * The rider's key pair (ADR 0003, ADR 0032).
 *
 * The private key is a non-extractable WebCrypto key in the rider's own key
 * store (an IndexedDB, see `indexedDbStore`), so no page script, export or
 * backup can read it; it can only sign. The public key, base64 SPKI, is the
 * rider's identity and stays in the profile.
 *
 * Profiles from before kept the private key as a JWK in localStorage; it is
 * imported once and removed from the profile, keeping the same public key.
 */

const RECORD = "rider";
const ECDSA = { name: "ECDSA", namedCurve: "P-256" };
const SIGN = { name: "ECDSA", hash: "SHA-256" };

/** What a rider signs to join a game server that sent `challenge` (docs/protocol.md, Signed join). */
export const joinMessage = (challenge) => `openradlr-join\n${challenge}`;

/** What a rider signs to link their key to the signed-in account. */
export const linkMessage = (challenge) => `openradlr-link\n${challenge}`;

const toBase64 = (buffer) => btoa(String.fromCharCode(...new Uint8Array(buffer)));

const withoutJwk = ({ privateKeyJwk: _dropped, ...profile }) => profile;

export class RiderKey {
  /**
   * @param {{store: {get: (key: string) => Promise<any>, put: (key: string, value: any) => Promise<void>}, subtle?: SubtleCrypto}} deps
   */
  constructor({ store, subtle = globalThis.crypto?.subtle }) {
    this.store = store;
    this.subtle = subtle;
  }

  /**
   * Makes sure the rider has a key and returns the profile to keep: with `publicKey`,
   * without `privateKeyJwk`. The same object when nothing changed; the profile as it
   * was when the store or crypto refuse (the rider then joins unsigned).
   */
  async ensure(profile) {
    try {
      return await this.#ensure(profile);
    } catch {
      return profile;
    }
  }

  async #ensure(profile) {
    const record = await this.store.get(RECORD);
    if (profile.privateKeyJwk && profile.publicKey && record?.publicKey !== profile.publicKey) {
      const privateKey = await this.subtle.importKey("jwk", profile.privateKeyJwk, ECDSA, false, ["sign"]);
      await this.store.put(RECORD, { publicKey: profile.publicKey, privateKey });
      return withoutJwk(profile);
    }
    if (record) {
      if (record.publicKey === profile.publicKey) return "privateKeyJwk" in profile ? withoutJwk(profile) : profile;
      // The profile lost its key (deleted on its own): the key that can still sign is the rider's.
      return { ...withoutJwk(profile), publicKey: record.publicKey };
    }
    const pair = await this.subtle.generateKey(ECDSA, false, ["sign", "verify"]);
    const publicKey = toBase64(await this.subtle.exportKey("spki", pair.publicKey));
    await this.store.put(RECORD, { publicKey, privateKey: pair.privateKey });
    return { ...withoutJwk(profile), publicKey };
  }

  /**
   * The signature over `message` (base64 raw r‖s), or `null` without a usable key. With
   * `publicKey` (the one the join will name), also `null` when the stored key isn't that one:
   * a signature by another key would get the join refused, an unsigned join is accepted.
   */
  async sign(message, publicKey) {
    try {
      const record = await this.store.get(RECORD);
      if (!record) return null;
      if (publicKey !== undefined && record.publicKey !== publicKey) return null;
      return toBase64(await this.subtle.sign(SIGN, record.privateKey, new TextEncoder().encode(message)));
    } catch {
      return null;
    }
  }
}
