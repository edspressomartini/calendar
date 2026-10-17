# Widget Visual Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the widget look like something you would choose to keep on your desktop — frosted glass over the wallpaper, soft cards instead of dividing rules, a real type scale, and feedback that only responds to you.

**Architecture:** The window becomes transparent so the renderer's own alpha reaches the window server. (Originally this used a macOS vibrancy material; see the superseded constraint below for why it was dropped.) `theme.css` keeps its existing structure — one accent per scheme, every other token mixed from it — but its neutral base goes transparent and each scheme becomes a translucent wash over the material. On top of that glass, the TODO panel and timeline become bordered cards, which lets most of the `border-t` / `border-b` dividers go.

**Tech Stack:** Electron 44 (`BrowserWindow` `vibrancy` and `transparent`), React 19, Tailwind 4 configured in CSS via `@theme inline`, Vitest.

**Source spec:** `docs/superpowers/specs/2026-10-17-widget-visual-redesign-design.md`

## Global Constraints

- Restyle only. Same layout, same information, same density. Do not move what sits where.
- ~~Vibrancy material is `under-window`.~~ **Superseded during Task 2 verification.** `under-window` composites the desktop wallpaper only, so the panel read as opaque wherever it covered another app's window, which is the common case. The window is now plainly transparent with no vibrancy material: no OS blur, but the alpha reveals whatever is actually behind. Do not reintroduce `vibrancy`, and do not reach for a CSS `backdrop-filter` instead — web content cannot blur the OS backdrop.
- Card radius is 10px.
- Motion is reactive only: hover, press, expand/collapse, new items entering. Nothing animates unprompted. No pulsing live dot.
- Every transition must be wrapped in `prefers-reduced-motion`.
- Text colours do not change. A tint that costs legibility is a worse panel.
- `type: 'panel'`, the non-activating behaviour, all-Spaces placement and `setContentProtection` are untouched.
- Urgent (red) and live (green) are never recoloured by a scheme. They carry meaning.
- House rules from the repo apply: guard clauses first, always braces, no `any`, no inline `await` as a call argument, `private readonly` fields.
- The existing test suite must keep passing. Nothing in it asserts on styling, so a failure means something behavioural moved.

---

### Task 1: The window material

The riskiest step, deliberately first. If a transparent vibrant panel misbehaves when resized, or breaks `fitHeight`, or loses its rounded corners, everything after this depends on a false assumption.

**Files:**

- Create: `src/main/windows/widgetWindowOptions.ts`
- Create: `tests/unit/widgetWindowOptions.test.ts`
- Modify: `src/main/windows/WidgetWindow.ts:62-81` (the `new BrowserWindow({ … })` call)
- Modify: `src/renderer/common/styles/index.css` (the `body` rule, lines 27–40)

**Interfaces:**

- Consumes: `WIDGET_MIN_WIDTH`, `WIDGET_MIN_HEIGHT`, `WIDGET_COMPACT_MIN_HEIGHT` from `src/shared/constants.ts`; `hardenedWebPreferences` from `./windowSecurity.ts`.
- Produces: `buildWidgetWindowOptions(input: WidgetWindowOptionsInput): BrowserWindowConstructorOptions`, imported by `WidgetWindow.open()`.

Extracting the options into a pure function is the only part of this task a unit test can reach. It is worth doing: the security-relevant flags (`type`, `acceptFirstMouse`, `skipTaskbar`) end up pinned by a test, so a future edit cannot quietly drop one while adding a visual flag.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/widgetWindowOptions.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import { buildWidgetWindowOptions } from '../../src/main/windows/widgetWindowOptions.ts'

const INPUT = {
  bounds: { x: 10, y: 20, width: 400, height: 600 },
  showTimeline: true,
  alwaysOnTop: true,
  webPreferences: {},
} as const

