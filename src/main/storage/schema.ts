import { appSettingsSchema } from '../../shared/ipc/contract.ts'
import {
  ACCOUNT_COLOURS,
  DEFAULT_DAY_END_HOUR,
  DEFAULT_DAY_START_HOUR,
  DEFAULT_NOTIFICATION_LEAD_MINUTES,
  DEFAULT_QUICK_ADD_SHORTCUT,
  DEFAULT_SYNC_INTERVAL_MINUTES,
  DEFAULT_WIDGET_TEXT_SCALE,
} from '../../shared/constants.ts'
import type { AccountColour, AccountConfig } from '../../shared/types/account.ts'
import type { AppSettings } from '../../shared/types/settings.ts'

/**
 * The persisted shape. Settings and window state only — never secrets
 * (docs/spec.md §8.2).
 */
// A type alias, not an interface: electron-store's generic is constrained to
// Record<string, any>, which only structural type aliases satisfy.
export type PersistedState = {
  schemaVersion: number
  settings: AppSettings
}

export const CURRENT_SCHEMA_VERSION = 1

export const DEFAULT_SETTINGS: AppSettings = {
  viewMode: 'merged',
  theme: 'system',
  syncIntervalMinutes: DEFAULT_SYNC_INTERVAL_MINUTES,
  notificationLeadMinutes: DEFAULT_NOTIFICATION_LEAD_MINUTES,
  dayStartHour: DEFAULT_DAY_START_HOUR,
  dayEndHour: DEFAULT_DAY_END_HOUR,
  secondaryTimeZone: null,
  widgetTextScale: DEFAULT_WIDGET_TEXT_SCALE,
  todoPlacement: 'below',
  quickAddShortcut: DEFAULT_QUICK_ADD_SHORTCUT,
  hideTitlesInMenuBar: false,
  privacyMode: false,
  launchAtLogin: false,
  alwaysOnTop: true,
  placement: { display: null, corner: 'topRight', bounds: null },
  accounts: [],
}

export const DEFAULT_STATE: PersistedState = {
  schemaVersion: CURRENT_SCHEMA_VERSION,
  settings: DEFAULT_SETTINGS,
}

/**
 * A corrupt or hand-edited settings file must not crash startup or, worse,
 * hand unvalidated values to the rest of the app.
 *
 * Known fields are taken from the stored file, anything missing falls back to
 * its default, and anything unrecognised is dropped. That matters on upgrade:
 * a strict parse of an older file would fail, and the fallback would quietly
 * reset the settings — disconnecting the user's accounts.
 *
 * One bad value is treated the same way, field by field, for the same reason:
 * a shortcut this version no longer accepts should cost the user that
 * shortcut, not their accounts.
 */
export function parseSettings(candidate: unknown): AppSettings {
  if (typeof candidate !== 'object' || candidate === null) {
    return DEFAULT_SETTINGS
  }

  const stored = candidate as Readonly<Record<string, unknown>>
  const known: Record<string, unknown> = { ...DEFAULT_SETTINGS }
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    if (key in stored) {
      known[key] = stored[key]
    }
  }

  const result = appSettingsSchema.safeParse(known)
  return result.success ? result.data : repairFields(known)
}

function isSettingName(key: string): key is keyof AppSettings {
  return key in DEFAULT_SETTINGS
}

/** Replaces only the fields that failed, then insists on the whole shape. */
function repairFields(known: Readonly<Record<string, unknown>>): AppSettings {
  const repaired: Record<string, unknown> = { ...known }
  for (const [key, field] of Object.entries(appSettingsSchema.shape)) {
    if (!isSettingName(key) || field.safeParse(repaired[key]).success) {
      continue
    }
    repaired[key] = DEFAULT_SETTINGS[key]
  }

  const result = appSettingsSchema.safeParse(repaired)
  return result.success ? result.data : DEFAULT_SETTINGS
}

/** Fixed rotation, first unused colour wins (§6). */
export function nextAccountColour(existing: readonly AccountConfig[]): AccountColour {
  const taken = new Set(existing.map((account) => account.colour))
  const free = ACCOUNT_COLOURS.find((colour) => !taken.has(colour))
  return free ?? ACCOUNT_COLOURS[existing.length % ACCOUNT_COLOURS.length]!
}
