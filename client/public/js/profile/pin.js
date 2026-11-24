/**
 * An optional PIN on a rider profile (#114): a lock in the UI, not encryption. The data
 * stays in the browser's storage; the PIN only keeps others from opening a profile by
 * accident. Only a salted PBKDF2 hash is stored, never the PIN. Crypto and randomness
 * are injected for testability.
 */

export const PIN_ITERATIONS = 100_000;
const SALT_BYTES = 16;
const HASH_BITS = 256;

/** A PIN is four or more digits (a numeric keypad on a tablet). */
export const isValidPin = (pin) => typeof pin === "string" && /^[0-9]{4,}$/.test(pin);

const defaultRandom = (length) => globalThis.crypto.getRandomValues(new Uint8Array(length));

const toBase64 = (bytes) => btoa(String.fromCharCode(...bytes));
const fromBase64 = (text) => Uint8Array.from(atob(text), (char) => char.charCodeAt(0));

async function derive(pin, salt, iterations, subtle) {
  const key = await subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveBits"]);
  const bits = await subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, HASH_BITS);
  return new Uint8Array(bits);
}

/**
 * The record to store for a PIN: `{ salt, hash, iterations }`, all text and numbers.
 * @param {string} pin
 * @param {{subtle?: SubtleCrypto, random?: (length: number) => Uint8Array, iterations?: number}} [deps]
 */
export async function hashPin(pin, { subtle = globalThis.crypto?.subtle, random = defaultRandom, iterations = PIN_ITERATIONS } = {}) {
  const salt = random(SALT_BYTES);
  const hash = await derive(pin, salt, iterations, subtle);
  return { salt: toBase64(salt), hash: toBase64(hash), iterations };
}

/** Whether `pin` matches a stored record. A damaged record never matches and never throws. */
export async function verifyPin(pin, record, { subtle = globalThis.crypto?.subtle } = {}) {
  try {
    if (!record || typeof record.salt !== "string" || typeof record.hash !== "string") return false;
    if (!Number.isInteger(record.iterations) || record.iterations < 1) return false;
    const expected = fromBase64(record.hash);
    const actual = await derive(pin, fromBase64(record.salt), record.iterations, subtle);
    if (actual.length !== expected.length) return false;
    // Compare every byte, so the time does not reveal how many matched.
    let difference = 0;
    for (let i = 0; i < actual.length; i++) difference |= actual[i] ^ expected[i];
    return difference === 0;
  } catch {
    return false;
  }
}
