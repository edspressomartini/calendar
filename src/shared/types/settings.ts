import type { AccountConfig } from './account.ts'

export type ViewMode = 'merged' | 'split'
export type ThemeSource = 'system' | 'light' | 'dark'
/**
 * The accent the widget is tinted with. Independent of light and dark, which
 * macOS owns: every scheme has a version of itself in both.
 */
export const COLOUR_SCHEMES = ['default', 'pink', 'lavender', 'mint', 'peach', 'graphite'] as const
export type ColourScheme = (typeof COLOUR_SCHEMES)[number]
/** Where the TODO list sits relative to the timeline in the widget. */
export type TodoPlacement = 'above' | 'below'
export type WidgetCorner = 'topRight' | 'topLeft' | 'bottomRight' | 'bottomLeft' | 'remembered'

/**
 * Displays are matched by label and size first, because macOS display ids change
 * across reconnects (§10).
 */
export interface DisplayKey {
  readonly id: number
  readonly label: string
  readonly width: number
  readonly height: number
}

export interface WidgetPlacement {
  readonly display: DisplayKey | null
  readonly corner: WidgetCorner
  readonly bounds: { x: number; y: number; width: number; height: number } | null
}

export interface AppSettings {
  readonly viewMode: ViewMode
  readonly theme: ThemeSource
  readonly colourScheme: ColourScheme
  readonly syncIntervalMinutes: number
  /** Null disables meeting notifications. */
  readonly notificationLeadMinutes: number | null
  /** Hours the timeline shows by default; it widens for events outside them. */
  readonly dayStartHour: number
  readonly dayEndHour: number
  /** A second IANA zone shown alongside local time, or null for one column. */
  readonly secondaryTimeZone: string | null
  /** Percent. Scales the whole widget, since everything in it is sized in px. */
  readonly widgetTextScale: number
  readonly todoPlacement: TodoPlacement
  /**
   * Whether the widget draws the timeline and the TODO list at all. Both are
   * on by default; turning them off is how the widget becomes small enough to
   * live on a laptop screen with no second monitor (§6). "What's next" is not
   * toggleable, because a widget showing neither would have nothing to say.
   */
  readonly showTimeline: boolean
  readonly showTodos: boolean
  /**
   * The global shortcut that opens quick add. Always one main has actually
   * registered: a value we could not claim would be a lie on screen.
   */
  readonly quickAddShortcut: string
  readonly hideTitlesInMenuBar: boolean
  readonly privacyMode: boolean
  readonly launchAtLogin: boolean
  readonly alwaysOnTop: boolean
  /**
   * Whether the widget is withheld from screen capture. On by default: the
   * panel sits over everything, so the failure mode is a shared screen.
   */
  readonly hideFromScreenShare: boolean
  readonly placement: WidgetPlacement
  readonly accounts: readonly AccountConfig[]
}

export interface DisplayOption {
  readonly key: DisplayKey
  readonly isPrimary: boolean
  readonly isCurrent: boolean
}
