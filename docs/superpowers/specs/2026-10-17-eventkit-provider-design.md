# Apple Calendar through EventKit

**Date:** 17 October 2026
**Status:** approved, not implemented

## Why

The app reads one vendor's calendars. Everyone whose calendar lives in iCloud,
Exchange, Microsoft 365, Fastmail or any CalDAV server is told, politely, that
this is not for them. Writing a provider per vendor does not scale, and each one
brings its own consent screen, its own verification queue and its own secret to
ship.

macOS already did that work. `Calendar.app` syncs every account the user has
configured, and EventKit reads the result. One integration covers all of them,
needs no OAuth, makes no network connection and asks no administrator for
permission — which is also the documented escape hatch in `docs/spec.md` §738
for a Workspace whose admin refuses to trust our client ID.

Three further things fall out of it. The app's outbound traffic for an EventKit
account is nothing at all, which is the strongest form of the claim
`site/security.html` already makes. There is no refresh token, so the highest-risk
code in the repo is not involved. And `EKEventStore` posts a change notification,
so the agenda can update when the calendar does rather than when the poll next
comes round.

## What it is

A third `ProviderKind`, `eventkit`, alongside `google` and `mock`, reading
events from the macOS calendar store through a small bundled Swift helper.

It sits alongside Google rather than replacing it. Both appear when adding an
account. Nothing in `auth/`, `TokenVault` or the Google provider is removed:
Google-only users keep what they have, and a user can connect both.

Explicitly not in scope:

- **Writing anything.** Read-only, exact parity with what the Google provider
  does today. Quick-add still creates a TODO, not a calendar event.
- **Apple Reminders behind the TODO list.** `EKReminder` is the same framework
  and the idea is a good one, but it is a separate feature with its own storage
  and sync questions. Later, on its own merits.
- **Microsoft 365 as a direct OAuth provider.** EventKit reaches Microsoft 365
  through macOS, which is the cheap version. A direct provider stays "later,
  optional" in `docs/spec.md` §9.
- **Intel or macOS 13.** See "Minimum macOS" below.

## Minimum macOS

Rises from Ventura to **Sonoma, macOS 14**.

macOS 14 split calendar access into full and write-only and introduced
`requestFullAccessToEvents`. Supporting Ventura as well means a second,
deprecated authorisation path behind an availability check, kept alive for an OS
that is two majors behind by the time this ships. Not worth the branch.

This touches `LSMinimumSystemVersion` in `electron-builder.yml`, the requirements
line in `README.md`, and `depends_on macos:` in the Homebrew cask.

## Architecture

### The helper

`resources/eventkit-helper/` is a SwiftPM package with
`platforms: [.macOS(.v14)]`, producing an arm64 binary `up-next-eventkit`.

It owns the only `EKEventStore` in the system, speaks newline-delimited JSON on
stdin and stdout, and knows nothing of the app's domain beyond the protocol
below. It is deliberately thin: read the store, encode JSON. Logic that can live
in TypeScript does.

It also accepts a `--probe` flag, which prints the sources and calendars it can
see and exits. That is how a user on a managed Mac can report what the app is
able to see without anyone guessing.

### The TypeScript side

Under `src/main/calendar/providers/eventkit/`:

| File                       | Responsibility                                                                                                         |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `EventKitHelperProcess.ts` | Spawn, restart with backoff, correlate requests to replies, expose pushes. The only file that touches `child_process`. |
| `EventKitProtocol.ts`      | Zod schemas for every message in both directions.                                                                      |
| `EventKitAuthorizer.ts`    | `AccountAuthenticator`: trigger the TCC prompt, then enumerate sources.                                                |
| `EventKitProvider.ts`      | `CalendarProvider` for one source.                                                                                     |
| `eventKitEventMapper.ts`   | Helper JSON to `CalendarEvent`, mirroring `googleEventMapper.ts`.                                                      |

`ProviderKind` gains `'eventkit'` and `ProviderFactory` gains one branch.
`AgendaService`, `EventAggregator`, `SyncScheduler` and the entire renderer are
untouched — which is the abstraction in `docs/spec.md` §3 earning its keep.

### The one existing thing that has to change

`AccountService.connect()` and `canConnect()` hardcode `'google'`, and the
`accounts:connect` IPC channel takes no argument. Both take a `ProviderKind`.
That is a schema change on a live channel, so the row in `docs/spec.md` §8.5
changes with it — schema, sender check and table together, or it does not ship.

## Protocol

Newline-delimited JSON, every message validated by Zod on arrival. Requests
carry an `id`; replies echo it. Pushes carry no `id`.

| Direction | Message                                                            |
| --------- | ------------------------------------------------------------------ |
| → helper  | `{ id, op: "authorize" }`                                          |
| → helper  | `{ id, op: "sources" }`                                            |
| → helper  | `{ id, op: "calendars", sourceId }`                                |
| → helper  | `{ id, op: "events", sourceId, calendarIds, start, end }`          |
| ← app     | `{ id, ok: true, result }` or `{ id, ok: false, error: { kind } }` |
| ← app     | `{ event: "changed" }`                                             |

