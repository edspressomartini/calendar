# First-Run Guidance and Settings Alignment

## Problem

Three rough edges, all of which the user hits before they have anything useful on screen.

1. **The Preferences tab is visibly misaligned.** Checkboxes land in a different horizontal
   position on nearly every row. The cause is in `PreferencesView.tsx`: `Toggle` puts its
   checkbox inside a `flex flex-col` whose width is decided by the hint text underneath it, so a
   row with a long hint pushes its checkbox far to the right and a row with no hint leaves it on
   the left. `Row` and `Toggle` were written separately and have drifted apart; the bug lives in
   the gap between them.

2. **A new user cannot connect a calendar from the screen they are looking at.** The widget's
   empty state says "No calendars connected yet. Open Settings to add one." and then offers no
   way to do it. The instruction is correct and useless.

3. **An empty TODO list says nothing about how to add one.** The quick-add shortcut is global
   and is the only way in, but a user with no TODOs is shown an empty panel and left to find the
   shortcut themselves.

## Scope

Restyle and guidance only. No new capability, no change to what the app can do, no change to
the OAuth flow.

## Design

### 1. One grid for the Preferences rows

`Row` and `Toggle` collapse into a single component. Every preference is a label, a control and
an optional hint, and there is one definition of how those three are laid out rather than two
that disagree.

The control sits in its own cell at a fixed offset from the label. The hint goes underneath the
control, free to be as wide as it needs, because it no longer decides where the control sits.
That is the whole bug: the hint was a sibling of the control in a column, so it set the column's
width and the control was positioned inside it.

Native macOS controls stay. The `w-40` label column, `text-sm` labels and `text-xs` hints stay.
Nothing about the visual language changes except that the controls line up.

### 2. `openSettings` takes a tab

The widget can already open Settings, but only onto whichever tab Settings opens on by default.
Both of the new prompts need to land somewhere specific, so the channel takes an optional tab.

- `SettingsTab` — the union `'accounts' | 'calendars' | 'display' | 'preferences'` — moves out
  of `SettingsApp.tsx` into `src/shared/types/settings.ts`, so the renderer that asks and the
  renderer that answers share one definition.
- `WidgetBridge.openSettings(tab?: SettingsTab)`.
- The channel's Zod schema gains an optional enum of exactly those four values. An unknown tab
  is rejected by the schema gate the router already applies to every channel, so this adds no
  new validation path.
- Main passes the tab to the Settings window, which uses it as `SettingsApp`'s initial tab.
- Existing callers that pass nothing keep landing on Accounts.

This is the one piece of new IPC surface in the whole spec. It carries an enum and nothing else.
Notably it is _not_ an account method: the widget still cannot start an OAuth flow, and
`connectAccount` stays on the Settings bridge where it is today. The widget's button opens the
window; the user clicks Connect there. That costs one extra click and keeps the attack surface
exactly where it is.

### 3. The widget's empty states get a way out

`EmptyState` gains an optional action: a label and a callback, rendered as a button under the
message. Callers that pass only a message are unchanged, so the other empty states in the app
are untouched.

Two cases, with different wording because they need different things done:

| Condition                        | Message                         | Action             | Opens      |
| -------------------------------- | ------------------------------- | ------------------ | ---------- |
| No account connected             | No calendars connected yet.     | Connect a calendar | `accounts` |
| Every account needs reconnecting | Reconnect to see your calendar. | Reconnect          | `accounts` |

The second case was originally specified as "an account is connected but no calendars are
ticked". That state does not exist. An empty calendar selection means the primary calendar only
— `GoogleCalendarProvider.ts:100` falls back to `['primary']` — so unticking everything in the
picker still syncs. The branch would never have rendered.

An account in `needsReauth` is the real equivalent and a worse problem than the one originally
specified: the refresh token is dead, nothing will sync until the user acts, and today the widget
shows a status dot and offers no way to act on it. The snapshot already carries
`accounts[].status`, so this case needs no new data at all.

The condition is _every_ account, not _any_. With two accounts where one is healthy the widget
still has a day to draw, and replacing it with a reconnect prompt would be a regression; the
per-account status dot already covers that.

### 4. The empty TODO list says how to add one

`TodoPanel` already renders an empty message and is already passed the current shortcut. The
empty branch gains the shortcut and a button that opens Settings on Preferences, so the user can
both use it and change it from the one place they are looking.

Inline text rather than a hover tooltip, deliberately: a tooltip on an empty panel is only found
by someone who already suspected something was there.

## Testing

- The channel schema: a valid tab is accepted, an unknown string is rejected, and omitting it is
  still valid.
- Which prompt the widget shows, as a pure function of the snapshot's accounts: none connected,
  all `needsReauth`, one `needsReauth` and one `ready` (no prompt), all `ready` (no prompt).
- `EmptyState` with and without an action.

The layout work has no meaningful unit test. Asserting on class names would pin the
implementation without checking the only thing that matters, which is whether the controls line
up, so it is verified by looking at it.

## Out of scope

- Restyling Settings to match the widget's cards, type scale and pill buttons.
- Grouping the sixteen preferences under section headings.
- Replacing checkboxes with custom switches.
- Starting an OAuth flow from the widget.
