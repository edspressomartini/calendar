import { CALENDAR_ACCESS_REFUSALS } from '../../shared/constants.ts'
import type { CalendarAccessRefusal, ConnectProblem } from '../../shared/types/account.ts'

/**
 * What the Accounts pane says when a connect attempt added nothing.
 *
 * Said in the user's terms, and said differently for each cause: the same
 * sentence stood in for a helper that could not start, a build that could not
 * ask, a store that would not open and a reply nobody could parse, which are
 * four problems with four different answers.
 *
 * No kinds, no codes, no raw error text. Whatever the log needs stays in the
 * log (§8.7); this is only ever the typed cause turned into words.
 *
 * Keyed on the whole union, so a new cause will not compile until it has
 * something to say for itself.
 */
export const CONNECT_PROBLEM_MESSAGE: Record<ConnectProblem, string> = {
  denied: 'macOS declined calendar access, so no accounts were added.',
  restricted: 'Calendar access is blocked on this Mac by a policy or Screen Time.',
  writeOnly: 'macOS granted write-only calendar access, which cannot read your events.',
  promptUnavailable:
    'This copy of Up Next cannot ask macOS for calendar access, so nothing was added. Reinstall Up Next and try again.',
  helperUnavailable:
    'Up Next could not start the part of itself that reads Apple Calendar, so nothing was added. Quit Up Next and open it again; if that keeps happening, reinstall it.',
  timedOut:
    'Apple Calendar took too long to answer, so nothing was added. If a permission window is still waiting, answer it, then try again.',
  helperMismatch:
    'Up Next could not make sense of what Apple Calendar sent back, so nothing was added. Quit Up Next and open it again; if that keeps happening, reinstall it.',
  storeUnreadable:
    'macOS allowed access but could not read your calendars, so nothing was added. Open the Calendar app to check it is working, then try again.',
}

/** Typed against the union, so a member that is not a cause will not compile. */
const REFUSALS: ReadonlySet<ConnectProblem> = new Set<ConnectProblem>(CALENDAR_ACCESS_REFUSALS)

/**
 * The privacy pane fixes a refusal and nothing else. Offering it for a prompt
 * that was never shown, or for a helper that never started, would send the
 * user somewhere nothing is wrong and nothing can be changed — the same false
 * explanation in a new costume.
 */
export function offersPrivacySettings(problem: ConnectProblem): problem is CalendarAccessRefusal {
  return REFUSALS.has(problem)
}