The helper is a new trust boundary. Nothing from it reaches the rest of main
unparsed, for the same reason nothing from the renderer does.

## Accounts and identity

One account per `EKSource`. The single Allow creates an account for iCloud,
another for a work Exchange account, and so on, each with its own colour and its
own line in the split view — which is what the split view is for.

- `AccountId` is `eventkit:<source.sourceIdentifier>`, stable across restarts.
- `label` is `source.title`, so "iCloud" or the Exchange account's name.
- `AccountIdentity.providerAccountId` is the source identifier, not an email
  address, so §8.7 holds without a special case.
- `listCalendars()` returns that source's calendars only. `primary` is the
  source's default calendar for new events.
- `disconnect()` drops the account from settings. There is no vendor-side grant
  to hand back and no `TokenVault` entry to delete.

## Data flow

All EventKit accounts share one helper process: one `EKEventStore` is enough,
and the TCC grant is per-app rather than per-account.

`fetchEvents` sends an `events` request. `EKEventStore`'s predicate expands
recurrence itself, so unlike Google there is no client-side expansion.

`iCalUID` comes from `EKEvent.calendarItemExternalIdentifier`, so cross-account
dedupe keeps working — including the case where the same Google account is
connected directly and through macOS Calendar.

`conferenceUrl` is the lossy part. EventKit has no structured equivalent of
Google's `conferenceData`, so the mapper tries `event.url`, then the location
field, then the notes, reusing `conferenceLinks.ts` rather than inventing a
second set of patterns.

### Change notifications

The helper subscribes to `EKEventStoreChanged` and pushes `{ event: "changed" }`.
`EventKitProvider` surfaces it as a `Signal`; `SyncScheduler` resyncs EventKit
accounts when it fires.

The existing poll stays as a backstop. A dead helper then degrades to today's
behaviour rather than to silence.

## Permissions and failure

`NSCalendarsFullAccessUsageDescription` goes in the app's Info.plist through
`extendInfo`, and `com.apple.security.personal-information.calendars` into both
`build/entitlements.mac.plist` and `build/entitlements.adhoc.plist`. TCC
attributes the grant to the app bundle, not to the helper; the helper needs only
to be signed by the same Team ID and to live inside the bundle.

`extendInfo` reaches a packaged build and nothing else, so the stock Electron
that `npm run dev` runs on has no usage string and macOS will not prompt for it
— the request fails on contact, as `promptUnavailable`. `scripts/patch-dev-electron.sh`
adds a development-build wording to `node_modules/electron/dist/Electron.app` and
re-signs it ad-hoc, since editing the Info.plist invalidates the signature it
launches under. That grant is held against `com.github.Electron`, separately
from the installed app's.

Authorisation maps onto existing statuses rather than new UI:

| State                               | Result                                                                      |
| ----------------------------------- | --------------------------------------------------------------------------- |
| `notDetermined`                     | Prompt on connect, then report what the prompt settled on.                  |
| `denied`, `restricted`, `writeOnly` | `needsReauth`, with a button opening System Settings → Privacy → Calendars. |
| `promptUnavailable`                 | Said plainly in the Accounts pane, with no System Settings button.          |

None of those three refusals are fixable inside the app, so all three say the
same thing and offer the same escape, in the pattern the widget already uses for
putting the fix next to the problem. The deep link is
`x-apple.systempreferences:com.apple.preference.security?Privacy_Calendars`.

`promptUnavailable` is the fourth state, and it is not a refusal. The request
can fail without the user ever seeing it — `requestFullAccessToEvents()` throws,
or returns false, for an app bundle with no
`NSCalendarsFullAccessUsageDescription`, because macOS will not show a calendar
prompt for one. The helper tells that apart from a Deny by re-reading
`EKEventStore.authorizationStatus(for: .event)` after the request: a real Deny
moves the status to `.denied`, a prompt that never appeared leaves it
`.notDetermined`. It crosses the wire as its own status in
`eventKitAuthorizationSchema`, reaches the renderer on the same connect-response
field as a refusal, and is kept out of `CALENDAR_ACCESS_REFUSALS` on purpose:
it is terminal, but no privacy toggle changes it, so offering that pane would
point the user at somewhere nothing is wrong. The pane says the copy of the app
cannot ask and to reinstall it. `notDetermined` itself is not a wire status —
by the time the helper answers it has either read a settled status or asked.

**Every other failure is named too, on the same field.** The four states above
were the only ones the pane could state; everything else collapsed into "Could
not connect that account", which stood in for a helper SIGKILLed for a bad
signature, a missing usage string, a request that threw, and a renderer that
`safeParse`-rejected a perfectly good reply — four causes, four fixes, one
sentence. So `ConnectAccountsResult.accessProblem` became `problem`, over the
wider `CONNECT_PROBLEMS` list, and the whole set is:

