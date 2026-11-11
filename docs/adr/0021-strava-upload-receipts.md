# 0021 — Track Strava submission separately from ride saving

## Context

Strava uploads are asynchronous. A successful POST only accepts a file for
processing; a later response with an activity ID confirms success. The previous
finish-screen handler cleared the recovery copy after its polling budget expired
and offered a fresh POST after status-check failures. Its callbacks referenced the
current global ride, even when the originating ride had already been left.

## Decision

Use an injected `StravaUpload` controller and a shared panel binding for finish
and recovery. Store receipts under `openradlr.strava-upload.<athlete>:<first-sample>`
in localStorage: phase, upload ID, activity ID, and failure metadata. Keep ride
files/photos in the existing IndexedDB autosave, never in the receipt. The origin
scopes the server, and the athlete scopes the Strava account.

Persist a submission marker before the POST and an upload ID before polling.
Resume accepted uploads by polling that ID. Poll for a bounded window with at
least two seconds between requests; a pending result remains pending. Bound each
HTTP request at 30 seconds. Only an activity ID produces success. A lost POST
response is uncertain, with an activities link and explicit confirmation before
resubmitting. No automatic upload on opening or reloading a screen.

Disposing a screen stops future polling and all UI/save callbacks. In-flight
responses can still update their own receipt. Read the latest receipt again on
an explicit action, including when it arrived after the recovery panel opened.
Keep unsaved finished rides when leaving for the menu, only promise recovery
after the final snapshot write succeeded, and retain the snapshot through an
OAuth redirect. A confirmed recovered upload keeps its photos and activity link
until the rider selects Done.

## Consequences

Retries no longer blindly create duplicate uploads, and processing delays do not
silently remove the local ride. English/German views share one state-to-action
mapping, independently tested from the transport and controller.

This is browser-local resumability, not server-side exactly-once delivery. A lost
POST response has no upload ID to reconcile. Separate tabs are not locked against
simultaneous submissions. Receipts degrade to memory with a visible warning if
localStorage is unavailable; they contain no OAuth tokens or ride telemetry.
Receipts remain after a ride is dismissed to recognize that ride if restored;
clearing site data removes them. A server-side upload ledger can follow if
cross-tab/device coordination is needed.