describe('buildWidgetWindowOptions', () => {
  it('asks macOS for the under-window material on a transparent window', () => {
    const options = buildWidgetWindowOptions(INPUT)

    expect(options.vibrancy).toBe('under-window')
    expect(options.transparent).toBe(true)
    expect(options.roundedCorners).toBe(true)
    // An opaque background colour defeats the material entirely.
    expect(options.backgroundColor).toBeUndefined()
  })

  it('keeps the panel behaviour that makes this a widget rather than a window', () => {
    const options = buildWidgetWindowOptions(INPUT)

    expect(options.type).toBe('panel')
    expect(options.frame).toBe(false)
    expect(options.skipTaskbar).toBe(true)
    expect(options.acceptFirstMouse).toBe(true)
    expect(options.show).toBe(false)
    expect(options.fullscreenable).toBe(false)
  })

  it('uses the compact floor when the timeline is hidden', () => {
    const tall = buildWidgetWindowOptions(INPUT)
    const compact = buildWidgetWindowOptions({ ...INPUT, showTimeline: false })

    expect(compact.minHeight).toBeLessThan(tall.minHeight ?? 0)
  })
})
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `npm test -- widgetWindowOptions`
Expected: FAIL, `Failed to resolve import "../../src/main/windows/widgetWindowOptions.ts"`.

- [ ] **Step 3: Write the implementation**

Create `src/main/windows/widgetWindowOptions.ts`:

```typescript
import type { BrowserWindowConstructorOptions, Rectangle, WebPreferences } from 'electron'
import {
  WIDGET_COMPACT_MIN_HEIGHT,
  WIDGET_MIN_HEIGHT,
  WIDGET_MIN_WIDTH,
} from '../../shared/constants.ts'

export interface WidgetWindowOptionsInput {
  readonly bounds: Rectangle
  readonly showTimeline: boolean
  readonly alwaysOnTop: boolean
  readonly webPreferences: WebPreferences
}

/**
 * The panel's constructor options, as a value so they can be asserted on.
 *
 * `transparent` with no `backgroundColor` is what lets the vibrancy material
 * show through; setting a background colour here paints over it and the blur
 * is never seen.
 */
export function buildWidgetWindowOptions(
  input: WidgetWindowOptionsInput,
): BrowserWindowConstructorOptions {
  return {
    ...input.bounds,
    minWidth: WIDGET_MIN_WIDTH,
    minHeight: input.showTimeline ? WIDGET_MIN_HEIGHT : WIDGET_COMPACT_MIN_HEIGHT,
    // NSPanel behaviour: all Spaces, above full-screen apps, non-activating.
    type: 'panel',
    frame: false,
    show: false,
    transparent: true,
    vibrancy: 'under-window',
    roundedCorners: true,
    skipTaskbar: true,
    fullscreenable: false,
    maximizable: false,
    minimizable: false,
    alwaysOnTop: input.alwaysOnTop,
    // Without this the first click on the inactive panel is swallowed.
    acceptFirstMouse: true,
    webPreferences: input.webPreferences,
  }
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `npm test -- widgetWindowOptions`
Expected: PASS, 3 tests.

- [ ] **Step 5: Use it from `WidgetWindow`**

In `src/main/windows/WidgetWindow.ts`, replace the whole `const window = new BrowserWindow({ … })` literal (currently lines 62–81) with:

```typescript
const window = new BrowserWindow(
  buildWidgetWindowOptions({
    bounds,
    showTimeline: settings.showTimeline,
    alwaysOnTop: settings.alwaysOnTop,
    webPreferences: hardenedWebPreferences({
      preloadPath: this.options.preloadPath,
      isDev: this.options.isDev,
    }),
  }),
)
```

Add the import alongside the existing ones:

```typescript
import { buildWidgetWindowOptions } from './widgetWindowOptions.ts'
```

- [ ] **Step 6: Let the glass show through**

In `src/renderer/common/styles/index.css`, change the `body` rule so the page no longer paints an opaque background. Replace `background-color: var(--bg);` with:

```css
/* The window is transparent and macOS draws the material behind it, so
       anything opaque here paints over the blur. */
background-color: transparent;
```

Add a rounded clip so the material follows the window's corners, inside the same `@layer base` block:

```css
#root {
  overflow: hidden;
  border-radius: 12px;
}
```

- [ ] **Step 7: Verify it on a real desktop**

Run: `npm run build && npm run dev`

Check each of these and write down what you saw — this is the step the whole plan is sequenced around:

1. The wallpaper is visible, blurred, through the panel.
2. Dragging the panel by its title bar still works.
3. Resizing from an edge still works, and the minimum size still holds.
4. Turning the timeline off still shrinks the window (`fitHeight`).
5. The corners are rounded, with no square opaque patch behind them.
6. The panel still appears on another Space and over a full-screen app.
7. Text is still readable. It will look washed out at this stage — the theme is still mixing against opaque white. That is expected and Task 2 fixes it.

If 2, 3 or 4 fail, stop and report rather than working around it. A transparent panel that cannot be resized is a worse widget than an opaque one that can.

- [ ] **Step 8: Commit**

```bash
git add src/main/windows/widgetWindowOptions.ts tests/unit/widgetWindowOptions.test.ts src/main/windows/WidgetWindow.ts src/renderer/common/styles/index.css
git commit -m "feat(widget): frost the panel with the macOS under-window material

