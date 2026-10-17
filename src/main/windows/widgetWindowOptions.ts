import type { BrowserWindowConstructorOptions, Rectangle, WebPreferences } from 'electron'
import {
  WIDGET_COMPACT_MIN_HEIGHT,
  WIDGET_MIN_HEIGHT,
  WIDGET_MIN_WIDTH,
} from '../../shared/constants.ts'

export interface WidgetWindowOptionsInput {
  readonly bounds: Rectangle
  readonly showTimeline: boolean
  readonly alwaysOnTop: boolean
  readonly webPreferences: WebPreferences
}

/**
 * The panel's constructor options, as a value so they can be asserted on.
 *
 * `transparent` with no `backgroundColor` is what lets the renderer's own
 * alpha reach the window server; setting a background colour here paints over
 * it and the panel is opaque again.
 *
 * macOS vibrancy is deliberately not used. `under-window` composites the
 * desktop wallpaper only, so a widget sitting over another app's window shows
 * a flat material and looks identical to an opaque panel. Plain alpha gives up
 * the blur but actually reveals whatever is behind, wherever the panel sits.
 */
export function buildWidgetWindowOptions(
  input: WidgetWindowOptionsInput,
): BrowserWindowConstructorOptions {
  return {
    ...input.bounds,
    minWidth: WIDGET_MIN_WIDTH,
    minHeight: input.showTimeline ? WIDGET_MIN_HEIGHT : WIDGET_COMPACT_MIN_HEIGHT,
    // NSPanel behaviour: all Spaces, above full-screen apps, non-activating.
    type: 'panel',
    frame: false,
    show: false,
    transparent: true,
    roundedCorners: true,
    skipTaskbar: true,
    fullscreenable: false,
    maximizable: false,
    minimizable: false,
    alwaysOnTop: input.alwaysOnTop,
    // Without this the first click on the inactive panel is swallowed.
    acceptFirstMouse: true,
    webPreferences: input.webPreferences,
  }
}
