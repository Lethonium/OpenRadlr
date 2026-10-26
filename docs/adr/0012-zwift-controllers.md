# 12. Zwift controllers over their unencrypted protocol

Date: 2026-10-15 · Status: accepted

## Context

Riders with a Zwift Cog shift with a Zwift Click (or the Play or Ride
controllers). Without one they must reach for the keyboard during a ride.
The controllers speak a proprietary Bluetooth protocol that is not publicly
documented; community projects have described it for interoperability. Newer
firmware supports an encrypted mode (ECDH key exchange, AES), but the
controllers also accept a plain `RideOn` handshake and then send buttons in
the clear.

## Decision

- Support the controllers as **input devices only**: a codec
  (`ble/zwiftProtocol.js`) decodes notifications into neutral button names, a
  device (`ble/zwiftController.js`) handles pairing and reconnecting, and
  `input/controller.js` maps buttons to the existing keyboard actions. Ride
  logic does not change (see ADR 0006).
- Use only the **unencrypted mode**. We implement from public descriptions,
  ship no Zwift code or keys, and use the protocol solely so riders can use
  hardware they own with OpenRadlr (interoperability; this is not legal advice).
  The name "Zwift" is used only to say which devices work.
- Navigate menus by moving the **DOM focus**, so every button already on
  screen becomes reachable without per-screen controller code. A two-button
  Click gets its menu and select actions from a chord of both buttons.

## Consequences

- No crypto and no extra dependencies; codec and mapping are pure and
  unit-tested with byte fixtures and fakes.
- If Zwift ships firmware that requires encryption, buttons stop arriving;
  the diagnostics log shows the handshake answer, and an encrypted mode can be
  added inside `ble/` without touching the input layer.
- Real-hardware behaviour (firmware differences, sleep timing) can only be
  verified by riders; packets are logged in *Device diagnostics* for reports.
