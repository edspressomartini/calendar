/** Pure time helpers shared by both processes. No Node, Electron or DOM. */

export const MINUTE_MS = 60_000
export const DAY_MS = 86_400_000

export function startOfLocalDay(now: Date): Date {
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  return start
}

export function endOfLocalDay(now: Date): Date {
  const end = startOfLocalDay(now)
  end.setDate(end.getDate() + 1)
  return end
}

export function isSameLocalDay(left: Date, right: Date): boolean {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  )
}

/** Milliseconds until the next wall-clock minute boundary. Always 1..60000. */
export function msUntilNextMinute(now: Date): number {
  const elapsed = now.getSeconds() * 1000 + now.getMilliseconds()
  return MINUTE_MS - elapsed
}

/** Whole minutes from `from` to `to`, rounded towards zero. */
export function minutesBetween(from: Date, to: Date): number {
  return Math.trunc((to.getTime() - from.getTime()) / MINUTE_MS)
}

/** Minutes until `iso` starts; negative once it has passed. Rounded up so that
 * "in 59 seconds" reads as 1 minute rather than 0. */
export function minutesUntil(now: Date, iso: string): number {
  const target = Date.parse(iso)
  if (Number.isNaN(target)) {
    return 0
  }
  return Math.ceil((target - now.getTime()) / MINUTE_MS)
}

export function isValidTimestamp(iso: string): boolean {
  return !Number.isNaN(Date.parse(iso))
}

/** `YYYY-MM-DD` in local time. Lexicographic order is chronological order. */
export function toLocalDayKey(date: Date): string {
  const year = date.getFullYear().toString().padStart(4, '0')
  const month = (date.getMonth() + 1).toString().padStart(2, '0')
  const day = date.getDate().toString().padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function isLocalDayKey(candidate: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(candidate)) {
    return false
  }
  return toLocalDayKey(parseLocalDayKey(candidate)) === candidate
}

/** Midnight local time on that day. Invalid input is not this function's job. */
export function parseLocalDayKey(dayKey: string): Date {
  const [year, month, day] = dayKey.split('-').map(Number)
  return new Date(year ?? 0, (month ?? 1) - 1, day ?? 1)
}

/** Whole days from one calendar day to another; negative when `to` is earlier. */
export function daysBetweenDayKeys(from: string, to: string): number {
  const elapsed = parseLocalDayKey(to).getTime() - parseLocalDayKey(from).getTime()
  // Rounded because a day spanning a DST change is 23 or 25 hours long.
  return Math.round(elapsed / DAY_MS)
}

/** Calendar arithmetic, so it steps correctly across months and DST. */
export function addLocalDays(dayKey: string, days: number): string {
  const date = parseLocalDayKey(dayKey)
  date.setDate(date.getDate() + days)
  return toLocalDayKey(date)
}
