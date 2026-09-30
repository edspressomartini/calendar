import type { AccountConfig } from './account.ts'

export type ViewMode = 'merged' | 'split'
export type ThemeSource = 'system' | 'light' | 'dark'
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
  readonly hideTitlesInMenuBar: boolean
  readonly privacyMode: boolean
  readonly launchAtLogin: boolean
  readonly alwaysOnTop: boolean
  readonly placement: WidgetPlacement
  readonly accounts: readonly AccountConfig[]
}

export interface DisplayOption {
  readonly key: DisplayKey
  readonly isPrimary: boolean
  readonly isCurrent: boolean
}
