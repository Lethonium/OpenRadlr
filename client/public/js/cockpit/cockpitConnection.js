import { Emitter } from "../util/emitter.js";
import { ClientMessages, parseServerMessage } from "../net/protocol.js";

const RETRY_DELAYS_MS = [1000, 2000, 4000, 8000, 10000];

/**
 * The phone's watching connection: says hello, watches the screen key and
 * hands on what the tablet's ride sends. Reconnects with a growing delay.
 * Emits "status" ({ live, name }), "state" (a state or studio_state
 * message), "display" (the data of a display frame) and "invalid" (the
 * server refused the key; no more retries). `view` is what the watcher
 * wants relayed: "data" (only the host's rider) or "world" (everyone).
 */
export class CockpitConnection extends Emitter {
  #socket = null;
  #stopped = false;
  #failures = 0;

  constructor({ url, createSocket = (u) => new WebSocket(u), key, schedule = (fn, ms) => setTimeout(fn, ms), view = "data", device }) {
    super();
    Object.assign(this, { url, createSocket, key, schedule, view, device });
  }

  start() {
    this.#stopped = false;
    this.#connect();
  }

  stop() {
    this.#stopped = true;
    this.#socket?.close();
  }

  #connect() {
    const socket = this.createSocket(this.url);
    this.#socket = socket;
    socket.addEventListener("open", () => this.#send(socket, ClientMessages.hello()));
    socket.addEventListener("message", (event) => {
      if (socket !== this.#socket) return;
      const message = parseServerMessage(event.data);
      if (message) this.#handle(socket, message);
    });
    socket.addEventListener("close", () => {
      if (socket !== this.#socket || this.#stopped) return;
      const delay = RETRY_DELAYS_MS[Math.min(this.#failures, RETRY_DELAYS_MS.length - 1)];
      this.#failures += 1;
      this.schedule(() => {
        if (!this.#stopped) this.#connect();
      }, delay);
    });
  }

  #handle(socket, message) {
    switch (message.type) {
      case "welcome":
        this.#failures = 0;
        this.#send(socket, ClientMessages.watch(this.key, this.view, this.device));
        break;
      case "watch_status":
        this.emit("status", { live: Boolean(message.live), name: message.name, riderId: message.rider_id ?? null });
        break;
      case "state":
      case "studio_state":
        this.emit("state", message);
        break;
      case "display":
        this.emit("display", message.data);
        break;
      case "error":
        if (message.code === "bad_screen_key") {
          this.#stopped = true;
          socket.close();
          this.emit("invalid");
        }
        break;
    }
  }

  #send(socket, message) {
    socket.send(JSON.stringify(message));
  }
}
