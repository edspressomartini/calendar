/** Values shared by both processes. Pure data only — see docs/spec.md §4. */

export const ACCOUNT_COLOURS = ['sky', 'violet', 'amber', 'emerald', 'rose'] as const

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

/** Opens the quick-add window from anywhere, since there is no Dock icon (§6). */
export const QUICK_ADD_SHORTCUT = 'Command+Shift+T'
export const QUICK_ADD_WINDOW_WIDTH = 460
export const QUICK_ADD_WINDOW_HEIGHT = 96

export const WIDGET_MIN_WIDTH = 260
export const WIDGET_MIN_HEIGHT = 200
export const WIDGET_DEFAULT_WIDTH = 320
/** Tall enough for the timeline and the TODO panel below it (§6). */
export const WIDGET_DEFAULT_HEIGHT = 480
export const WIDGET_SCREEN_MARGIN = 16

export const SETTINGS_WINDOW_WIDTH = 720
export const SETTINGS_WINDOW_HEIGHT = 560
