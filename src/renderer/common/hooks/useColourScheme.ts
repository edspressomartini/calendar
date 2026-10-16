import { useEffect } from 'react'
import type { ColourScheme } from '../../../shared/types/settings.ts'

/**
 * Puts the chosen scheme on the root element, where theme.css picks it up
 * (docs/spec.md §6).
 *
 * An attribute rather than a class, and the default is written out rather
 * than left absent: `[data-scheme]` is then a complete list of the states the
 * stylesheet has to describe, and switching back to the default takes the
 * same path as switching to any other.
 *
 * Nothing restores the attribute on unmount. The root element outlives every
 * component in the window, and clearing it would mean a flash of the default
 * palette on any remount.
 */
export function useColourScheme(scheme: ColourScheme | null): void {
  useEffect(() => {
    if (scheme === null) {
      return
    }
    document.documentElement.dataset.scheme = scheme
  }, [scheme])
}
