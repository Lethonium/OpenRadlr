import { RouteGeometry } from "../public/js/route/geometry.js";

/** 1000 m square loop: flat, 4 % up, flat, 4 % down. */
export function squareRoute() {
  return new RouteGeometry({
    id: "square",
    name: "Square",
    lanes: 4,
    seed: 1,
    points: [
      [0, 0, 100],
      [250, 0, 100],
      [250, 250, 110],
      [0, 250, 110],
    ],
    markers: [{ type: "start_finish", distance: 0 }],
  });
}

/** Fake WebSocket that records sent frames and lets tests push server frames. */
export class FakeSocket {
  static OPEN = 1;
  readyState = 0;
  sent = [];
  #listeners = {};

  constructor(url) {
    this.url = url;
  }

  addEventListener(type, listener) {
    (this.#listeners[type] ??= []).push(listener);
  }

  dispatch(type, event = {}) {
    for (const listener of this.#listeners[type] ?? []) listener(event);
  }

  open() {
    this.readyState = FakeSocket.OPEN;
    this.dispatch("open");
  }

  receive(message) {
    this.dispatch("message", { data: JSON.stringify(message) });
  }

  send(data) {
    this.sent.push(JSON.parse(data));
  }

  close() {
    this.readyState = 3;
    this.dispatch("close");
  }
}

/** Manual scheduler replacing setInterval/clearInterval. */
export function fakeScheduler() {
  const timers = new Map();
  let nextId = 1;
  return {
    setInterval: (fn) => {
      const id = nextId++;
      timers.set(id, fn);
      return id;
    },
    clearInterval: (id) => timers.delete(id),
    fire: () => [...timers.values()].forEach((fn) => fn()),
    get active() {
      return timers.size;
    },
  };
}

export const dataView = (bytes) => new DataView(Uint8Array.from(bytes).buffer);

/**
 * A small road network file (see docs/routes.md): a round island of 30 m
 * land, a café and two junctions joined by three straight roads, and a
 * route round them.
 */
export function tinyNetworkFile() {
  const cell = 40;
  const columns = 61;
  const heights = new Int16Array(columns * columns);
  for (let r = 0; r < columns; r += 1) {
    for (let c = 0; c < columns; c += 1) {
      const x = -1200 + c * cell;
      const y = -1200 + r * cell;
      const fromCenter = Math.hypot(x - 150, y - 150);
      heights[r * columns + c] = Math.round((fromCenter < 800 ? 30 : Math.max(-20, 30 - (fromCenter - 800) / 4)) * 10);
    }
  }
  const bytes = new Uint8Array(heights.buffer);
  const line = (a, b, step = 10) => {
    const n = Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / step);
    return Array.from({ length: n + 1 }, (_, i) => [a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n, 30]);
  };
  const at = { cafe: [0, 0], east: [500, 0], north: [0, 500] };
  return {
    id: "tiny",
    name: "Tiny Island",
    seed: 5,
    version: 1,
    coast: { center: [150, 150], radius: Array(256).fill(860) },
    terrain: { x0: -1200, y0: -1200, cell, columns, rows: columns, scale: 0.1, heights: btoa(String.fromCharCode(...bytes)) },
    nodes: [
      { id: "cafe", kind: "cafe", name: "Tiny Café", x: 0, y: 0, elevation: 30 },
      { id: "east", kind: "junction", x: 500, y: 0, elevation: 30 },
      { id: "north", kind: "junction", x: 0, y: 500, elevation: 30 },
    ],
    edges: [
      { id: "south-road", from: "cafe", to: "east", type: "main", length: 500, points: line(at.cafe, at.east), markers: [{ type: "sprint", dir: 1, distance: 100, length: 200 }], zones: [] },
      { id: "diagonal", from: "east", to: "north", type: "road", length: 707, points: line(at.east, at.north), markers: [], zones: [{ type: "village", from: 200, to: 450 }] },
      { id: "west-road", from: "north", to: "cafe", type: "road", length: 500, points: line(at.north, at.cafe), markers: [], zones: [] },
    ],
    routes: [{ id: "tiny-loop", name: "Tiny Loop", seed: 9, walk: [["south-road", 1], ["diagonal", 1], ["west-road", 1]] }],
  };
}

/** The route file the generator would derive from `tinyNetworkFile`'s loop. */
export function tinyLoopFile() {
  const net = tinyNetworkFile();
  const points = net.edges.flatMap((e, i) => (i === 0 ? e.points : e.points.slice(1)));
  points.pop();
  return { id: "tiny-loop", name: "Tiny Loop", loop: true, lanes: 4, seed: 9, map: { id: "tiny", seed: 5 }, points, markers: [{ type: "start_finish", distance: 0 }], zones: [] };
}

/**
 * Decodes the FIT files our encoder writes (normal headers, little-endian):
 * every data message as `{global, values}`, values keyed by field number.
 */
export function fitMessages(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const headerSize = view.getUint8(0);
  const end = headerSize + view.getUint32(4, true);
  const definitions = new Map();
  const messages = [];
  let at = headerSize;
  while (at < end) {
    const header = view.getUint8(at);
    at += 1;
    const local = header & 0x0f;
    if (header & 0x40) {
      const global = view.getUint16(at + 2, true);
      const count = view.getUint8(at + 4);
      at += 5;
      const fields = [];
      for (let i = 0; i < count; i += 1, at += 3) fields.push({ number: view.getUint8(at), size: view.getUint8(at + 1) });
      definitions.set(local, { global, fields });
    } else {
      const { global, fields } = definitions.get(local);
      const values = {};
      for (const { number, size } of fields) {
        let value = 0;
        for (let i = 0; i < size; i += 1) value += view.getUint8(at + i) * 256 ** i;
        values[number] = value;
        at += size;
      }
      messages.push({ global, values });
    }
  }
  return messages;
}
