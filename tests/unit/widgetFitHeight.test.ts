import { describe, expect, it } from 'vitest'
import type { Rectangle } from 'electron'
import {
  boundsForFittedHeight,
  heightForTextScale,
  type DisplayArea,
} from '../../src/main/windows/displayPlacement.ts'
import { WIDGET_COMPACT_MIN_HEIGHT } from '../../src/shared/constants.ts'

/**
 * The height comes from the renderer, which measured it (docs/spec.md §6).
 * That makes it untrusted input: the cases here are the ones that would
 * otherwise leave the user with a window they cannot grab.
 */

const workArea = { x: 0, y: 25, width: 1920, height: 1055 }

const display: DisplayArea = { workArea }

const bounds: Rectangle = { x: 100, y: 100, width: 320, height: 480 }

function fit(requested: number, from: Rectangle = bounds): Rectangle {
  return boundsForFittedHeight(from, display, requested, WIDGET_COMPACT_MIN_HEIGHT)
}

describe('boundsForFittedHeight', () => {
  it('shrinks to the measured height and leaves the position alone', () => {
    const fitted = fit(140)

    expect(fitted.height).toBe(140)
    expect(fitted.x).toBe(100)
    expect(fitted.y).toBe(100)
    expect(fitted.width).toBe(320)
  })

  it('refuses to go below the compact floor, so the title bar stays grabbable', () => {
    expect(fit(10).height).toBe(WIDGET_COMPACT_MIN_HEIGHT)
    expect(fit(0).height).toBe(WIDGET_COMPACT_MIN_HEIGHT)
  })

  it('caps a height larger than the screen rather than trusting it', () => {
    expect(fit(99_999).height).toBeLessThanOrEqual(workArea.height)
  })

  it('pulls the window back on-screen when growing would push it off the bottom', () => {
    const low: Rectangle = { x: 100, y: 1000, width: 320, height: 80 }

    const fitted = fit(400, low)

    expect(fitted.y + fitted.height).toBeLessThanOrEqual(workArea.y + workArea.height)
  })

  it('never returns a height the work area cannot hold, even on a tiny screen', () => {
    const tiny: DisplayArea = { workArea: { x: 0, y: 0, width: 400, height: 60 } }

    const fitted = boundsForFittedHeight(bounds, tiny, 500, WIDGET_COMPACT_MIN_HEIGHT)

    expect(fitted.height).toBeLessThanOrEqual(60)
  })
})

describe('heightForTextScale', () => {
  it('leaves an unzoomed measurement alone', () => {
    expect(heightForTextScale(300, 100)).toBe(300)
  })

  it('grows the window by the zoom the renderer was already drawing at', () => {
    expect(heightForTextScale(300, 125)).toBe(375)
    expect(heightForTextScale(300, 75)).toBe(225)
  })

  it('rounds up, because a window half a pixel short still clips', () => {
    expect(heightForTextScale(301, 125)).toBe(377)
  })
})
