# First-Run Guidance and Settings Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the app usable before the user has anything in it — a connect button where they are looking, a TODO hint that names the shortcut, and a Preferences tab whose controls line up.

**Architecture:** One new push channel carries a tab name from main to the Settings window, which lets the widget send the user to a specific tab. The widget's existing `EmptyState` grows an optional action button, and a pure function decides which prompt to show from the accounts already in the snapshot. `PreferencesView`'s two row components collapse into one, which is where the misalignment lives.

**Tech Stack:** Electron 44, React 19, Zod 4 strict schemas as the IPC contract, Tailwind 4 configured in CSS via `@theme inline`, Vitest.

**Source spec:** `docs/superpowers/specs/2026-10-17-first-run-guidance-design.md`

## Global Constraints

- No new capability. The widget still cannot start an OAuth flow; `connectAccount` stays on the Settings bridge.
- The only new IPC surface is one main-to-renderer push channel carrying a tab name. Adding a channel means adding it to `CHANNELS`, to `CHANNEL_CALLERS`, and — for a push channel — to `PUSH_CHANNELS`. The comment at the top of `channels.ts` says so, and `CHANNEL_CALLERS` is a `Record<ChannelName, …>` so the compiler will catch a missing entry.
- Native macOS controls stay in Settings. No cards, no custom switches, no section headings. That is explicitly out of scope in the spec.
- Text colours, the `w-40` label column, `text-sm` labels and `text-xs` hints all stay.
- House rules: guard clauses first, always braces, no `any`, no `as unknown as X`, no `@ts-ignore`, no non-null `!`, no inline `await` as a call argument, `private readonly` fields.
- Comments only state a constraint the code cannot show. Never narrate the next line.
- 272 tests pass at the start. That number must not drop.
- Use `/opt/homebrew/bin/git`. Apple's git fails with "You have not agreed to the Xcode license agreements".
- `export PATH=/opt/homebrew/opt/node@24/bin:/opt/homebrew/bin:$PATH` in every shell.

## File Structure

| File                                                   | Responsibility                                                                   |
| ------------------------------------------------------ | -------------------------------------------------------------------------------- |
| `src/shared/types/settings.ts`                         | Gains `SettingsTab` and `SETTINGS_TABS`, so both renderers share one definition. |
| `src/shared/ipc/channels.ts`                           | Registers `settingsShowTab` as a push channel readable by the settings window.   |
| `src/shared/ipc/contract.ts`                           | `settingsOpen` stops being `noPayload` and takes an optional tab.                |
| `src/shared/ipc/bridge.ts`                             | `WidgetBridge.openSettings` takes a tab; `SettingsBridge` gains `onShowTab`.     |
| `src/preload/index.ts`                                 | Passes the tab through; subscribes the settings window to the push channel.      |
| `src/main/windows/SettingsWindow.ts`                   | Opens on a tab, and tells an already-open window to switch.                      |
| `src/main/ipc/handlers/windowHandlers.ts`              | Forwards the tab.                                                                |
| `src/renderer/settings/SettingsApp.tsx`                | Takes its tab from the push channel.                                             |
| `src/renderer/common/components/agenda/EmptyState.tsx` | Gains an optional action button.                                                 |
| `src/renderer/widget/emptyPrompt.ts` (new)             | Pure: decides which prompt the accounts call for.                                |
| `src/renderer/widget/WidgetApp.tsx`                    | Renders the prompt.                                                              |
| `src/renderer/common/components/todos/TodoPanel.tsx`   | Empty list names the shortcut and links to Preferences.                          |
| `src/renderer/settings/views/PreferencesView.tsx`      | One row component instead of two.                                                |

---

### Task 1: Share the tab type and widen the channel

The contract first, because every other task depends on the names in it. Nothing user-visible changes in this task: the widget still calls `openSettings()` with no argument and Settings still opens on Accounts.

**Files:**

- Modify: `src/shared/types/settings.ts`
- Modify: `src/shared/ipc/channels.ts`
- Modify: `src/shared/ipc/contract.ts`
- Modify: `src/shared/ipc/bridge.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/main/windows/SettingsWindow.ts`
- Modify: `src/main/ipc/handlers/windowHandlers.ts`
- Modify: `src/renderer/settings/SettingsApp.tsx`
- Test: `tests/unit/settingsTabContract.test.ts` (new)