The options move into a pure function so the panel flags that matter —
type, acceptFirstMouse, skipTaskbar — are pinned by a test rather than
sitting in a literal where a future visual tweak could drop one.

Transparent with no backgroundColor is the part that matters: a background
colour paints over the material and the blur is never seen."
```

---

### Task 2: Translucent theme tokens

**Files:**

- Modify: `src/renderer/common/styles/theme.css:16-25` (the `:root` neutrals), `:27-38` (the dark-mode neutrals), `:101-106` (the tint block)

**Interfaces:**

- Consumes: nothing new.
- Produces: `--bg`, `--bg-subtle`, `--border`, `--text-muted` — same names, same meanings, now translucent. Every component already reads these through Tailwind's `bg-bg`, `bg-bg-subtle`, `border-border`, `text-text-muted`, so no component changes.

This task has no unit test. It is a change to four colour values and the only meaningful verification is looking at it. Do not invent a test that asserts a hex string — it would pin the implementation without checking the thing that matters, which is whether you can read the panel.

- [ ] **Step 1: Make the neutral base translucent**

In `src/renderer/common/styles/theme.css`, replace the two background neutrals in `:root`:

```css
--neutral-bg: rgb(255 255 255 / 0.55);
--neutral-bg-subtle: rgb(248 250 252 / 0.7);
```

and in the `@media (prefers-color-scheme: dark)` block:

```css
--neutral-bg: rgb(15 23 42 / 0.5);
--neutral-bg-subtle: rgb(30 41 59 / 0.65);
```

Leave `--neutral-border`, `--text`, `--neutral-text-muted`, `--accent`, `--urgent` and `--live` exactly as they are.

- [ ] **Step 2: Update the comment that is now wrong**

The block comment above the tint section (lines 91–100) says the tint sits on a neutral base. Add to the end of it:

```css
   The base is translucent now, so these mixes land on top of whatever macOS
   has blurred behind the window rather than on a known colour. That is why
   the alpha lives in the neutral rather than in each mix: one place decides
   how much wallpaper comes through, and the schemes stay two lines each. */
```

- [ ] **Step 3: Look at it**

Run: `npm run build && npm run dev`

Check, in the default sky scheme only:

1. Light appearance over a plain wallpaper.
2. Light appearance over a bright, busy photograph. This is the worst case.
3. Dark appearance over both.

If the bright photograph is unreadable, raise the light-mode `--neutral-bg` alpha from `0.55` towards `0.75` until it holds, and record the value you settled on in the commit message. Readability wins over the effect; that trade is already stated in the spec.

- [ ] **Step 4: Confirm nothing behavioural moved**

Run: `npm run check`
Expected: typecheck, lint, format and all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/common/styles/theme.css
git commit -m "feat(theme): let the scheme tint sit on the wallpaper, not on white

The alpha goes in the neutral base rather than in each mix, so one place
decides how much wallpaper comes through and a scheme is still two lines."
```

---

### Task 3: Cards instead of dividers

**Files:**

- Modify: `src/renderer/common/styles/index.css` (add a `.card` component class)
- Modify: `src/renderer/widget/WidgetApp.tsx:104-144` (the returned tree)
- Modify: `src/renderer/common/components/chrome/TitleBar.tsx:38`
- Modify: `src/renderer/common/components/chrome/StatusStrip.tsx:48`
- Modify: `src/renderer/common/components/agenda/NextUpBar.tsx:33-36`

**Interfaces:**

- Consumes: the translucent tokens from Task 2.
- Produces: a `.card` class used by Task 5 and Task 6.

- [ ] **Step 1: Add the card class**

In `src/renderer/common/styles/index.css`, inside the existing `@layer components` block:

```css
/* A panel on the glass. The border does the separating that a row of
     divider rules used to, which is why those come out as these go in. */
.card {
  border: 1px solid var(--border);
  border-radius: 10px;
  background-color: var(--bg-subtle);
  box-shadow: 0 1px 2px rgb(0 0 0 / 0.06);
}
```

