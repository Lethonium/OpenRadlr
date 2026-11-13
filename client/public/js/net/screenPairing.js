import { Emitter } from "../util/emitter.js";
import { ClientMessages, parseServerMessage } from "./protocol.js";

const KEY_STORAGE = "openradlr.screenKey";
const PAIRED_STORAGE = "openradlr.screenPaired";
const OPEN = 1;

const makeKey = (randomBytes) => [...randomBytes(16)].map((b) => b.toString(16).padStart(2, "0")).join("");

/** The tablet's screen key: 32 lowercase hex characters, created once and kept. */
export function screenKey(storage, randomBytes) {
  const stored = storage?.getItem(KEY_STORAGE);
  if (stored && /^[0-9a-f]{32}$/.test(stored)) return stored;
  const key = makeKey(randomBytes);
  storage?.setItem(KEY_STORAGE, key);
  return key;
}

/** A new key: the old pairings no longer reach this tablet. */
export function renewScreenKey(storage, randomBytes) {
  const key = makeKey(randomBytes);
  storage?.setItem(KEY_STORAGE, key);
  storage?.removeItem(PAIRED_STORAGE);
  return key;
}

export const isPaired = (storage) => storage?.getItem(PAIRED_STORAGE) === "1";

/**
 * The tablet's side of pairing: one connection that offers the screen key and
 * waits for a phone to claim the code. Emits "code" ({ code, expiresInS }),
 * "claimed" and "error" (the server's { code, message }).
 */
export class PairingSession extends Emitter {
  #socket = null;
  #welcomed = false;

  constructor({ url, createSocket = (u) => new WebSocket(u), key, name, storage }) {
    super();
    Object.assign(this, { url, createSocket, key, name, storage });
  }

  start() {
    const socket = this.createSocket(this.url);
    this.#socket = socket;
    this.#welcomed = false;
    socket.addEventListener("open", () => this.#send(ClientMessages.hello()));
    socket.addEventListener("message", (event) => {
      if (socket !== this.#socket) return;
      const message = parseServerMessage(event.data);
      if (!message) return;
      if (message.type === "welcome") {
        this.#welcomed = true;
        this.#offer();
      } else if (message.type === "pair_code") {
        this.emit("code", { code: message.code, expiresInS: message.expires_in_s });
      } else if (message.type === "pair_claimed") {
        this.storage?.setItem(PAIRED_STORAGE, "1");
        this.emit("claimed");
      } else if (message.type === "error") {
        this.emit("error", { code: message.code, message: message.message });
      }
    });
  }

  /** A fresh code; connects anew when the server already closed the connection. */
  renew() {
    if (this.#socket?.readyState === OPEN && this.#welcomed) this.#offer();
    else this.start();
  }

  close() {
    this.#socket?.close();
  }

  #offer() {
    this.#send(ClientMessages.pairOffer({ key: this.key, name: this.name }));
  }

  #send(message) {
    if (this.#socket?.readyState === OPEN) this.#socket.send(JSON.stringify(message));
  }
}

/** The phone's side: claims a code. Resolves with { key, name }; rejects with `code` set on a server error. */
export function claimCode({ url, createSocket = (u) => new WebSocket(u), code }) {
  return new Promise((resolve, reject) => {
    const socket = createSocket(url);
    let done = false;
    const finish = (settle, value) => {
      if (done) return;
      done = true;
      settle(value);
      socket.close();
    };
    socket.addEventListener("open", () => socket.send(JSON.stringify(ClientMessages.hello())));
    socket.addEventListener("message", (event) => {
      const message = parseServerMessage(event.data);
      if (!message) return;
      if (message.type === "welcome") socket.send(JSON.stringify(ClientMessages.pairClaim(code)));
      else if (message.type === "paired") finish(resolve, { key: message.key, name: message.name });
      else if (message.type === "error") finish(reject, Object.assign(new Error(message.message ?? message.code), { code: message.code }));
    });
    socket.addEventListener("close", () => finish(reject, new Error("closed before the code was claimed")));
    socket.addEventListener("error", () => finish(reject, new Error("cannot connect")));
  });
}
