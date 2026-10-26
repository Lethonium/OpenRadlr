import { Emitter } from "../util/emitter.js";
import { ClientMessages, parseServerMessage } from "./protocol.js";

/**
 * One connection to a game server.
 *
 * Emits: "state", "resistance", "event", "chat", "error", "close".
 * The WebSocket constructor is injected so tests can use a fake socket.
 */
export class GameConnection extends Emitter {
  #socket = null;
  riderId = null;
  serverInfo = null;
  /** Brings this rider back after a dropped connection (from `joined`, #73). */
  resumeToken = null;
  /** How long the server keeps a dropped rider, in seconds (from `welcome`). */
  graceS = 0;

  /** @param {{url: string, createSocket?: (url: string) => WebSocket}} options */
  constructor({ url, createSocket = (u) => new WebSocket(u) }) {
    super();
    this.url = url;
    this.createSocket = createSocket;
  }

  /**
   * Connects, performs the hello/join handshake and resolves with the rider id.
   * @param {{name: string, weightKg: number, publicKey?: string}} profile
   */
  join(profile) {
    return new Promise((resolve, reject) => {
      const socket = this.createSocket(this.url);
      this.#socket = socket;
      let joined = false;

      socket.addEventListener("open", () => this.#send(ClientMessages.hello()));
      socket.addEventListener("message", (event) => {
        const message = parseServerMessage(event.data);
        if (!message) return;
        switch (message.type) {
          case "welcome":
            this.serverInfo = message;
            this.graceS = message.grace_s ?? 0;
            this.#send(ClientMessages.join(profile));
            break;
          case "joined":
            joined = true;
            this.riderId = message.rider_id;
            this.resumeToken = message.resume_token ?? null;
            resolve(message.rider_id);
            break;
          case "error":
            if (!joined) reject(Object.assign(new Error(`${message.code}: ${message.message}`), { code: message.code, serverMessage: message.message }));
            this.emit("error", message);
            break;
          default:
            this.emit(message.type, message);
        }
      });
      socket.addEventListener("close", () => {
        if (!joined) reject(new Error("connection closed before joining"));
        this.emit("close");
      });
      socket.addEventListener("error", () => {
        if (!joined) reject(new Error(`could not connect to ${this.url}`));
      });
    });
  }

  sendTelemetry(reading) {
    this.#send(ClientMessages.telemetry(reading));
  }

  laneLeft() {
    this.#send(ClientMessages.laneLeft());
  }

  laneRight() {
    this.#send(ClientMessages.laneRight());
  }

  joinRace() {
    this.#send(ClientMessages.joinRace());
  }

  leaveRace() {
    this.#send(ClientMessages.leaveRace());
  }

  joinEvent(id) {
    this.#send(ClientMessages.joinEvent(id));
  }

  leaveEvent() {
    this.#send(ClientMessages.leaveEvent());
  }

  createVehicle(options) {
    this.#send(ClientMessages.createVehicle(options));
  }

  boardVehicle(code) {
    this.#send(ClientMessages.boardVehicle(code));
  }

  leaveVehicle() {
    this.#send(ClientMessages.leaveVehicle());
  }

  /** Tells the server which café workout exercise is under way (`null`: none). */
  workout(exercise) {
    this.#send(ClientMessages.workout(exercise));
  }

  /** Parks the rider for a pause (#89). */
  pause() {
    this.#send(ClientMessages.pause());
  }

  resume() {
    this.#send(ClientMessages.resume());
  }

  /** Picks the road for the next junction (`null`: stay on the route). */
  turn(edge) {
    this.#send(ClientMessages.turn(edge));
  }

  startRace(laps) {
    this.#send(ClientMessages.startRace(laps));
  }

  chat(text) {
    if (text.trim()) this.#send(ClientMessages.chat(text));
  }

  close() {
    this.#socket?.close();
  }

  /** Leaves on purpose (no grace period), then closes. */
  leave() {
    this.#send(ClientMessages.leave());
    this.close();
  }

  #send(message) {
    const OPEN = 1;
    if (this.#socket?.readyState === OPEN) this.#socket.send(JSON.stringify(message));
  }
}
