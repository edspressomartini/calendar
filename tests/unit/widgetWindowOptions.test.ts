import { describe, expect, it } from 'vitest'
import { buildWidgetWindowOptions } from '../../src/main/windows/widgetWindowOptions.ts'

const INPUT = {
  bounds: { x: 10, y: 20, width: 400, height: 600 },
  showTimeline: true,
  alwaysOnTop: true,
  webPreferences: {},
} as const

describe('buildWidgetWindowOptions', () => {
  it('lets the renderer alpha through instead of asking for a vibrancy material', () => {
    const options = buildWidgetWindowOptions(INPUT)

    expect(options.transparent).toBe(true)
    expect(options.roundedCorners).toBe(true)
    // An opaque background colour defeats the transparency entirely.
    expect(options.backgroundColor).toBeUndefined()
    // under-window only frosts the wallpaper, so it reads as opaque over apps.
    expect(options.vibrancy).toBeUndefined()
  })

  it('keeps the panel behaviour that makes this a widget rather than a window', () => {
    const options = buildWidgetWindowOptions(INPUT)

    expect(options.type).toBe('panel')
    expect(options.frame).toBe(false)
    expect(options.skipTaskbar).toBe(true)
    expect(options.acceptFirstMouse).toBe(true)
    expect(options.show).toBe(false)
    expect(options.fullscreenable).toBe(false)
  })

  it('uses the compact floor when the timeline is hidden', () => {
    const tall = buildWidgetWindowOptions(INPUT)
    const compact = buildWidgetWindowOptions({ ...INPUT, showTimeline: false })

    expect(compact.minHeight).toBeLessThan(tall.minHeight ?? 0)
  })
})
