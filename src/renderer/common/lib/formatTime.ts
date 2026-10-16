import { isLocalDayKey, parseLocalDayKey } from '../../../shared/time.ts'

const timeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
})

const dayFormatter = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
})

export function formatDayLabel(iso: string): string {
  const parsed = Date.parse(iso)
  if (Number.isNaN(parsed)) {
    return 'Today'
  }
  return dayFormatter.format(new Date(parsed))
}

/**
 * A `YYYY-MM-DD` day key, not an instant. Parsed as local midnight rather
 * than handed to Date.parse, which reads a bare date as UTC and would print
 * the day before for anyone west of Greenwich.
 */
export function formatDayKeyLabel(dayKey: string): string {
  if (!isLocalDayKey(dayKey)) {
    return dayKey
  }
  return dayFormatter.format(parseLocalDayKey(dayKey))
}

/** Formatters are cached: the gutter reformats every tick on each render. */
const zonedFormatters = new Map<string, Intl.DateTimeFormat>()

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  const existing = zonedFormatters.get(timeZone)
  if (existing) {
    return existing
  }

  let formatter: Intl.DateTimeFormat
  try {
    formatter = new Intl.DateTimeFormat(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      timeZone,
    })
  } catch {
    formatter = timeFormatter
  }

  zonedFormatters.set(timeZone, formatter)
  return formatter
}

export function formatClockTime(iso: string, timeZone?: string): string {
  const parsed = Date.parse(iso)
  if (Number.isNaN(parsed)) {
    return '--:--'
  }
  const formatter = timeZone ? formatterFor(timeZone) : timeFormatter
  return formatter.format(new Date(parsed))
}

/** Short enough for a narrow column: "4m", "2h 10m", "now". */
export function formatDuration(minutes: number): string {
  if (minutes <= 0) {
    return 'now'
  }
  if (minutes < 60) {
    return `${minutes}m`
  }
  const hours = Math.floor(minutes / 60)
  const remainder = minutes % 60
  return remainder === 0 ? `${hours}h` : `${hours}h ${remainder}m`
}

export function formatRelativeSync(iso: string | null, nowIso: string): string {
  if (!iso) {
    return 'not synced yet'
  }
  const then = Date.parse(iso)
  const now = Date.parse(nowIso)
  if (Number.isNaN(then) || Number.isNaN(now)) {
    return 'not synced yet'
  }

  const minutes = Math.max(0, Math.floor((now - then) / 60_000))
  if (minutes === 0) {
    return 'synced just now'
  }
  return `synced ${formatDuration(minutes)} ago`
}