**Interfaces:**

- Produces: `SETTINGS_TABS`, `type SettingsTab` from `src/shared/types/settings.ts`; `openSettingsSchema` from `contract.ts`; `CHANNELS.settingsShowTab`; `WidgetBridge.openSettings(tab?: SettingsTab)`; `SettingsBridge.onShowTab(listener: (tab: SettingsTab) => void): () => void`; `SettingsWindow.open(tab?: SettingsTab)`.
- Consumes: the existing `CHANNELS`, `CHANNEL_CALLERS`, `PUSH_CHANNELS` and `REQUEST_SCHEMAS` structures.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/settingsTabContract.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import { openSettingsSchema } from '../../src/shared/ipc/contract.ts'
import { CHANNELS, CHANNEL_CALLERS, PUSH_CHANNELS } from '../../src/shared/ipc/channels.ts'
import { SETTINGS_TABS } from '../../src/shared/types/settings.ts'

/**
 * The tab arrives from a renderer, so it is untrusted input like every other
 * payload: these are the cases that would otherwise let an unknown string
 * reach the window that acts on it.
 */
describe('openSettingsSchema', () => {
  it('accepts every tab the settings window actually has', () => {
    for (const tab of SETTINGS_TABS) {
      expect(openSettingsSchema.safeParse({ tab }).success).toBe(true)
    }
  })

  it('accepts no tab at all, so existing callers keep working', () => {
    expect(openSettingsSchema.safeParse({}).success).toBe(true)
  })

  it('rejects a tab the settings window does not have', () => {
    expect(openSettingsSchema.safeParse({ tab: 'tokens' }).success).toBe(false)
  })

  it('rejects anything alongside the tab', () => {
    expect(openSettingsSchema.safeParse({ tab: 'accounts', extra: 1 }).success).toBe(false)
  })
})

describe('the settings:showTab channel', () => {
  it('is a push channel, so it has no inbound payload to validate', () => {
    expect(PUSH_CHANNELS).toContain(CHANNELS.settingsShowTab)
  })

  it('is readable only by the settings window', () => {
    expect(CHANNEL_CALLERS[CHANNELS.settingsShowTab]).toEqual(['settings'])
  })
})
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `npm test -- settingsTabContract`
Expected: FAIL, `No "openSettingsSchema" export is defined on the "../../src/shared/ipc/contract.ts" mock` or a resolve error for `SETTINGS_TABS`.

- [ ] **Step 3: Declare the tab type**

In `src/shared/types/settings.ts`, add near the other exported unions:

```typescript
/**
 * The settings window's tabs. Declared here rather than beside the component
 * because the widget names one when it asks for the window to be opened, and
 * both ends have to agree on the spelling.
 */
export const SETTINGS_TABS = ['accounts', 'calendars', 'display', 'preferences'] as const

export type SettingsTab = (typeof SETTINGS_TABS)[number]
```

- [ ] **Step 4: Register the push channel**

In `src/shared/ipc/channels.ts`, add to `CHANNELS` directly after `settingsOpen`:

```typescript
  settingsShowTab: 'settings:showTab',
```

add to `CHANNEL_CALLERS` directly after the `settingsOpen` entry:

```typescript
  [CHANNELS.settingsShowTab]: ['settings'],
```

and add to `PUSH_CHANNELS`:

```typescript
  CHANNELS.settingsShowTab,
```

- [ ] **Step 5: Give the channel a schema**

In `src/shared/ipc/contract.ts`, add beside the other request schemas:

```typescript
export const openSettingsSchema = z.strictObject({
  tab: z.enum(SETTINGS_TABS).optional(),
})
```

Import `SETTINGS_TABS` from `../types/settings.ts` alongside the existing imports from that file, replace the `noPayload` entry so `REQUEST_SCHEMAS` reads:

```typescript
  [CHANNELS.settingsOpen]: openSettingsSchema,
```

