/** Values shared by both processes. Pure data only — see docs/spec.md §4. */

export const ACCOUNT_COLOURS = ['sky', 'violet', 'amber', 'emerald', 'rose'] as const

/** Every provider the app knows. `ProviderKind` and the IPC schemas both come
 * from this list, so neither can quietly fall behind the other (§8.5). */
export const PROVIDER_KINDS = ['google', 'eventkit', 'mock'] as const

/**
 * Calendar access the user declined, a policy blocked, or macOS granted
 * write-only. All three are terminal until a System Settings toggle changes,
 * so retrying only spins (§7). Shared because both the sync path and the
 * connect response classify against this one list.
 */
export const CALENDAR_ACCESS_REFUSALS = ['denied', 'restricted', 'writeOnly'] as const

/**
 * macOS could not be asked at all: the request threw, or returned false while
 * leaving the status undetermined, which is what happens to an app bundle
 * without `NSCalendarsFullAccessUsageDescription` — macOS will not show a
 * calendar prompt for one.
 *
 * Deliberately *not* a refusal. Nothing was refused, so the System Settings
 * button the refusals carry would point at a pane where nothing is wrong and
 * nothing can be fixed (§7).
 */
export const CALENDAR_PROMPT_UNAVAILABLE = 'promptUnavailable'

/**
 * Every reason a connect attempt added no accounts: the refusals, plus the
 * build that could not ask. One list because only one of them can be the
 * reason, and the pane needs exactly one thing to say.
 */
export const CALENDAR_ACCESS_PROBLEMS = [
  ...CALENDAR_ACCESS_REFUSALS,
  CALENDAR_PROMPT_UNAVAILABLE,
] as const

/** An event is "imminent" this many minutes before it starts (§6). */
export const IMMINENT_THRESHOLD_MINUTES = 15

export const DEFAULT_SYNC_INTERVAL_MINUTES = 3
export const MIN_SYNC_INTERVAL_MINUTES = 1
export const MAX_SYNC_INTERVAL_MINUTES = 15

export const DEFAULT_NOTIFICATION_LEAD_MINUTES = 1
export const MAX_NOTIFICATION_LEAD_MINUTES = 15

/** The timeline's default span; it widens for events outside it (§6). */
export const DEFAULT_DAY_START_HOUR = 7
export const DEFAULT_DAY_END_HOUR = 22

/** Below this width, split view collapses to merged (§6). */
export const SPLIT_VIEW_MIN_WIDTH = 520

/**
 * Widget text size, as a percentage. The widget is sized in pixels throughout,
 * so this is applied as a zoom factor to the whole window rather than a font
 * size: gridlines, blocks and gutters then grow with the text (§6).
 */
export const DEFAULT_WIDGET_TEXT_SCALE = 100
export const MIN_WIDGET_TEXT_SCALE = 80
export const MAX_WIDGET_TEXT_SCALE = 200
export const WIDGET_TEXT_SCALE_STEP = 5

/** Hostile invites control this text, so it is bounded before use (§8.1). */
export const MAX_EVENT_TITLE_LENGTH = 200

/** Shown instead of a real title while privacy mode is on (§6). */
export const PRIVACY_PLACEHOLDER_TITLE = 'Busy'

/** The same idea for a TODO, which is not a meeting and is never "Busy". */
export const PRIVACY_PLACEHOLDER_TODO_TITLE = 'Task'

/** The notch hides long menu-bar titles (§6). */
export const TRAY_TITLE_MAX_LENGTH = 16

/** Hand-typed and dictated, so bounded like any other untrusted string (§8.1). */
export const MAX_TODO_TITLE_LENGTH = 200

/** A glanceable panel stops being glanceable long before this (§6). */
export const MAX_TODOS = 500

/** Completed TODOs older than this are dropped when the list is written. */
export const TODO_COMPLETED_RETENTION_DAYS = 30

/**
 * The space left between neighbouring TODO ranks (§6).
 *
 * Reordering writes the midpoint of an item's new neighbours, so a gap this
 * wide means one item changes rather than the whole list being renumbered.
 */
export const RANK_GAP = 1000

/**
 * Opens the quick-add window from anywhere, since there is no Dock icon (§6).
 * Configurable, because a global shortcut is taken from every other app and
 * whatever we pick will collide with something on someone's machine. Control
 * and Option together is the corner of the keyboard macOS and browsers leave
 * alone; Command+Shift+T is already "reopen closed tab" nearly everywhere.
 */
export const DEFAULT_QUICK_ADD_SHORTCUT = 'Control+Alt+T'
/** An accelerator is modifiers plus one key; nothing legal comes near this. */
export const MAX_SHORTCUT_LENGTH = 64
export const QUICK_ADD_WINDOW_WIDTH = 460
export const QUICK_ADD_WINDOW_HEIGHT = 96

export const WIDGET_MIN_WIDTH = 260
export const WIDGET_MIN_HEIGHT = 200
export const WIDGET_DEFAULT_WIDTH = 320
/** Tall enough for the timeline and the TODO panel below it (§6). */
export const WIDGET_DEFAULT_HEIGHT = 480
export const WIDGET_SCREEN_MARGIN = 16

/**
 * The floor once the timeline is off (§6). Lower than WIDGET_MIN_HEIGHT
 * because with nothing that scrolls there is nothing to squash: the title bar
 * and "what's next" are the whole window, and that has to be allowed to be
 * genuinely small or the laptop case is not served.
 */
export const WIDGET_COMPACT_MIN_HEIGHT = 86

/**
 * Upper bound on a height the renderer may ask for. Not a layout value — it
 * exists so a measurement arriving wrong cannot ask for a window taller than
 * any display, before main clamps it to the real work area.
 */
export const MAX_WIDGET_FIT_HEIGHT = 4000

export const SETTINGS_WINDOW_WIDTH = 720
export const SETTINGS_WINDOW_HEIGHT = 560
