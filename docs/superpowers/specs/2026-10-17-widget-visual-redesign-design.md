# Widget visual redesign

**Date:** 17 October 2026
**Status:** approved, not implemented

## Why

The widget works and looks assembled rather than designed. It is 9–13px type
on a flat tinted rectangle, with hairline rules separating everything from
everything, no radius, no depth and no hierarchy beyond font weight. It does
its job and it is not something you would want sitting on your desktop all
day.

Two reference sites were given: <https://www.just2connect.co.uk/> and the BCB
Group prototype. What they share is more useful than either alone — an
off-white ground rather than pure white, one saturated accent used sparingly,
large tight-tracked headings, soft cards with hairline borders and a barely
visible shadow, pill-shaped buttons and status badges, and a data-display
pattern of a small muted label above a large value with a green live dot.

Of those, the qualities actually wanted here are: the typography, the soft
cards, the data display, the depth, the motion, and the general sense of
something designed. Deliberately **not** the single-bold-accent-on-white look
— the colour schemes already do that job and are staying.

## Scope

A restyle. Same layout, same information, same behaviour. What changes is the
surface: the window material, the theme tokens, the type scale, card
treatment, and interaction feedback.

Explicitly not in scope:

- Rethinking what sits where. The layout was arrived at over several rounds of
  real use and is not the problem.
- A hero treatment that promotes the next meeting above everything else.
  Considered and rejected: the day timeline is the reason the widget exists.
- Changing the density. An early answer suggested wanting more breathing room,
  which conflicts directly with the full-day-in-30-minute-blocks requirement
  the widget was built around. On re-asking, breathing room was not among the
  qualities wanted, so density stays as it is.

## The window material

`transparent: true` plus `vibrancy: 'under-window'`, with rounded corners.
`type: 'panel'`, the non-activating behaviour, all-Spaces placement and
`setContentProtection` are untouched.

`under-window` rather than the alternatives:

- `hud` is darker and more opaque. It reads as a floating widget rather than
  as part of the system, which is the opposite of what is wanted.
- A transparent window with a CSS `backdrop-filter` gives finer control, but
  blurs visibly worse than the native material, costs more GPU on a window
  that is always on screen, and will not match other Mac apps as the system
  appearance changes.

## The theme

`theme.css` currently mixes each scheme's accent into an **opaque** neutral
base. Over glass an opaque background defeats the material entirely, so the
base changes rather than the structure:

- `--neutral-bg` becomes fully transparent.
- Each scheme's tint becomes a translucent wash over the material instead of a
  solid fill, by mixing to a colour with an alpha channel rather than to white
  or slate-900.
- `--bg-subtle`, `--border` and `--text-muted` keep their present derivation.
  One accent per scheme, everything else mixed from it, stays true — that is
  the part of the existing design worth protecting, because it is what makes
  adding a scheme two lines.

Text colours do not move. The existing rule that the tint never costs
legibility still holds, and matters more over blurred wallpaper than over
white.

All six schemes need re-tuning afterwards. A wash that reads well over solid
white reads differently over an arbitrary photograph, and the dark-mode
pastels are the most at risk.

## Cards

The TODO panel and the timeline become cards sitting on the glass rather than
regions divided by rules: 10px radius, a hairline border, a soft shadow.
This is where the depth comes from — layered over the vibrancy, not instead of
it. Most of the current `border-t` / `border-b` dividers go, because the card
edge already does that work.

## Typography

Poppins for prose and monospace for times, which arrives with the Pin and
Poppins change. On top of that, a named type scale replaces the scattered
`text-[9px]` / `text-[10px]` / `text-[11px]` literals, so sizes are chosen from
a set rather than picked per component.

The clock and the next-up line are promoted to display sizes with tight
tracking. The data-display pattern — small muted uppercase label, large value,
green live dot — is applied to the next-up bar and the status strip, which are
the two places already doing that job badly.

## Motion

Reactive only. Hover and press feedback, the TODO panel expanding and
collapsing, new items sliding in. Nothing animates unprompted: this sits in
peripheral vision all day, and anything that moves on its own competes with
whatever the user is actually doing. A pulsing live dot was offered and
declined for that reason.

Everything is wrapped in `prefers-reduced-motion`.

## Risks

**Legibility over an arbitrary wallpaper.** The real one. Vibrancy blurs hard
enough that it is usually fine, but a bright photograph under a light theme is
the worst case. This needs looking at on a real desktop rather than asserting;
if it fails, the fallback is to raise the opacity of the wash until it holds,
which trades some of the effect for readability.

**Battery and GPU.** A blurred, always-on-top window present on every Space is
a permanent cost. Small, but not nothing, and it applies whenever the widget
is visible rather than only when it is being used.

**Transparent windows and resizing.** The widget is user-resizable and
`fitHeight` measures content to size the window. Card padding changes those
measurements, and transparent frameless windows can behave differently at the
edges. Both need checking rather than assuming.

**Privacy.** Unaffected. Privacy mode redacts titles in main before they reach
a renderer, and `setContentProtection` is a window flag; neither interacts with
the material.

## Testing

The pure parts are testable and should be tested: the type scale as tokens,
and any contrast helper that decides a wash opacity. The rest is visual and
will not be meaningfully covered by unit tests — it needs looking at, in both
appearances, across all six schemes, over at least one busy wallpaper and one
plain one.

The existing suite must keep passing. None of it asserts on styling, so a
failure would mean something behavioural moved.

## Order of work

1. Window material and rounded corners, with the theme still opaque — confirm
   the window itself behaves before anything depends on it.
2. Theme tokens to translucent, default scheme only.
3. Cards and the removal of the dividers they replace.
4. Type scale, then the display treatment on the clock and next-up bar.
5. Interaction and motion.
6. Re-tune the remaining five schemes, in both appearances.

Each step is independently viewable, and step 1 is the one most likely to
reveal that an assumption here is wrong.