| `problem`                           | Cause                                               | Pane offers                 |
| ----------------------------------- | --------------------------------------------------- | --------------------------- |
| `denied`, `restricted`, `writeOnly` | A refusal, before or after the request.             | System Settings → Calendars |
| `promptUnavailable`                 | macOS would not show the prompt at all.             | Reinstall.                  |
| `helperUnavailable`                 | `helper_unavailable`: no spawn, or a dead child.    | Restart, then reinstall.    |
| `timedOut`                          | `timeout`, including an unanswered 5-minute prompt. | Answer it, then try again.  |
| `helperMismatch`                    | `protocol`, `bad_request`, `unknown_source`.        | Restart, then reinstall.    |
| `storeUnreadable`                   | `store_failure`: granted, and still unreadable.     | Open Calendar, then retry.  |

Three kinds are merged into `helperMismatch` because they differ to us and not
to the user: in all three the two halves of the app disagree about the
conversation, and nothing but a restart or a reinstall addresses any of them.
Six messages that all mean "something went wrong" would be worse than two that
mean something. The map lives in `infra/errors.ts` as a `Record` over
`EventKitError['kind']`, so it is total and a new kind will not compile until
its copy exists; the copy itself is a `Record` over `ConnectProblem` in
`renderer/settings/connectProblemCopy.ts`, total for the same reason.

The renderer is given the wire name and never the error. A raw message can
carry a filesystem path, and on the Google side an email address, so the
detail stays in the main-process log beside the typed cause (§8.7).

**The mixed-version case is deliberately not one of them.** During a hot
reload the renderer `safeParse`-rejected a valid reply because main and
renderer were different builds. It is not given a `problem` of its own: a
packaged build ships both halves in one asar and cannot disagree, the renderer
cannot tell "main sent an older shape" from "main sent nonsense" — both are
one failed parse — and a message for a state that cannot occur in a shipped
build is a message for a state that cannot happen. A parse failure keeps the
generic sentence.

Other failures:

- Helper exits: its accounts go `offline`, restart backs off from 1s to a 30s cap.
- Request timeout: 10s, rejected as `EventKitError('timeout')`. `authorize` is the
  exception and takes its own 5-minute bound: the helper blocks inside
  `requestFullAccessToEvents()` until the user answers the macOS prompt, so a flat
  10s reports failure after macOS has already granted access. Not unbounded, because
  a prompt nobody answers would hold a pending entry and a spinning pane forever.
- Malformed JSON: dropped and logged; a run of them is treated as a crash.
- No sources at all: connect succeeds with zero accounts and the settings view
  says the Mac has no calendar accounts, pointing at `Calendar.app`. Not an error.

`EventKitError` sits alongside `AuthFlowError` in `infra/errors.ts`, with kinds
`denied`, `restricted`, `writeOnly`, `promptUnavailable`, `helper_unavailable`,
`timeout` and `protocol`. Translated at the boundary, never swallowed — and in
particular not with `try?`, which turned a request that could not be made into
a denial the user had never made.

## Build and signing

- `npm run build:helper` runs `swift build -c release` into `build/helper/`,
  which is gitignored. The binary is never committed.
- `build` and `package` depend on it, so a stale helper cannot ship.
- `electron-builder.yml` gains `extraResources` for the binary and lists it under
  `mac.binaries`, so it is signed with the hardened runtime and the inherited
  entitlements. Notarisation needs no further change.
- GitHub's macOS runners ship Swift, so CI gains only the build step.
- Under `npm run dev` the helper runs beneath unsigned Electron, so the TCC prompt
  names Electron and the grant is separate from the installed app's. A README line
  stops that being reported as a bug.

## Testing

TypeScript, in Vitest, consistent with the existing suite:

- `EventKitProtocol` against valid and hostile payloads.
- `eventKitEventMapper` against captured helper JSON: all-day, a recurring
  instance, a timed event, one with no URL anywhere, one with a Meet link in the
  notes.
- `EventKitHelperProcess` against a fake child process: reply correlation, timeout,
  restart backoff, push delivery, and a malformed line mid-stream.
- `ProviderFactory` returning the right provider per `ProviderKind`.

Swift, in `swift test`, only where the helper is not thin: date-range predicate
construction, and all-day boundary conversion across a DST change. Plus the wire
bounds — every scalar cap and every list cap has a Swift constant pinned against
its Zod counterpart, because those two numbers drifting apart is a silent
wire-format regression that nothing else would catch.

`swift test --package-path resources/eventkit-helper` runs in CI and in
`npm run check`. In `check` it goes through `scripts/swift-test.sh`, which skips
with a sentence off macOS or without a working toolchain; CI calls the command
directly, where a missing toolchain must fail rather than skip.

`MockCalendarProvider` keeps the UI developable without any of this, so no widget
work is blocked on the helper existing.
