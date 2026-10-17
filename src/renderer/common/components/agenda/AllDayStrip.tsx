import type { JSX } from 'react'
import type { AgendaItem } from '../../../../shared/types/agenda.ts'
import { COLOUR_DOT } from '../../lib/accountColours.ts'

interface AllDayStripProps {
  readonly items: readonly AgendaItem[]
}

/**
 * Context, not urgency: all-day events sit above the timeline and never get a
 * countdown or a notification (docs/spec.md §6).
 */
export function AllDayStrip({ items }: AllDayStripProps): JSX.Element | null {
  if (items.length === 0) {
    return null
  }

  return (
    /*
     * A card like every other section. This was the last full-bleed bar with a
     * divider rule under it, left over from before the redesign, so a row of
     * out-of-office notices read as a seam across the widget rather than as
     * part of it.
     *
     * Capped and scrollable because the length is not the user's to control: a
     * team where six people are away writes six lines, and an away notice must
     * never push the meetings they actually have off the widget.
     */
    <div className="card mx-3 mb-2 max-h-16 shrink-0 overflow-y-auto px-2.5 py-1.5">
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {items.map((item) => (
          <span key={item.id} className="flex min-w-0 items-center gap-1.5 text-xs text-text-muted">
            <span className={`size-1.5 shrink-0 rounded-full ${COLOUR_DOT[item.colour]}`} />
            <span className="truncate">{item.title}</span>
          </span>
        ))}
      </div>
    </div>
  )
}