- [ ] **Step 2: Drop the dividers the card edge replaces**

In `TitleBar.tsx` line 38, remove `border-b border-border` from the `header`:

```tsx
    <header className="drag-region flex items-center gap-1.5 px-3 py-2">
```

In `StatusStrip.tsx` line 48, remove `border-t border-border` from the `footer`:

```tsx
    <footer className="flex items-center gap-2 px-3 py-1.5">
```

In `NextUpBar.tsx`, replace the wrapper's class expression (lines 33–36) so it is a card rather than a bordered strip:

```tsx
    <div
      className={`card mx-3 mb-2 flex items-center gap-2 px-3 py-1.5 ${
        live ? 'border-live/40 bg-live/10' : ''
      }`}
    >
```

- [ ] **Step 3: Wrap the two tall sections**

In `src/renderer/widget/WidgetApp.tsx`, wrap the timeline block and the TODO panel so each sits in its own card. Replace the timeline section:

```tsx
{
  snapshot.showTimeline && (
    <div className="card mx-3 mb-2 min-h-0 flex-1 overflow-hidden">
      {!hasAccounts ? (
        <EmptyState message="No calendars connected yet. Open Settings to add one." />
      ) : useSplit ? (
        <SplitView snapshot={snapshot} onJoin={join} />
      ) : (
        <MergedView snapshot={snapshot} onJoin={join} />
      )}
    </div>
  )
}
```

and wrap the TODO panel where it is built, so both placements get it:

```tsx
const todoPanel = snapshot.showTodos ? (
  <div className="card mx-3 mb-2 overflow-hidden">
    <TodoPanel
      snapshot={todos}
      placement={snapshot.todoPlacement}
      shortcut={snapshot.quickAddShortcut}
      compact={!snapshot.showTimeline}
      onToggle={toggleTodo}
      onRoll={rollTodo}
      onRollAllOverdue={rollAllOverdueTodos}
      onRemove={removeTodo}
    />
  </div>
) : null
```

Keep the existing comment above `compact` — it explains a non-obvious decision and is still true.

- [ ] **Step 4: Check the fit**

Run: `npm run build && npm run dev`

The card margins add 6px of horizontal and vertical space per section. Confirm:

1. Turning the timeline off still shrinks the window to the content, with no clipped card edge at the bottom. `useFitToContent` measures `offsetHeight` of each child, which does not include the child's own margin — if the bottom card is clipped, that is why, and the fix is padding on the container rather than margin on the cards.
2. At the 260px minimum width the title bar buttons still fit.

- [ ] **Step 5: Verify**

Run: `npm run check`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/common/styles/index.css src/renderer/widget/WidgetApp.tsx src/renderer/common/components/chrome/TitleBar.tsx src/renderer/common/components/chrome/StatusStrip.tsx src/renderer/common/components/agenda/NextUpBar.tsx
git commit -m "feat(widget): give the sections cards and take the dividers out

A card edge separates as well as a rule does, and two of them stacked is
noise. The dividers come out as the cards go in rather than afterwards, so
there is never a commit with both."
```

---

### Task 4: A type scale

**Files:**

- Modify: `src/renderer/common/styles/index.css` (the `@theme inline` block, lines 7–18)
- Modify: `src/renderer/common/components/chrome/TitleBar.tsx`, `chrome/StatusStrip.tsx`, `agenda/NextUpBar.tsx`, `agenda/DayTimeline.tsx`, `todos/TodoPanel.tsx`, `todos/TodoRow.tsx`

**Interfaces:**

- Consumes: nothing new.
- Produces: the Tailwind classes `text-micro`, `text-small`, `text-body`, `text-display`, used by Task 5.

- [ ] **Step 1: Declare the scale**

In the `@theme inline` block in `src/renderer/common/styles/index.css`, below `--font-mono`:

```css
/* Four sizes, chosen from rather than picked per component. The widget had
     9, 10, 11 and 13px scattered across a dozen files, which is a scale
     nobody decided on. */
