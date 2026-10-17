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
    /*
     * The cap is three lines plus the padding, which is a whole team's worth of
     * away notices at a normal widget width. An earlier 80px cut the third line
     * two pixels short and produced a scrollbar to hide them, which looks far
     * worse than the line it was saving.
     */
    <div className="card mx-3 mb-2 max-h-24 shrink-0 overflow-y-auto px-2.5 py-1.5">
      {/*
       * Equal gaps both ways. They used to be 12px across and 4px down, and
       * with five people away that three-to-one ratio read as a block of text
       * that happened to have dots in it: the items spread out sideways while
       * the lines they wrapped onto crowded together.
       *
       * Which means the dot has to bind more tightly to its own name than the
       * names do to each other, or the grouping goes the other way and a dot
       * looks like it belongs to the name on its left.
       */}
      <div className="flex flex-wrap gap-2.5">
        {items.map((item) => (
          <span key={item.id} className="flex min-w-0 items-center gap-1 text-xs text-text-muted">
            <span className={`size-1.5 shrink-0 rounded-full ${COLOUR_DOT[item.colour]}`} />
            <span className="truncate">{item.title}</span>
          </span>
        ))}
      </div>
    </div>
  )
}
