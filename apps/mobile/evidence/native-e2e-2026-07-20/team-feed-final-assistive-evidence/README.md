# Team feed Android Release final acceptance

Date: 2026-07-20
Device: disposable Android API 36 emulator, 1080 × 2400 px at 420 dpi
(412 × 915 dp viewport class)
App: native frames from a non-debuggable `app.crew.next.evidence`
`releaseEvidence` build; the post-capture write-fence hardening was rebuilt but
not installed
Result: **PASS for the Android production Event Hub / Team Feed native gate,
with the later race hardening accepted by deterministic interleaving tests and
a current-source Release-evidence build**

## End-to-end result

The participant used the production route
`Events → Crew Team Day 2026 → Event Hub → Feed` and entered one deterministic
message through the real Team Feed composer. The facade was already detached,
so the production encrypted outbox retained one `feed.entry.create` mutation
and the UI rendered `LOKAL GESPEICHERT`.

The package process was then force-stopped and relaunched without uninstalling,
clearing app data, changing the session, or using a hidden reset. The same one
queued row and local message remained visible in
`01b-queued-after-relaunch-1080x2400.png`.

While transport remained detached, the isolated fixture control changed
exactly one server-side active membership from participant version 1 to viewer
version 2. This conditional database control models an already-committed owner
membership action; it does not claim that an owner UI was exercised in this
specific replay. The production Event Service owner-command contract is
covered independently by the focused integration regression.

After transport reattachment, production `MobileSyncEngine` sent the unchanged
request. Event Service returned an HTTP-200 sync envelope whose single result
was `rejected/FORBIDDEN`. PostgreSQL retained exactly one rejected/FORBIDDEN
receipt and zero participant feed entries or revisions. Mobile Data retained
the local mutation as `dead_letter`; Team Feed rendered
`AKTION ERFORDERLICH`, the local recovery text, and `Beitrag kopieren`.

The sanitized facade trace contains four `sync-push` attempts: three detached
503 responses and one forwarded downstream 200 response. All four had one
request fingerprint and one body fingerprint, so the process restart and
retries did not create a second mutation identity or body.

## Stale-role defect found and fixed

The first successful native rejection exposed a production authorization UX
defect: `TeamProductionRuntime.refresh()` updated SQLite but the existing
runtime still published its constructor-time participant role. The rejected
entry was correct, but the composer remained visible until the screen created
a second runtime.

The final implementation now re-reads and validates the active local membership
immediately after a successful authoritative sync. The shared role source is
also read dynamically by `TeamCollaborationController`. Missing or invalid
post-sync membership state is forced to viewer before failure, so another feed,
decision, or team-management write cannot escape the refreshed scope.

Focused regressions prove that participant → viewer in the same runtime:

- returns `canPost=false` immediately;
- preserves the Attention row;
- rejects another `createFeedEntry` before enqueue;
- keeps account/scope failures read-only and performs no additional write.

A Release-evidence bundle containing that stale-role fix was built and installed
over the same app sandbox, preserving the authenticated session and encrypted
database.
`04-viewer-attention-final-1080x2400.png` is the final role-correct frame:
`NUR ANSEHEN` is present, composer and submit controls are absent, and the
Attention/copy recovery remains available.

## Post-capture write-fence hardening

A final parallel audit found a narrower time-of-check/time-of-use gap after the
native frames were captured. Feed creation checked the dynamic role before
asynchronous event/device reads; assignments and decision responses likewise
could wait for a device identity after their earlier role check. A completed
parallel refresh could therefore downgrade the runtime to viewer before the
outbox call.

The current implementation resolves every required asynchronous read first,
then synchronously rechecks both active account and the dynamic role immediately
before each enqueue. The three affected paths are feed entry creation, team
assignment publication, and decision response submission. Three deterministic
interleaving regressions pause the write on device-identity resolution, complete
the authority change, and verify that no outbox method is called.

The retained native frames predate this final write-fence hardening and are not
claimed as proof of that race. No view, copy, accessibility, navigation, storage,
sync-envelope, or native-platform code changed, so their UI and native-flow
claims remain applicable. A new current-source `assembleReleaseEvidence` build
passed; its unsigned APK and embedded Hermes bundle hashes are recorded
separately in `SOURCE_HASHES.md`. It was intentionally not installed or run.