--text-micro: 9px;
--text-small: 10px;
--text-body: 11px;
--text-display: 15px;
```

- [ ] **Step 2: Replace the literals**

Run this to find every one:

```bash
grep -rnE 'text-\[(9|10|11|13)px\]' src/renderer
```

Replace by size: `text-[9px]` → `text-micro`, `text-[10px]` → `text-small`, `text-[11px]` → `text-body`, `text-[13px]` → `text-display`.

Do not change any other size. `text-base`, `text-sm` and `text-xs` in the settings window are a different surface and are out of scope.

- [ ] **Step 3: Confirm nothing is left**

Run: `grep -rnE 'text-\[(9|10|11|13)px\]' src/renderer`
Expected: no matches, exit code 1.

- [ ] **Step 4: Verify**

Run: `npm run check && npm run build`
Expected: all green. The widget should look identical — this step changes names, not sizes.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/common/styles/index.css src/renderer/common/components
git commit -m "refactor(widget): name the four font sizes

Nine, ten, eleven and thirteen pixels across a dozen files is not a scale
anyone chose. Same sizes, named, so the next one is picked from a set."
```

---

### Task 5: The display treatment

**Files:**

- Modify: `src/renderer/common/components/chrome/TitleBar.tsx:39-46`
- Modify: `src/renderer/common/components/agenda/NextUpBar.tsx:38-49`
- Modify: `src/renderer/common/components/chrome/StatusStrip.tsx:49`

**Interfaces:**

- Consumes: `.card` from Task 3, the type scale from Task 4.
- Produces: nothing other tasks depend on.

The pattern taken from the references: a small muted label, a large value, a status dot. Applied to the two places already doing that job badly.

- [ ] **Step 1: Promote the clock**

In `TitleBar.tsx`, replace the clock and day-label pair (lines 39–46):

```tsx
      {/* The clock anchors the timeline below it (§6). */}
      <span className="tabular shrink-0 font-mono text-display leading-none font-semibold tracking-tight">
        {formatClockTime(nowIso)}
      </span>
      <span className="min-w-0 flex-1 truncate text-small text-text-muted">
        {formatDayLabel(nowIso)}
        {privacyMode ? ' · private' : ''}
      </span>
```

- [ ] **Step 2: Give the next-up bar a label and a value**

In `NextUpBar.tsx`, replace the three children of the wrapper (lines 38–49):

```tsx
      {live ? (
        // A coloured dot is too subtle for the one state you must not miss.
        <span className="shrink-0 rounded-full bg-live px-1.5 py-px text-micro font-semibold tracking-widest text-white uppercase">
          Now
        </span>
      ) : (
        <span className={`size-1.5 shrink-0 rounded-full ${COLOUR_DOT[nextUp.colour]}`} />
      )}
      <span className="min-w-0 flex-1 truncate text-body font-medium" title={nextUp.title}>
        {nextUp.title}
      </span>
      <span className={`tabular shrink-0 font-mono text-body font-medium ${tone}`}>{timing}</span>
```

The `Now` badge becomes a pill, which is the reference pattern. Its colour does not change: green still means running.

- [ ] **Step 3: Make the buttons pills**

In `TitleBar.tsx`, in `TitleBarButton`, change `rounded` to `rounded-full` and widen the padding:

```tsx
      className={`no-drag rounded-full px-2 py-0.5 text-body hover:bg-bg-subtle ${
        active ? 'text-accent' : 'text-text-muted'
      }`}
```

In `StatusStrip.tsx` line 55 and `NextUpBar.tsx` line 56, change `rounded` to `rounded-full` on the Sync and Join buttons, leaving everything else on those lines alone.

- [ ] **Step 4: Look at it**

Run: `npm run build && npm run dev`

Confirm the title bar still fits at the 260px minimum width. The clock is now 15px and semibold, which is the widest it has been; if the buttons wrap, reduce `--text-display` to 14px rather than dropping the day label, which is already the first thing to give up its width.

- [ ] **Step 5: Verify**

Run: `npm run check`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/common/components
git commit -m "feat(widget): small label, large value, pill badges

The clock is the thing you look at, so it is sized like it. The live badge
becomes a pill and the buttons follow. Green still means running."
```

---

### Task 6: Reactive motion

**Files:**

- Modify: `src/renderer/common/styles/index.css` (`@layer base` and `@layer components`)

**Interfaces:**

- Consumes: `.card` from Task 3.
- Produces: nothing.

- [ ] **Step 1: Add the transitions, behind the reduced-motion guard**

In `src/renderer/common/styles/index.css`, at the end of `@layer base`:

```css
/* Reactive only: these fire on hover, press and focus, never on their own.
     The widget sits in peripheral vision all day, and anything that moves
     unprompted competes with whatever the user is actually doing. */
