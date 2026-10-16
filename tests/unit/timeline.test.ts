import { describe, expect, it } from 'vitest'
import {
  assignLanes,
  blockFor,
  buildTicks,
  ratioFor,
  resolveDayWindow,
  scrollTopToRevealNow,
  type DayWindow,
  type TimedBlock,
} from '../../src/shared/timeline.ts'

/** Time drawn to scale is what makes the widget answer "how far through the day am I". */

const PREFS = { startHour: 7, endHour: 22 }

function at(hour: number, minute = 0): Date {
  return new Date(2026, 8, 25, hour, minute, 0, 0)
}

function block(startHour: number, endHour: number, isAllDay = false): TimedBlock {
  return {
    start: at(startHour).toISOString(),
    end: at(endHour).toISOString(),
    isAllDay,
  }
}

function hourOf(ms: number): number {
  return new Date(ms).getHours()
}

describe('resolveDayWindow', () => {
  it('uses the configured working hours when everything fits', () => {
    const window = resolveDayWindow(at(10), [block(9, 10)], PREFS)

    expect(hourOf(window.startMs)).toBe(7)
    expect(hourOf(window.endMs)).toBe(22)
  })

  it('widens upward for an early meeting', () => {
    const window = resolveDayWindow(at(10), [block(6, 7)], PREFS)
    expect(hourOf(window.startMs)).toBe(6)
  })

  it('widens downward for a late meeting', () => {
    const window = resolveDayWindow(at(10), [block(22, 23)], PREFS)
    expect(hourOf(window.endMs)).toBe(23)
  })

  it('always includes the current time', () => {
    const early = resolveDayWindow(at(5, 15), [], PREFS)
    expect(hourOf(early.startMs)).toBe(5)

    const late = resolveDayWindow(at(23, 45), [], PREFS)
    expect(late.endMs).toBeGreaterThanOrEqual(at(23, 45).getTime())
  })

  it('never runs past the end of the day', () => {
    const window = resolveDayWindow(at(23, 50), [block(23, 24)], PREFS)
    const endOfDay = new Date(2026, 8, 26, 0, 0, 0, 0).getTime()

    expect(window.endMs).toBeLessThanOrEqual(endOfDay)
  })

  it('ignores all-day events when sizing the window', () => {
    const allDayOnly = resolveDayWindow(at(10), [block(0, 24, true)], PREFS)
    expect(hourOf(allDayOnly.startMs)).toBe(7)
  })

  it('survives nonsense preferences', () => {
    const window = resolveDayWindow(at(10), [], { startHour: 30, endHour: -5 })
    expect(window.endMs).toBeGreaterThan(window.startMs)
  })
})

describe('ratioFor', () => {
  const window: DayWindow = { startMs: at(8).getTime(), endMs: at(20).getTime() }

  it('maps the window bounds to 0 and 1', () => {
    expect(ratioFor(at(8).getTime(), window)).toBe(0)
    expect(ratioFor(at(20).getTime(), window)).toBe(1)
  })

  it('maps the midpoint to a half', () => {
    expect(ratioFor(at(14).getTime(), window)).toBeCloseTo(0.5, 5)
  })

  it('clamps anything outside the window', () => {
    expect(ratioFor(at(6).getTime(), window)).toBe(0)
    expect(ratioFor(at(23).getTime(), window)).toBe(1)
  })
})

describe('blockFor', () => {
  const window: DayWindow = { startMs: at(8).getTime(), endMs: at(20).getTime() }

  it('positions and sizes an event proportionally', () => {
    const position = blockFor(block(11, 12), window)

    expect(position.top).toBeCloseTo(0.25, 5)
    expect(position.height).toBeCloseTo(1 / 12, 5)
  })

  it('clips an event that starts before the window', () => {
    const position = blockFor(block(6, 9), window)

    expect(position.top).toBe(0)
    expect(position.height).toBeCloseTo(1 / 12, 5)
  })

  it('returns nothing usable for an unparseable time', () => {
    const position = blockFor({ start: 'nope', end: 'nope', isAllDay: false }, window)
    expect(position).toEqual({ top: 0, height: 0 })
  })
})