A later independent source-level audit found two additional, narrower
interleavings around assignment projection and decision replacement. They were
closed with final active-account and dynamic-role fences plus identifier-free
downgrade projection. The retained native run is not claimed to have reproduced
or induced those races. A second fresh current-source Release-evidence build
binds the unchanged native/UI claims to the final source; `SOURCE_HASHES.md`
records the final APK/bundle and source/test hashes.

## Copy and assistive evidence

- `05-talkback-bound-copy-overlay-1080x2400.png` was captured from the final
  rebuilt APK. The green TalkBack focus rectangle is on the `CREW` header and
  proves TalkBack was bound; it is **not** claimed as copy-button focus. The
  Android system clipboard overlay separately proves that the native
  `Beitrag kopieren` action wrote the deterministic local message to the system
  clipboard.
- The production UI regression separately invokes both the visible copy button
  and the body custom accessibility action, verifies the exact
  `Clipboard.setString` value, and verifies the independent
  `AccessibilityInfo.announceForAccessibility('Beitrag kopiert.')` call.
- `01-queued-talkback-focus-1080x2400.png` retains the native queued transition
  focus proof: its green rectangle is on `LOKAL GESPEICHERT`. It proves focus on
  the live status, not an exact speech transcript.
- The final source/test binding verifies that the Attention summary is a status
  live region, the entry status is `polite`, the body exposes a named custom
  copy action, and the visible recovery button remains a normal native button.

Raw UI hierarchy dumps are deliberately not retained. `sanitized-proof.json`
contains only semantic counts and booleans for queued, Attention, viewer,
composer, submit, and copy states.

## Large Text and IME

`06-viewer-attention-large-text-1080x2400.png` is the final rebuilt APK at
Android font scale 2.0. The read-only explanation, local Attention body/status,
and copy recovery remain fully rendered and reachable without clipped text.

The production participant composer and IME gate remains bound by
`../team-feed-ime-release-evidence/README.md`: on the same API-36 / 412 × 915
viewport class at font scale 2.0, the multiline input bottom met the IME top
with zero overlap and the submit control remained reachable. That evidence also
records the TalkBack field → character count → submit order. The current
viewer frame intentionally contains no composer or IME because the refreshed
role is read-only.

## Payload-free oracles

`sanitized-proof.json` is the retained DB/API/outbox oracle. It contains only:

- membership versions and aggregate role counts before/after the transition;
- facade outcomes/statuses and fingerprint cardinalities;
- Event Service rejected/FORBIDDEN receipt counts;
- zero participant feed-entry/revision counts;
- local semantic counts for queued, Attention, viewer, composer, submit, and
  copy states;
- runtime, accessibility, lifecycle, and privacy booleans.

It contains no raw message, account/event/feed/request identifier, filesystem
path, token, secret link, bearer, session, database row, or raw trace.
Screenshots intentionally show the deterministic UI message because they are
visual product evidence, not machine-readable DB/API/outbox oracles.

## Release boundary and gates

- Native-capture `assembleReleaseEvidence`: pass. That artifact inherited
  Release/Hermes, was locally debug-certificate signed only for emulator
  installation, verified APK Signature Schemes v2/v3, reported no debuggable
  flag, and rejected `run-as`. Shipping Release configuration was not changed.
- Post-hardening current-source `assembleReleaseEvidence`: pass. Its unsigned
  APK was not installed; the embedded Hermes bundle is byte-identical to the
  generated bundle. Both native-capture and post-hardening hashes are separated
  in `SOURCE_HASHES.md`.
- Mobile Jest after write-fence hardening: 63/63 suites, 539/539 tests.
- Team Feed + Team Collaboration focused Jest after the final authority-race
  hardening: 35/35 tests.
- Mobile TypeScript: pass.
- Focused ESLint for the changed runtime/controller/test files: pass.
- Mobile Data participant → viewer dead-letter regression: pass.
- Event Service downgrade → rejected/FORBIDDEN integration regression: pass.
- Native final viewer and font-scale-2.0 Maestro flows: pass.
- No commit, push, deployment, distribution signing, store upload, or hidden
  session/data reset was performed.

The earlier two-user restart/replay/organizer-readback and visible logout gates
remain covered by
`../../native-e2e-2026-07-19/team-orientation-a-evidence-matrix.md` and
`../../native-e2e-2026-07-19/team-orientation-b-evidence-matrix.md`.

## Cleanup

The evidence APK/package, reverse mapping, disposable emulator/AVD, isolated
runner and Redis process, exact disposable PostgreSQL databases, and all
transient setup/trace/credential files were removed after capture. Existing
Metro 8081 / PID 45252 and the shared PostgreSQL server were left untouched.
