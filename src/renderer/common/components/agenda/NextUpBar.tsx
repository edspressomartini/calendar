import type { JSX } from 'react'
import type { AgendaItem } from '../../../../shared/types/agenda.ts'
import { COLOUR_DOT } from '../../lib/accountColours.ts'
import { formatDuration } from '../../lib/formatTime.ts'

interface NextUpBarProps {
  readonly nextUp: AgendaItem | null
  readonly onJoin: (eventId: string) => void
}

/**
 * The countdown in words (docs/spec.md §6).
 *
 * The timeline shows roughly a quarter of an hour per ten pixels, so "two
 * minutes before" and "just started" are visually identical. The distinction
 * matters, so it is stated rather than drawn.
 */
export function NextUpBar({ nextUp, onJoin }: NextUpBarProps): JSX.Element | null {
  if (!nextUp) {
    return null
  }

  const live = nextUp.status === 'live'
  const timing = live
    ? `${formatDuration(nextUp.minutesRemaining)} left`
    : nextUp.startsInMinutes <= 0
      ? 'starting now'
      : `in ${formatDuration(nextUp.startsInMinutes)}`

  const tone = live ? 'text-live' : nextUp.status === 'imminent' ? 'text-urgent' : 'text-text-muted'

  return (
    <div
      className={`card mx-3 mb-2 flex items-center gap-2 px-3 py-1.5 ${
        live ? 'border-live/40 bg-live/10' : ''
      }`}
    >
      {live ? (
        // A coloured dot is too subtle for the one state you must not miss.
        <span className="shrink-0 rounded-sm bg-live px-1 py-px text-[9px] font-semibold tracking-wide text-white uppercase">
          Now
        </span>
      ) : (
        <span className={`size-1.5 shrink-0 rounded-full ${COLOUR_DOT[nextUp.colour]}`} />
      )}
      <span className="min-w-0 flex-1 truncate text-[11px] font-medium" title={nextUp.title}>
        {nextUp.title}
      </span>
      <span className={`tabular shrink-0 font-mono text-[11px] ${tone}`}>{timing}</span>
      {nextUp.canJoin && (
        <button
          type="button"
          onClick={() => {
            onJoin(nextUp.id)
          }}
          className="no-drag shrink-0 rounded border border-border px-1.5 text-[10px] text-accent hover:bg-accent/10"
        >
          Join
        </button>
      )}
    </div>
  )
}
