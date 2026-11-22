import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import { parseServerMessage } from "../public/js/net/protocol.js";
import { parseIndoorBikeData, parseControlPointResponse, OpCode } from "../public/js/ble/ftms.js";
import { parseCyclingPowerMeasurement } from "../public/js/ble/cyclingPower.js";
import { parseHeartRate } from "../public/js/ble/heartRate.js";

// The normal suite is repeatable; scheduled runs inject a different seed.
const options = {
  seed: Number(process.env.FUZZ_SEED ?? 20261118),
  numRuns: Number(process.env.FUZZ_RUNS ?? 500),
  ...(process.env.FUZZ_PATH ? { path: process.env.FUZZ_PATH } : {}),
};
const assertProperty = (property) => fc.assert(property, options);
const packet = fc.uint8Array({ maxLength: 80 });

// Notifications commonly occupy a slice of a larger Bluetooth buffer.
function viewOf(bytes) {
  const backing = new Uint8Array(bytes.length + 7);
  backing.set(bytes, 3);
  return new DataView(backing.buffer, 3, bytes.length);
}

test("fuzz: arbitrary server text is rejected or preserves a JSON message", () => {
  assertProperty(fc.property(fc.string({ maxLength: 2048 }), (text) => {
    const message = parseServerMessage(text);
    if (message !== null) assert.deepEqual(message, JSON.parse(text));
  }));
});

test("fuzz: recognized JSON server messages preserve arbitrary payloads", () => {
  assertProperty(fc.property(fc.constantFrom("state", "chat", "error", "display"), fc.jsonValue(), (type, payload) => {
    const message = { type, payload };
    const text = JSON.stringify(message);
    // JSON normalizes values such as -0 before they reach the wire.
    assert.deepEqual(parseServerMessage(text), JSON.parse(text));
  }));
});

test("fuzz: unknown message types are rejected for arbitrary JSON payloads", () => {
  assertProperty(fc.property(fc.jsonValue(), (payload) => {
    assert.equal(parseServerMessage(JSON.stringify({ type: "not-a-protocol-message", payload })), null);
  }));
});

for (const [name, decode] of [
  ["heart rate", parseHeartRate],
  ["cycling power", parseCyclingPowerMeasurement],
  ["indoor bike", parseIndoorBikeData],
]) {
  test(`fuzz: ${name} notifications yield finite readings or reject a short packet`, () => {
    assertProperty(fc.property(packet, (bytes) => {
      let readings;
      try {
        readings = decode(viewOf(bytes));
      } catch (error) {
        // The raw decoders reject truncated packets via DataView's bounds
        // checks. Any other exception is a regression.
        assert.ok(error instanceof RangeError);
        return;
      }
      for (const value of typeof readings === "number" ? [readings] : Object.values(readings)) {
        assert.ok(Number.isFinite(value));
      }
    }));
  });
}

test("fuzz: a control response is accepted only with its complete response header", () => {
  assertProperty(fc.property(packet, (bytes) => {
    const response = parseControlPointResponse(viewOf(bytes));
    if (bytes.length < 3 || bytes[0] !== OpCode.RESPONSE) assert.equal(response, null);
    else assert.deepEqual(response, { requestOpCode: bytes[1], resultCode: bytes[2], success: bytes[2] === 1 });
  }));
});

test("fuzz: heart rate preserves both Bluetooth integer formats", () => {
  assertProperty(fc.property(fc.integer({ min: 0, max: 65535 }), fc.integer({ min: 0, max: 255 }), (wide, narrow) => {
    assert.equal(parseHeartRate(viewOf(Uint8Array.of(1, wide & 255, wide >> 8))), wide);
    assert.equal(parseHeartRate(viewOf(Uint8Array.of(0, narrow))), narrow);
  }));
});

// The Bluetooth field layout is independent of the decoder's offset code.
const ftmsFields = [
  { present: (flags) => !(flags & 1), width: 2, field: "speedKmh", scale: 100 },
  { bit: 1, width: 2 },
  { bit: 2, width: 2, field: "cadence", scale: 2 },
  { bit: 3, width: 2 },
  { bit: 4, width: 3 },
  { bit: 5, width: 2 },
  { bit: 6, width: 2, field: "power", signed: true },
  { bit: 7, width: 2 },
  { bit: 8, width: 5 },
  { bit: 9, width: 1, field: "heartRate" },
];

test("fuzz: FTMS measurements keep their fields across optional flag combinations", () => {
  assertProperty(fc.property(fc.integer({ min: 0, max: 1023 }), fc.uint8Array({ minLength: 40, maxLength: 40 }), (flags, bytes) => {
    const view = viewOf(bytes);
    view.setUint16(0, flags, true);
    const expected = {};
    let offset = 2;
    for (const spec of ftmsFields) {
      if (!(spec.present ? spec.present(flags) : flags & (1 << spec.bit))) continue;
      if (spec.field) {
        const raw = spec.width === 1 ? view.getUint8(offset) : spec.signed ? view.getInt16(offset, true) : view.getUint16(offset, true);
        expected[spec.field] = raw / (spec.scale ?? 1);
      }
      offset += spec.width;
    }
    assert.deepEqual(parseIndoorBikeData(view), expected);
  }));
});