@media (prefers-reduced-motion: no-preference) {
  button {
    transition:
      background-color 120ms ease-out,
      color 120ms ease-out,
      opacity 120ms ease-out;
  }

  button:active:not(:disabled) {
    transform: scale(0.97);
  }
}
```

- [ ] **Step 2: Check it does nothing when asked not to**

Run: `npm run build && npm run dev`

With System Settings → Accessibility → Display → Reduce motion **on**, confirm the press effect does not fire. Turn it back off and confirm it does.

- [ ] **Step 3: Verify**

Run: `npm run check`
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/common/styles/index.css
git commit -m "feat(widget): feedback on press and hover, and nothing else

Wrapped in prefers-reduced-motion, which is not decoration here: this
window is in peripheral vision for eight hours."
```

---

### Task 7: Re-tune the five remaining schemes

**Files:**

- Modify: `src/renderer/common/styles/theme.css:46-64` (light-mode scheme accents), `:69-89` (dark-mode scheme accents)

**Interfaces:**

- Consumes: the translucent base from Task 2.
- Produces: nothing.

Task 2 changed what every scheme is mixed against. A tint tuned for solid white behaves differently over blurred wallpaper, and the dark-mode pastels are most at risk. This task is looking at all six, in both appearances, and adjusting only the accent values.

- [ ] **Step 1: Look at all twelve combinations**

Run: `npm run build && npm run dev`

For each of sky (default), pink, lavender, mint, peach and graphite, in both light and dark, over one plain wallpaper and one busy photograph, check:

1. The scheme is distinguishable from its neighbours. Six schemes nobody can tell apart is the exact failure the existing comment in `theme.css` warns about.
2. Body text and muted text are both readable.
3. `--border` is visible but not heavy — it now draws every card edge, not just a few rules, so a border that was fine as a divider may be too strong as an outline.

- [ ] **Step 2: Adjust only the accents**

Change the `--accent` value for any scheme that fails. Do not add per-scheme overrides for `--bg`, `--border` or `--text-muted`: one accent per scheme is the property that keeps a scheme two lines, and breaking it to fix one colour is a bad trade.

If a scheme cannot be made to work by its accent alone, change the shared mix percentages in the tint block at the bottom of the file, which moves all six together.

- [ ] **Step 3: Verify**

Run: `npm run check`
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/common/styles/theme.css
git commit -m "fix(theme): re-tune the schemes for a translucent base

Tints chosen against solid white read differently over blurred wallpaper.
Only the accents move; one accent per scheme is what keeps adding one to
two lines."
```

---

### Task 8: Update the spec

**Files:**

- Modify: `docs/spec.md` §6

**Interfaces:** none.

The spec is the governing document and currently describes an opaque tinted panel.

- [ ] **Step 1: Record what changed**

In `docs/spec.md` §6, add the window material, the card treatment, the named type scale and the reactive-motion rule. Describe what the app does now, in the same voice as the surrounding sections. Include the two things a future reader would otherwise rediscover the hard way: that an opaque `backgroundColor` defeats the vibrancy, and that the alpha lives in the neutral base so schemes stay two lines each.

- [ ] **Step 2: Verify**

Run: `npm run format:check`
Expected: pass.

- [ ] **Step 3: Commit**

```bash
git add docs/spec.md
git commit -m "docs(spec): record the frosted panel and the card treatment"
```

---

## Self-review

**Spec coverage.** Window material → Task 1. Theme → Task 2. Cards → Task 3. Typography → Tasks 4 and 5. Data display → Task 5. Motion → Task 6. Scheme re-tuning → Task 7. The spec's "order of work" list maps one-to-one onto Tasks 1–7, with Task 8 added for the governing document, which the spec did not mention and should have.

**Testing honesty.** Only Task 1 carries a unit test, because only Task 1 has a pure function worth testing. The spec says the rest is visual and will not be meaningfully covered by unit tests, and this plan does not pretend otherwise by asserting on hex strings or class names. Each visual task instead names exactly what to look at and what failure looks like.

**Risks carried into steps.** Legibility over a bright wallpaper is Task 2 Step 3, with a stated fallback and a range. `fitHeight` breaking under card margins is Task 3 Step 4, with the cause and the fix named. Resize and drag on a transparent window is Task 1 Step 7, with an instruction to stop rather than work around it.