describe('buildTicks', () => {
  it('marks every half hour and flags the hours', () => {
    const ticks = buildTicks({ startMs: at(9).getTime(), endMs: at(11).getTime() })

    expect(ticks).toHaveLength(5)
    expect(ticks.filter((tick) => tick.major)).toHaveLength(3)
  })

  it('starts at the first boundary inside the window', () => {
    const ticks = buildTicks({ startMs: at(9, 10).getTime(), endMs: at(10).getTime() })

    expect(new Date(ticks[0]!.ms).getMinutes()).toBe(30)
  })
})

describe('assignLanes', () => {
  it('gives a lone event the full width', () => {
    const [assignment] = assignLanes([block(9, 10)])

    expect(assignment?.lane).toBe(0)
    expect(assignment?.laneCount).toBe(1)
  })

  it('puts overlapping events side by side', () => {
    const lanes = assignLanes([block(9, 11), block(10, 12)])

    expect(lanes.map((entry) => entry.lane)).toEqual([0, 1])
    expect(lanes.every((entry) => entry.laneCount === 2)).toBe(true)
  })

  it('reuses a column once the earlier event has finished', () => {
    const lanes = assignLanes([block(9, 10), block(10, 11)])

    expect(lanes.map((entry) => entry.lane)).toEqual([0, 0])
    expect(lanes.every((entry) => entry.laneCount === 1)).toBe(true)
  })

  it('keeps separate clusters from widening each other', () => {
    const lanes = assignLanes([block(9, 11), block(10, 12), block(14, 15)])

    expect(lanes[2]?.laneCount).toBe(1)
  })

  it('handles a triple booking', () => {
    const lanes = assignLanes([block(9, 12), block(9, 10), block(9, 11)])

    expect(new Set(lanes.map((entry) => entry.lane)).size).toBe(3)
    expect(lanes.every((entry) => entry.laneCount === 3)).toBe(true)
  })

  it('leaves all-day events out', () => {
    expect(assignLanes([block(0, 24, true)])).toHaveLength(0)
  })
})

/**
 * Shrinking the widget must not let the current time slide off the bottom:
 * a timeline you have to scroll to find yourself on is a list with extra steps.
 */
describe('scrollTopToRevealNow', () => {
  const CONTENT = 1000

  it('does not scroll when the whole timeline fits', () => {
    expect(scrollTopToRevealNow(400, 1000, CONTENT, 0)).toBeNull()
  })

  it('leaves a comfortably visible now alone', () => {
    // Reposition on every tick and the user could never read anything else.
    expect(scrollTopToRevealNow(500, 400, CONTENT, 400)).toBeNull()
  })

  it('centres now when it has fallen off the bottom', () => {
    expect(scrollTopToRevealNow(800, 200, CONTENT, 0)).toBe(700)
  })

  it('centres now when it is above the visible slice', () => {
    expect(scrollTopToRevealNow(100, 200, CONTENT, 600)).toBe(0)
  })

  it('treats now pressed against an edge as hidden', () => {
    // Flush against the top edge technically counts as visible, and hides
    // everything about to happen — which is the part that matters.
    const target = scrollTopToRevealNow(405, 200, CONTENT, 400)

    expect(target).toBe(305)
  })

  it('never scrolls past the end of the timeline', () => {
    const target = scrollTopToRevealNow(995, 200, CONTENT, 0)

    expect(target).toBe(CONTENT - 200)
  })

  it('shrinks the margin rather than fighting itself in a tiny window', () => {
    // A fixed 24px margin against a 40px viewport would exceed half of it, so
    // every position would read as too close to an edge and it would scroll
    // on every tick.
    expect(scrollTopToRevealNow(420, 40, CONTENT, 400)).toBeNull()
  })

  it('reports no change rather than the offset it is already at', () => {
    // 900 is both the centred position and the clamped maximum.
    expect(scrollTopToRevealNow(1000, 200, CONTENT, 800)).toBeNull()
  })
})
