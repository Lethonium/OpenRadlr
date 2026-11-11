# Reliable Strava uploads — design

Date: 2026-11-11 · Scope: end-of-ride and recovered-ride uploads

## Problem

The finish screen treats an accepted upload that is still processing after 30
seconds as saved, clears the recovery copy, and offers no activity link or way
to check again. A failed status request offers a new POST, risking duplicates.
The async callback reads global ride state and can clear a subsequent ride.
Account permission failures and disconnected accounts have no useful finish-screen
path. Upload actions compete with three file downloads in one row.

## Decision

- Use an injected, observable upload controller per athlete and recorded ride.
  Separate submission, processing, pending, status-check failure, rejected,
  uncertain submission, and confirmed success. A bounded polling window is not
  success. Retry a known upload by polling its ID, never by submitting again.
- Persist a small receipt in localStorage (athlete ID + first sample timestamp;
  upload ID, activity ID, phase). Save a submitting marker before the POST so an
  interrupted submission is shown as uncertain after reload. Never auto-submit.
  Storage failure degrades to in-memory tracking and is visible in the UI.
- A lost POST response is ambiguous: ask the rider to check Strava before an
  explicitly confirmed resubmission. Do not promise exactly-once delivery across
  tabs or a lost server response.
- Only an activity ID confirms success. Detaching a screen stops future polling
  and callbacks to that screen. An in-flight response may still update its own
  receipt. UI callbacks capture a ride identity, not mutable global ride state.
- Keep an unsaved finished ride and its photos when returning to the menu; the
  existing recovery panel provides download, reconnect and status checking.
- Give Strava a separate panel: account, clear status, one state-appropriate
  action, an activity link on success, and photo instructions. Give file exports
  their own area. Use the same panel logic for recovery, English and German,
  live announcements and busy state. No automatic uploads or real uploads in QA.

## Validation

Node tests use injected transport, storage and time: pending is not success;
resume after reload; polling failure never reposts; concurrent clicks submit
once; immediate success/rejection; ambiguous submission; unavailable storage;
disposal during submission/poll; account-scoped receipts; safe view actions;
recovery retention. Run make check and inspect desktop/mobile screenshots with
the real backend and intercepted Strava responses.

## Visual review

Use the existing start-menu Strava row: small brand mark, account name, and a
quiet outlined action. No nested card, coloured status border, ready headline,
or introductory paragraph. Only progress and problems need status copy. Image
instructions belong once in Summary & photos, with an explicit Save summary
image action. File formats are collapsed under Download ride file. The finish
footer stays in normal flow so it cannot cover an upload button on a short
screen.

The Strava request sends only FIT/TCX, not the summary PNG. The public Strava
API reference has no media-upload endpoint; images can be attached manually
through Edit Activity. Do not imply that sharing a file automatically attaches
it to an existing activity.

## Inline upload states

The account and actions stay in one row through submission, processing, pending,
success and errors. Busy buttons carry a spinner; a checked Uploaded link opens
the activity. Retry actions carry an error indicator, while terminal rejection
links to Strava with its explanation. Details remain in tooltips and accessible
descriptions, and the live region announces status without adding visible lines.
Reduced-motion preferences stop the spinner animation. Account names truncate
when space is tight; the two uncertain-submission actions retain their safeguards.
Periodic menu refreshes preserve the recovery binding for the same snapshot and
account, so an in-flight check is not cancelled by a presentation refresh.