and add the inferred type beside the others at the bottom of the file:

```typescript
export type OpenSettingsRequest = z.infer<typeof openSettingsSchema>
```

- [ ] **Step 6: Widen the bridges**

In `src/shared/ipc/bridge.ts`, import the tab type:

```typescript
import type { AppSettings, DisplayOption, SettingsTab } from '../types/settings.ts'
```

change the widget's method:

```typescript
  openSettings(tab?: SettingsTab): Promise<void>
```

and add to `SettingsBridge`:

```typescript
  /** Returns an unsubscribe function. */
  onShowTab(listener: (tab: SettingsTab) => void): () => void
```

- [ ] **Step 7: Pass it through the preload**

In `src/preload/index.ts`, import `SettingsTab` from `../shared/types/settings.ts` alongside the existing `AppSettings` and `DisplayOption` import.

In the widget bridge, replace `openSettings`:

```typescript
    async openSettings(tab?: SettingsTab): Promise<void> {
      await ipcRenderer.invoke(CHANNELS.settingsOpen, { tab })
    },
```

In the settings bridge, add a listener following the same shape as `onAlert` in `createAlertBridge`:

```typescript
    onShowTab(listener: (tab: SettingsTab) => void): () => void {
      const subscription = (_event: IpcRendererEvent, tab: SettingsTab): void => {
        listener(tab)
      }
      ipcRenderer.on(CHANNELS.settingsShowTab, subscription)
      return () => {
        ipcRenderer.removeListener(CHANNELS.settingsShowTab, subscription)
      }
    },
```

- [ ] **Step 8: Open the window on a tab**

In `src/main/windows/SettingsWindow.ts`, import the channel and the type:

```typescript
import { CHANNELS } from '../../shared/ipc/channels.ts'
import type { SettingsTab } from '../../shared/types/settings.ts'
```

Change `open` so it takes the tab and sends it once the renderer can receive it. The already-open branch can send straight away; a fresh window has to wait for the load, which is why the send sits after `loadURL` rather than in `ready-to-show`:

```typescript
  async open(tab?: SettingsTab): Promise<void> {
    if (this.window && !this.window.isDestroyed()) {
      this.window.show()
      this.window.focus()
      this.showTab(this.window, tab)
      return
    }
```

and at the end of the method, after the existing `await window.loadURL(…)` line:

```typescript
    this.showTab(window, tab)
  }

  /**
   * The tab is a request, not state: the window keeps whatever the user picks
   * afterwards, so there is nothing to remember here.
   */
  private showTab(window: BrowserWindow, tab: SettingsTab | undefined): void {
    if (!tab) {
      return
    }
    window.webContents.send(CHANNELS.settingsShowTab, tab)
  }
```

- [ ] **Step 9: Forward it from the handler**

In `src/main/ipc/handlers/windowHandlers.ts`, replace the `settingsOpen` handler:

```typescript
router.handle(CHANNELS.settingsOpen, async ({ tab }) => {
  await deps.settingsWindow.open(tab)
})
```

- [ ] **Step 10: Take the tab in the settings renderer**

In `src/renderer/settings/SettingsApp.tsx`, delete the local `type Tab` declaration and use the shared one. Replace the imports and the `TABS` constant:

```typescript
import { useEffect, useState, type JSX } from 'react'
import { SETTINGS_TABS, type SettingsTab } from '../../shared/types/settings.ts'
import { settingsApi } from '../common/lib/ipcClient.ts'
```

```typescript
const TAB_LABELS: Readonly<Record<SettingsTab, string>> = {
  accounts: 'Accounts',
  calendars: 'Calendars',
  display: 'Display',
  preferences: 'Preferences',
}
```

Change the state and subscribe to the channel, directly below the existing `useState`:

```typescript
const [tab, setTab] = useState<SettingsTab>('accounts')
```

```typescript
useEffect(() => {
  return settingsApi().onShowTab(setTab)
}, [])
```

Replace the `TABS.map(…)` loop header so it walks the shared list, and read the label from the record:

```typescript
        {SETTINGS_TABS.map((entry) => (
          <button
            key={entry}
            type="button"
            onClick={() => {
              setTab(entry)
            }}
            className={`rounded px-3 py-1 text-sm ${
              tab === entry ? 'bg-bg-subtle text-text' : 'text-text-muted hover:bg-bg-subtle'
            }`}
          >
            {TAB_LABELS[entry]}
          </button>
        ))}
```

Leave the four `{tab === '…' && <View />}` lines alone.

- [ ] **Step 11: Run the test and watch it pass**

Run: `npm test -- settingsTabContract`
Expected: PASS, 6 tests.

- [ ] **Step 12: Verify the whole suite**

Run: `npm run check`
Expected: typecheck, lint, format and all tests pass. Total is 278.

- [ ] **Step 13: Commit**

```bash
git add src/shared src/preload src/main/windows/SettingsWindow.ts src/main/ipc/handlers/windowHandlers.ts src/renderer/settings/SettingsApp.tsx tests/unit/settingsTabContract.test.ts
git commit -m "feat(ipc): let the widget open settings on a named tab

The tab list moves into shared types so the window that asks and the window
that answers cannot disagree about the spelling, and the channel validates it
as an enum rather than trusting a string from a renderer.

A push channel rather than a query string: the window is often already open,
and reloading it to change tab would throw away whatever the user was doing."
```

---

### Task 2: A way out of the widget's empty state

**Files:**

- Modify: `src/renderer/common/components/agenda/EmptyState.tsx`
- Create: `src/renderer/widget/emptyPrompt.ts`
- Modify: `src/renderer/widget/WidgetApp.tsx`
- Test: `tests/unit/emptyPrompt.test.ts` (new)

**Interfaces:**

- Consumes: `SettingsTab` from Task 1, `widgetApi().openSettings(tab)` from Task 1.
- Produces: `emptyPromptFor(accounts: readonly AgendaAccount[]): EmptyPrompt | null` and `interface EmptyPrompt { message: string; actionLabel: string; tab: SettingsTab }`.

The decision is a pure function in its own file because it is the only part of this task a test can reach, and because it is the part that is easy to get wrong: the reconnect case is about _every_ account, not any.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/emptyPrompt.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import { emptyPromptFor } from '../../src/renderer/widget/emptyPrompt.ts'
import type { AgendaAccount } from '../../src/shared/types/agenda.ts'
import type { AccountStatus } from '../../src/shared/types/account.ts'

function account(id: string, status: AccountStatus): AgendaAccount {
  return { id, label: id, colour: 'blue', status, lastSyncedAt: null }
}

