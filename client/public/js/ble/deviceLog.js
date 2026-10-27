/**
 * Diagnostics for Bluetooth devices: what was found, what was received, what failed.
 * Keeps a bounded log plus packet counters, and can render a copyable report
 * so riders can attach it to a bug report.
 */
import { Emitter } from "../util/emitter.js";

export const toHex = (dataView) =>
  Array.from(new Uint8Array(dataView.buffer, dataView.byteOffset, dataView.byteLength), (b) => b.toString(16).padStart(2, "0")).join(" ");

export class DeviceLog extends Emitter {
  entries = [];
  packets = {};

  /** @param {{maxEntries?: number, maxPacketsLoggedPerSource?: number, now?: () => number}} [options] */
  constructor({ maxEntries = 300, maxPacketsLoggedPerSource = 20, now = () => Date.now() } = {}) {
    super();
    this.maxEntries = maxEntries;
    this.maxPacketsLoggedPerSource = maxPacketsLoggedPerSource;
    this.now = now;
    this.startedAt = now();
  }

  info(message) {
    this.#add({ level: "info", message });
  }

  error(message) {
    this.#add({ level: "error", message });
  }

  /** Counts a packet without logging it (e.g. a controller's idle messages): the report shows they arrive. */
  count(source) {
    this.packets[source] = (this.packets[source] ?? 0) + 1;
  }

  /**
   * Counts a raw notification and logs the first few of each source verbatim.
   * @param {string} source
   * @param {DataView} view
   * @param {object} parsed
   */
  packet(source, view, parsed) {
    const count = (this.packets[source] = (this.packets[source] ?? 0) + 1);
    if (count <= this.maxPacketsLoggedPerSource) {
      this.#add({ level: "packet", message: `${source} #${count}: ${toHex(view)} → ${JSON.stringify(parsed)}` });
    } else {
      this.emit("packet", { source, count });
    }
  }

  #add({ level, message }) {
    const entry = { t: ((this.now() - this.startedAt) / 1000).toFixed(2), level, message };
    this.entries.push(entry);
    if (this.entries.length > this.maxEntries) this.entries.shift();
    this.emit("entry", entry);
  }

  report(extra = {}) {
    const header = [
      `OpenRadlr device diagnostics`,
      ...(extra.build ? [`Build: ${extra.build}`] : []),
      `User agent: ${extra.userAgent ?? "unknown"}`,
      `Packets: ${JSON.stringify(this.packets)}`,
      "",
    ];
    return [...header, ...this.entries.map((e) => `[${e.t}s] ${e.level.toUpperCase()} ${e.message}`)].join("\n");
  }
}
