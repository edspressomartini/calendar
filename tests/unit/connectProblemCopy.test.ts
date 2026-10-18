import { describe, expect, it } from 'vitest'
import {
  CONNECT_PROBLEM_MESSAGE,
  offersPrivacySettings,
} from '../../src/renderer/settings/connectProblemCopy.ts'
import {
  CALENDAR_ACCESS_REFUSALS,
  CALENDAR_PROMPT_UNAVAILABLE,
  CONNECT_PROBLEMS,
} from '../../src/shared/constants.ts'

/**
 * The defect: one sentence stood in for four unrelated failures. These tests
 * pin that every reason has copy of its own, and that none of it leaks
 * anything the log is for.
 */
describe('connect problem copy', () => {
  it('says something different for every reason a connect attempt added nothing', () => {
    const messages = CONNECT_PROBLEMS.map((problem) => CONNECT_PROBLEM_MESSAGE[problem])

    expect(new Set(messages).size).toBe(CONNECT_PROBLEMS.length)
    for (const message of messages) {
      expect(message.length).toBeGreaterThan(0)
    }
  })

  /** Plain language: no kinds, no codes, no underscores from the wire. */
  it('never shows the user a wire name or an error code', () => {
    for (const problem of CONNECT_PROBLEMS) {
      const message = CONNECT_PROBLEM_MESSAGE[problem]
      expect(message).not.toContain(problem)
      expect(message).not.toContain('_')
      expect(message).not.toContain('EventKitError')
    }
  })

  /**
   * The privacy pane fixes a refusal and nothing else. Offering it anywhere
   * else sends the user somewhere nothing is wrong.
   */
  it('offers System Settings for the three refusals and nothing else', () => {
    for (const refusal of CALENDAR_ACCESS_REFUSALS) {
      expect(offersPrivacySettings(refusal)).toBe(true)
    }
    expect(offersPrivacySettings(CALENDAR_PROMPT_UNAVAILABLE)).toBe(false)
    expect(offersPrivacySettings('helperUnavailable')).toBe(false)
    expect(offersPrivacySettings('timedOut')).toBe(false)
    expect(offersPrivacySettings('helperMismatch')).toBe(false)
    expect(offersPrivacySettings('storeUnreadable')).toBe(false)
  })

  /** Each one tells the user what to do next, not only that it went wrong. */
  it.each(['helperUnavailable', 'timedOut', 'helperMismatch', 'storeUnreadable'] as const)(
    'tells the user what to try after %s',
    (problem) => {
      expect(CONNECT_PROBLEM_MESSAGE[problem]).toMatch(/try again|restart|reinstall|open calendar/i)
    },
  )
})