describe('emptyPromptFor', () => {
  it('asks for a connection when there is nothing connected', () => {
    const prompt = emptyPromptFor([])

    expect(prompt?.tab).toBe('accounts')
    expect(prompt?.actionLabel).toBe('Connect a calendar')
  })

  it('asks for a reconnect when every account is dead', () => {
    const prompt = emptyPromptFor([account('a', 'needsReauth'), account('b', 'needsReauth')])

    expect(prompt?.tab).toBe('accounts')
    expect(prompt?.actionLabel).toBe('Reconnect')
  })

  // One live account still has a day to draw, and the per-account status dot
  // already says the other one is broken.
  it('says nothing when at least one account still works', () => {
    expect(emptyPromptFor([account('a', 'needsReauth'), account('b', 'ready')])).toBeNull()
  })

  it('says nothing when everything is healthy', () => {
    expect(emptyPromptFor([account('a', 'ready')])).toBeNull()
  })

  it('treats a merely offline account as working, because it will come back', () => {
    expect(emptyPromptFor([account('a', 'offline')])).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `npm test -- emptyPrompt`
Expected: FAIL, `Failed to resolve import "../../src/renderer/widget/emptyPrompt.ts"`.

- [ ] **Step 3: Write the implementation**

Create `src/renderer/widget/emptyPrompt.ts`:

```typescript
import type { AgendaAccount } from '../../shared/types/agenda.ts'
import type { SettingsTab } from '../../shared/types/settings.ts'

export interface EmptyPrompt {
  readonly message: string
  readonly actionLabel: string
  readonly tab: SettingsTab
}

/**
 * What the widget should say when it has no day to draw, or null when the
 * reason is simply that there is nothing on today.
 *
 * `needsReauth` only counts when every account has it. One dead account out of
 * two still leaves a day worth drawing, and the status dot beside that account
 * already says what is wrong with it.
 */
export function emptyPromptFor(accounts: readonly AgendaAccount[]): EmptyPrompt | null {
  if (accounts.length === 0) {
    return {
      message: 'No calendars connected yet.',
      actionLabel: 'Connect a calendar',
      tab: 'accounts',
    }
  }

  if (accounts.every((account) => account.status === 'needsReauth')) {
    return {
      message: 'Reconnect to see your calendar.',
      actionLabel: 'Reconnect',
      tab: 'accounts',
    }
  }

  return null
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `npm test -- emptyPrompt`
Expected: PASS, 5 tests.

- [ ] **Step 5: Give `EmptyState` an action**

Replace `src/renderer/common/components/agenda/EmptyState.tsx` in full:

```tsx
import type { JSX } from 'react'

interface EmptyStateProps {
  readonly message: string
  /** Both or neither: a button with no handler is a lie. */
  readonly actionLabel?: string
  readonly onAction?: () => void
}

/** Centred muted line, generous whitespace (docs/spec.md §6). */
export function EmptyState({ message, actionLabel, onAction }: EmptyStateProps): JSX.Element {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-10 text-center text-text-muted">
      <span>{message}</span>
      {actionLabel && onAction && (
        <button
          type="button"
          onClick={onAction}
          className="no-drag rounded-full border border-border px-3 py-1 text-body text-accent hover:bg-accent/10"
        >
          {actionLabel}
        </button>
      )}
    </div>
  )
}
```

- [ ] **Step 6: Render it in the widget**

In `src/renderer/widget/WidgetApp.tsx`, add the import beside the others:

```typescript
import { emptyPromptFor } from './emptyPrompt.ts'
```

Replace the `hasAccounts` line with the prompt, since the prompt now subsumes it:

```typescript
const prompt = emptyPromptFor(snapshot.accounts)
const hasAccounts = snapshot.accounts.length > 0
```

and replace the `!hasAccounts` branch inside the timeline card:

```tsx
{
  prompt ? (
    <EmptyState
      message={prompt.message}
      actionLabel={prompt.actionLabel}
      onAction={() => void widgetApi().openSettings(prompt.tab)}
    />
  ) : useSplit ? (
    <SplitView snapshot={snapshot} onJoin={join} />
  ) : (
    <MergedView snapshot={snapshot} onJoin={join} />
  )
}
```

`hasAccounts` stays because `useSplit` still reads it: splitting by account is meaningless with none.

- [ ] **Step 7: Verify**

Run: `npm run check`
Expected: all green, 283 tests.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/common/components/agenda/EmptyState.tsx src/renderer/widget/emptyPrompt.ts src/renderer/widget/WidgetApp.tsx tests/unit/emptyPrompt.test.ts
git commit -m "feat(widget): offer the fix next to the problem

The empty state told the user to open Settings and then gave them no way to
do it. It now sends them to the tab that fixes the specific thing that is
wrong, which is either nothing connected or every account needing reauth.

The choice is a pure function because the interesting case is the one that
should say nothing: one dead account out of two still has a day to draw."
```

---

### Task 3: Tell the user how to add a TODO

**Files:**

- Modify: `src/renderer/common/components/todos/TodoPanel.tsx`

**Interfaces:**

- Consumes: `widgetApi().openSettings('preferences')` from Task 1, the existing `shortcut` prop.
- Produces: nothing.

No unit test. This is a copy change inside an existing branch; the only thing worth checking is whether a user reads it, and that is verified by looking at it.

- [ ] **Step 1: Find the empty branch**

Run: `grep -n "isEmpty" src/renderer/common/components/todos/TodoPanel.tsx`

The empty message is the `<p>` rendered when `isEmpty` is true. It currently states only that there is nothing in the list.

- [ ] **Step 2: Replace it**

Add the import at the top of the file:

```typescript
import { widgetApi } from '../../lib/ipcClient.ts'
```

Replace the empty-branch paragraph with:

```tsx
<div className="flex flex-col gap-1 px-3 py-1 text-body text-text-muted">
  <span>Nothing on the list. Press {formatAccelerator(shortcut)} anywhere to add something.</span>
  <button
    type="button"
    onClick={() => void widgetApi().openSettings('preferences')}
    className="no-drag self-start text-accent hover:underline"
  >
    Change the shortcut
  </button>
</div>
```

`formatAccelerator` is already imported in this file and already used for the header hint, so the two always agree.

- [ ] **Step 3: Verify**

Run: `npm run check`
Expected: all green, 283 tests.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/common/components/todos/TodoPanel.tsx
git commit -m "feat(todos): say how to add one when there are none

The shortcut is the only way in and an empty panel never mentioned it. The
binding comes from the same formatAccelerator call as the header hint, so the
two cannot drift."
```

---

### Task 4: One grid for the Preferences rows

**Files:**

- Modify: `src/renderer/settings/views/PreferencesView.tsx`

**Interfaces:**

- Consumes: nothing new.
- Produces: nothing other tasks depend on.

`Row` and `Toggle` are the same component with one difference, and the difference is a bug. `Toggle` puts its checkbox and its hint in a shared `flex flex-col`, so the hint — which can be a full sentence — decides that column's width, and the checkbox is laid out inside it. A row with a long hint therefore puts its checkbox in a different place from a row with none. `Row` has the same structure but its controls are selects and inputs with their own widths, so it hides the problem instead of showing it.

- [ ] **Step 1: Replace both components with one**

At the bottom of `src/renderer/settings/views/PreferencesView.tsx`, delete the `RowProps`/`Row` and `ToggleProps`/`Toggle` declarations and put this in their place:

```tsx
interface RowProps {
  readonly label: string
  readonly hint?: string
  readonly children: JSX.Element
}

/**
 * Label, control, hint — in that order, with the control in a cell of its own.
 *
 * The hint sits under the control rather than beside it, and critically is not
 * a sibling of it in a column: a hint is a sentence, so it would set that
 * column's width and the control would be positioned inside whatever the
 * wording happened to come to. That is why the checkboxes used to land in a
 * different place on every row.
 */
function Row({ label, hint, children }: RowProps): JSX.Element {
  return (
    <label className="grid grid-cols-[10rem_minmax(0,1fr)] items-start gap-x-3 gap-y-1">
      <span className="pt-1 text-sm">{label}</span>
      <span className="flex min-h-7 items-center">{children}</span>
      {hint && <span className="col-start-2 text-xs text-text-muted">{hint}</span>}
    </label>
  )
}
```

- [ ] **Step 2: Move the toggles onto it**

Every `<Toggle label=… hint=… checked=… onChange=… />` becomes a `Row` wrapping a checkbox. There are eight of them: "Show the timeline", "Show the TODO list", "Privacy mode", "Hide titles in the menu bar", "Float on top", "Hide from screen sharing", "Launch at login", and they all take the same shape. Rather than repeat the input eight times, add one small component beside `Row`:

```tsx
interface CheckboxProps {
  readonly checked: boolean
  readonly onChange: (checked: boolean) => void
}

function Checkbox({ checked, onChange }: CheckboxProps): JSX.Element {
  return (
    <input
      type="checkbox"
      checked={checked}
      onChange={(event) => {
        onChange(event.target.checked)
      }}
    />
  )
}
```

and rewrite each toggle in the body. For example "Show the timeline" becomes:

```tsx
<Row
  label="Show the timeline"
  hint="Off makes the widget small enough for a laptop screen with no second monitor. What's next stays either way. Also on the widget's title bar."
>
  <Checkbox
    checked={settings.showTimeline}
    onChange={(checked) => void state.update({ showTimeline: checked })}
  />
</Row>
```

and "Show the TODO list", which has no hint, becomes:

```tsx
<Row label="Show the TODO list">
  <Checkbox
    checked={settings.showTodos}
    onChange={(checked) => void state.update({ showTodos: checked })}
  />
</Row>
```

Apply the same transformation to the remaining five. Do not change any label text, any hint text, or any `state.update` call.

- [ ] **Step 3: Confirm nothing is left behind**

Run: `grep -n "Toggle" src/renderer/settings/views/PreferencesView.tsx`
Expected: no matches, exit code 1.

- [ ] **Step 4: Verify**

Run: `npm run check`
Expected: all green, 283 tests.

- [ ] **Step 5: Look at it**

Run: `npm run dev`

Open Settings and go to Preferences. Confirm:

1. Every control starts at the same horizontal position, checkboxes included.
2. Every hint starts at that same position, under its control.
3. The sixteen rows still read in the same order with the same wording.
4. The window still scrolls, and nothing is clipped at the bottom.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/settings/views/PreferencesView.tsx
git commit -m "fix(settings): line the preference controls up

Row and Toggle were the same component with one difference, and the
difference was the bug: Toggle put the checkbox and the hint in a shared
column, so a sentence-long hint decided where the checkbox went. Rows without
hints sat left, rows with long ones sat right.

One grid, with the control in a cell of its own and the hint spanning the
column beneath it."
```

---

### Task 5: Update the spec

**Files:**

- Modify: `docs/spec.md`

**Interfaces:** none.

`docs/spec.md` is the governing document. §8.5 lists the IPC surface and now understates it by one channel; §6 describes the widget's empty state as a line of text.

- [ ] **Step 1: Record the channel**

In `docs/spec.md` §8.5, add `settings:showTab` to the channel list as a push channel readable only by the settings window, in the same voice as the surrounding entries. State the thing a future reader would otherwise rediscover: that `settings:open` carries an optional tab and that the tab is validated as an enum, so an unknown value cannot reach the window.

- [ ] **Step 2: Record the empty states**

In `docs/spec.md` §6, describe what the widget shows when it has no day to draw: a connect prompt with nothing connected, a reconnect prompt when every account needs reauth, and nothing when at least one account still works. Include why the last one is deliberate.

Also record that an empty TODO list names the quick-add shortcut and links to Preferences.

- [ ] **Step 3: Verify**

Run: `npm run format:check`
Expected: pass.

- [ ] **Step 4: Commit**

```bash
git add docs/spec.md
git commit -m "docs(spec): record the tab channel and the widget's empty states"
```

---

## Self-review

**Spec coverage.** Settings alignment → Task 4. `openSettings` taking a tab → Task 1. Widget connect and reconnect prompts → Task 2. Empty TODO hint → Task 3. The spec's testing section asks for the channel schema (Task 1 Step 1), the prompt decision across four account shapes (Task 2 Step 1, which covers five) and `EmptyState` with and without an action — that last one is the gap: `EmptyState` has no test. It is a presentational component whose only logic is `actionLabel && onAction`, and the repo has no component-test harness, so adding one would mean introducing React Testing Library for a single boolean. The both-or-neither rule is instead stated in the props comment and exercised by the two real call sites. Task 5 covers the governing document, which the spec did not mention and should have.

**Placeholder scan.** No TBDs. Every code step shows the code. Task 4 Step 2 names all eight toggles and shows two of them rather than all eight, which is a deliberate repetition cut — the transformation is mechanical and identical, and the step names every row it applies to.

**Type consistency.** `SettingsTab` and `SETTINGS_TABS` are declared in Task 1 Step 3 and used under those names in Tasks 1, 2 and 3. `emptyPromptFor` and `EmptyPrompt` are declared in Task 2 Step 3 and used under those names in Step 6. `openSettings(tab?: SettingsTab)` is declared in Task 1 Step 6 and called with one argument in Tasks 2 and 3. `SettingsWindow.open(tab?)` is declared in Task 1 Step 8 and called in Step 9.

**Risks carried into steps.** The push channel needs three separate registrations in `channels.ts` and missing one is silent for `PUSH_CHANNELS`; Task 1 Step 4 names all three and Step 1's test pins two of them. The send-after-load ordering is the other trap — a `webContents.send` before the renderer has subscribed is dropped — and Task 1 Step 8 explains why the call sits after `loadURL` rather than in `ready-to-show`.
