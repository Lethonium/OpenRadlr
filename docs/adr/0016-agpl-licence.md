# 16. AGPL for the code, CC BY-SA for the art, the name reserved

Date: 2026-10-23 · Status: accepted

## Context

OpenRadlr is going public (#12). It is a game server that anyone can host,
next to an official server at openradlr.com. Under the MIT licence the project started with, anyone
could take the server, improve it and run it as a closed, paid service, with
none of the improvements coming back. GPL-3.0 and MPL-2.0 don't change that:
their copyleft applies when the software is distributed, not when it runs as a
service. The logo and icons are images, for which software licences are an
awkward fit, and the name needs protection a copyright licence can't give.

## Decision

- **Code:** GNU AGPL v3 or later. Whoever offers a modified server to others
  over a network must offer them its source.
- **Artwork** (image files): CC BY-SA 4.0, see `ASSETS-LICENSE.md`.
- **Name and logo:** reserved as a brand, see `TRADEMARKS.md`.
- **Contributions:** inbound = outbound, no CLA.

The switch happens before the first public release, so no MIT version of
OpenRadlr is ever published.

## Consequences

- Self-hosting stays free and unrestricted; only modified servers offered to
  others must publish their source. Unmodified servers and configuration
  changes need nothing.
- Some companies avoid AGPL code; we accept fewer corporate users for that.
- Without a CLA, the project can't later be relicensed under proprietary
  terms without asking every contributor. The current copyright holders keep
  every right to their own code, including running the official server.
- The client is served to every rider, so its source is public anyway; the AGPL
  matters mostly for the server.
