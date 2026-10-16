import { screen, type Display, type Rectangle } from 'electron'
import { WIDGET_SCREEN_MARGIN } from '../../shared/constants.ts'
import type { DisplayKey, DisplayOption, WidgetPlacement } from '../../shared/types/settings.ts'

/**
 * Which monitor the widget lives on, and how it comes back (docs/spec.md §6, §10).
 *
 * Display ids change across reconnects, so a saved display is matched by label
 * and size first. A saved position on a monitor that is gone must never open
 * the window off-screen.
 */

export interface WidgetSize {
  readonly width: number
  readonly height: number
}

/**
 * The only part of a Display the geometry helpers read. Taking this rather
 * than the whole Display keeps them honest about their dependency, and means
 * they can be exercised without a window or a screen.
 */
export interface DisplayArea {
  readonly workArea: Rectangle
}

export function toDisplayKey(display: Display): DisplayKey {
  return {
    id: display.id,
    label: display.label,
    width: display.size.width,
    height: display.size.height,
  }
}

export function listDisplayOptions(current: DisplayKey | null): DisplayOption[] {
  const primaryId = screen.getPrimaryDisplay().id
  return screen.getAllDisplays().map((display) => ({
    key: toDisplayKey(display),
    isPrimary: display.id === primaryId,
    isCurrent: current !== null && matches(display, current),
  }))
}

/** Label and size first, id second: ids are not stable across reconnects. */
export function findDisplay(key: DisplayKey | null): Display | null {
  if (!key) {
    return null
  }
  const displays = screen.getAllDisplays()
  return (
    displays.find((display) => matches(display, key)) ??
    displays.find((display) => display.id === key.id) ??
    null
  )
}

/** Resolves the bounds to open at, always inside a connected display. */
export function computeBounds(placement: WidgetPlacement, size: WidgetSize): Rectangle {
  const target = findDisplay(placement.display) ?? screen.getPrimaryDisplay()

  if (placement.corner === 'remembered' && placement.bounds) {
    const remembered: Rectangle = {
      x: placement.bounds.x,
      y: placement.bounds.y,
      width: Math.max(placement.bounds.width, size.width),
      height: Math.max(placement.bounds.height, size.height),
    }
    return clampToDisplay(remembered, target)
  }

  return cornerBounds(placement.corner, target, size)
}

export function clampToDisplay(bounds: Rectangle, display: DisplayArea): Rectangle {
  const area = display.workArea
  const width = Math.min(bounds.width, area.width)
  const height = Math.min(bounds.height, area.height)
  const maxX = area.x + area.width - width
  const maxY = area.y + area.height - height

  return {
    width,
    height,
    x: Math.min(Math.max(bounds.x, area.x), maxX),
    y: Math.min(Math.max(bounds.y, area.y), maxY),
  }
}

/** The display a rectangle currently sits on. */
export function displayForBounds(bounds: Rectangle): Display {
  return screen.getDisplayMatching(bounds)
}

/**
 * The bounds for a height the renderer measured (§6).
 *
 * Pure, and separate from the window, because this is the part that can put
 * the widget somewhere the user cannot reach: a measurement is untrusted
 * input like any other, so it is floored, capped to the work area, and run
 * through the same clamp as every other move.
 */
export function boundsForFittedHeight(
  bounds: Rectangle,
  display: DisplayArea,
  requested: number,
  minHeight: number,
): Rectangle {
  const ceiling = Math.max(minHeight, display.workArea.height - WIDGET_SCREEN_MARGIN * 2)
  const height = Math.min(Math.max(requested, minHeight), ceiling)
  return clampToDisplay({ ...bounds, height }, display)
}

function cornerBounds(
  corner: WidgetPlacement['corner'],
  display: Display,
  size: WidgetSize,
): Rectangle {
  const area = display.workArea
  const margin = WIDGET_SCREEN_MARGIN
  const left = area.x + margin
  const top = area.y + margin
  const right = area.x + area.width - size.width - margin
  const bottom = area.y + area.height - size.height - margin

  const positions: Record<string, { x: number; y: number }> = {
    topRight: { x: right, y: top },
    topLeft: { x: left, y: top },
    bottomRight: { x: right, y: bottom },
    bottomLeft: { x: left, y: bottom },
    remembered: { x: right, y: top },
  }

  const position = positions[corner] ?? positions['topRight']!
  return clampToDisplay({ ...position, width: size.width, height: size.height }, display)
}

function matches(display: Display, key: DisplayKey): boolean {
  return (
    display.label === key.label &&
    display.size.width === key.width &&
    display.size.height === key.height
  )
}
