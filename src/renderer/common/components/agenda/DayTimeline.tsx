import { useEffect, useRef, type JSX, type RefObject } from 'react'
import type { AgendaItem } from '../../../../shared/types/agenda.ts'
import type { AccountColour } from '../../../../shared/types/account.ts'
import {
  assignLanes,
  blockFor,
  buildTicks,
  ratioFor,
  scrollTopToRevealNow,
  type DayWindow,
} from '../../../../shared/timeline.ts'
import { localTimeZone, timeZoneLabel } from '../../../../shared/timezone.ts'
import { COLOUR_BAR, COLOUR_HEADER } from '../../lib/accountColours.ts'
import { formatClockTime } from '../../lib/formatTime.ts'
import { EmptyState } from './EmptyState.tsx'

/**
 * The day drawn to scale (docs/spec.md §6).
 *
 * Half-hour gridlines down the left and a "now" line positioned by time give
 * the thing a list cannot: where you are in the day, and how much room is
 * left before the next thing.
 */

/** Enough height for a half-hour row to stay legible. */
const MINUTES_PER_PIXEL = 0.75
const MIN_BLOCK_HEIGHT_PX = 18
const GUTTER_COLUMN_WIDTH_PX = 38

export interface TimelineLane {
  readonly key: string
  readonly label?: string
  readonly colour?: AccountColour
  readonly items: readonly AgendaItem[]
}

interface DayTimelineProps {
  readonly window: DayWindow
  readonly nowIso: string
  readonly lanes: readonly TimelineLane[]
  /** Shown as a second column of times beside local time (§6). */
  readonly secondaryTimeZone: string | null
  readonly onJoin: (eventId: string) => void
}

export function DayTimeline({
  window,
  nowIso,
  lanes,
  secondaryTimeZone,
  onJoin,
}: DayTimelineProps): JSX.Element {
  const spanMinutes = (window.endMs - window.startMs) / 60_000
  const heightPx = Math.max(240, Math.round(spanMinutes / MINUTES_PER_PIXEL))
  const ticks = buildTicks(window)
  const nowRatio = ratioFor(Date.parse(nowIso), window)

  const hasAnyEvent = lanes.some((lane) => lane.items.length > 0)
  const zones: readonly (string | undefined)[] = secondaryTimeZone
    ? [undefined, secondaryTimeZone]
    : [undefined]
  const gutterWidthPx = zones.length * GUTTER_COLUMN_WIDTH_PX

  const scroller = useRef<HTMLDivElement>(null)
  useKeepNowInView(scroller, nowRatio * heightPx)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {secondaryTimeZone && (
        <ZoneHeader
          secondaryTimeZone={secondaryTimeZone}
          nowIso={nowIso}
          gutterWidthPx={gutterWidthPx}
        />
      )}

      <div ref={scroller} className="scrollbar-hidden flex-1 overflow-y-auto">
        <div className="relative flex" style={{ height: `${heightPx}px` }}>
          <TimeGutter ticks={ticks} window={window} zones={zones} widthPx={gutterWidthPx} />

          <div className="relative flex-1">
            <GridLines ticks={ticks} window={window} />

            <div className="absolute inset-0 flex">
              {lanes.map((lane) => (
                <LaneColumn key={lane.key} lane={lane} window={window} onJoin={onJoin} />
              ))}
            </div>

            <NowLine ratio={nowRatio} label={formatClockTime(nowIso)} />

            {!hasAnyEvent && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <EmptyState message="Nothing scheduled today" />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * Keeps the "now" line on screen however short the timeline gets (§6).
 *
 * Dragging the widget shorter is the case this exists for: the window keeps
 * its scroll offset, so the visible slice stays where it was and the current
 * time quietly leaves through the bottom. A ResizeObserver rather than the
 * window's resize event, because the timeline also changes height when the
 * TODO list grows or the all-day strip appears, neither of which resizes
 * anything.
 *
 * It corrects only when now has actually left the comfortable band, so
 * scrolling down to read the rest of the afternoon is not undone a second
 * later by the clock ticking.
 */
function useKeepNowInView(ref: RefObject<HTMLDivElement | null>, nowTopPx: number): void {
  useEffect(() => {
    const element = ref.current
    if (!element) {
      return
    }

    const reveal = (): void => {
      const target = scrollTopToRevealNow(
        nowTopPx,
        element.clientHeight,
        element.scrollHeight,
        element.scrollTop,
      )
      if (target === null) {
        return
      }
      element.scrollTop = target
    }

    reveal()

    const observer = new ResizeObserver(reveal)
    observer.observe(element)
    return () => {
      observer.disconnect()
    }
  }, [ref, nowTopPx])
}

/** Names the gutter columns, so two times are never ambiguous. */
function ZoneHeader({
  secondaryTimeZone,
  nowIso,
  gutterWidthPx,
}: {
  secondaryTimeZone: string
  nowIso: string
  gutterWidthPx: number
}): JSX.Element {
  const at = new Date(Date.parse(nowIso))

  return (
    <div className="flex border-b border-border pb-0.5 text-micro text-text-muted">
      <div className="flex shrink-0" style={{ width: `${gutterWidthPx}px` }}>
        <span
          className="truncate text-right"
          style={{ width: `${GUTTER_COLUMN_WIDTH_PX}px`, paddingRight: '6px' }}
        >
          {timeZoneLabel(localTimeZone(), at)}
        </span>
        <span
          className="truncate text-right"
          style={{ width: `${GUTTER_COLUMN_WIDTH_PX}px`, paddingRight: '6px' }}
          title={secondaryTimeZone}
        >
          {timeZoneLabel(secondaryTimeZone, at)}
        </span>
      </div>
    </div>
  )
}

function TimeGutter({
  ticks,
  window,
  zones,
  widthPx,
}: {
  ticks: readonly { ms: number; major: boolean }[]
  window: DayWindow
  zones: readonly (string | undefined)[]
  widthPx: number
}): JSX.Element {
  return (
    <div className="relative flex shrink-0" style={{ width: `${widthPx}px` }}>
      {zones.map((zone, index) => (
        <div
          key={zone ?? 'local'}
          className="relative"
          style={{ width: `${GUTTER_COLUMN_WIDTH_PX}px` }}
        >
          {ticks.map((tick) => (
            <span
              key={tick.ms}
              // The hour is the unit people read the day in, so it is the one
              // that looks like a label. Half hours are deliberately demoted
              // rather than dropped: without them a half-hour row reads as a
              // whole hour and every gap looks twice as long as it is.
              className={`tabular absolute right-1.5 -translate-y-1/2 font-mono ${
                tick.major
                  ? 'text-small font-semibold text-text'
                  : 'text-micro font-normal text-text-muted/45'
              } ${index > 0 ? 'opacity-70' : ''}`}
              style={{ top: `${ratioFor(tick.ms, window) * 100}%` }}
            >
              {formatClockTime(new Date(tick.ms).toISOString(), zone)}
            </span>
          ))}
        </div>
      ))}
    </div>
  )
}

function GridLines({
  ticks,
  window,
}: {
  ticks: readonly { ms: number; major: boolean }[]
  window: DayWindow
}): JSX.Element {
  return (
    <div aria-hidden="true" className="absolute inset-0">
      {ticks.map((tick) =>
        tick.major ? (
          <span
            key={tick.ms}
            className="absolute inset-x-0 h-px bg-text-muted/40"
            style={{ top: `${ratioFor(tick.ms, window) * 100}%` }}
          />
        ) : (
          // Dotted, not a fainter solid line. Two solid lines a few shades
          // apart are the same line at a glance, which is what made a
          // half-hour slot read as an hour.
          <span
            key={tick.ms}
            className="absolute inset-x-0 h-px bg-[length:4px_1px] bg-repeat-x"
            style={{
              top: `${ratioFor(tick.ms, window) * 100}%`,
              backgroundImage:
                'linear-gradient(to right, var(--border) 0 2px, transparent 2px 100%)',
            }}
          />
        ),
      )}
    </div>
  )
}

function LaneColumn({
  lane,
  window,
  onJoin,
}: {
  lane: TimelineLane
  window: DayWindow
  onJoin: (eventId: string) => void
}): JSX.Element {
  // Overlapping events sit side by side so a double booking is visible.
  const placed = assignLanes(lane.items)

  return (
    <div className="relative min-w-0 flex-1">
      {lane.label && (
        <div
          className={`absolute inset-x-0 top-0 z-10 truncate px-1 text-small font-medium ${
            lane.colour ? COLOUR_HEADER[lane.colour] : ''
          }`}
        >
          {lane.label}
        </div>
      )}

      {placed.map(({ item, lane: column, laneCount }) => (
        <EventBlock
          key={item.id}
          item={item}
          window={window}
          column={column}
          columnCount={laneCount}
          onJoin={onJoin}
        />
      ))}
    </div>
  )
}

const BLOCK_STATE: Record<AgendaItem['status'], string> = {
  past: 'opacity-45 bg-bg-subtle border-border',
  live: 'bg-live/15 border-live',
  imminent: 'bg-urgent/15 border-urgent',
  upcoming: 'bg-bg-subtle border-border',
}

function EventBlock({
  item,
  window,
  column,
  columnCount,
  onJoin,
}: {
  item: AgendaItem
  window: DayWindow
  column: number
  columnCount: number
  onJoin: (eventId: string) => void
}): JSX.Element {
  const position = blockFor(item, window)
  const widthPercent = 100 / columnCount

  return (
    <div
      className={`absolute overflow-hidden rounded-sm border-l-2 px-1.5 py-0.5 text-body ${BLOCK_STATE[item.status]}`}
      style={{
        top: `${position.top * 100}%`,
        height: `max(${MIN_BLOCK_HEIGHT_PX}px, ${position.height * 100}%)`,
        left: `${column * widthPercent}%`,
        width: `calc(${widthPercent}% - 2px)`,
      }}
      title={`${formatClockTime(item.start)} ${item.title}`}
    >
      <span
        aria-hidden="true"
        className={`absolute inset-y-0 left-0 w-0.5 ${COLOUR_BAR[item.colour]}`}
      />

      <div className="flex items-baseline gap-1">
        <span className="tabular shrink-0 font-mono text-small text-text-muted">
          {formatClockTime(item.start)}
        </span>
        <span className="min-w-0 flex-1 truncate font-medium">{item.title}</span>
        {item.canJoin && (
          <button
            type="button"
            onClick={() => {
              onJoin(item.id)
            }}
            className="no-drag shrink-0 rounded border border-border px-1 text-small text-accent hover:bg-accent/10"
          >
            Join
          </button>
        )}
      </div>
    </div>
  )
}

function NowLine({ ratio, label }: { ratio: number; label: string }): JSX.Element {
  return (
    <div
      aria-hidden="true"
      // Centred on the instant it marks. Positioning by the top edge drew the
      // line about half its own height late, which at this scale is minutes.
      className="pointer-events-none absolute inset-x-0 z-20 flex -translate-y-1/2 items-center"
      style={{ top: `${ratio * 100}%` }}
    >
      <span className="-ml-1 size-1.5 shrink-0 rounded-full bg-urgent" />
      <span className="h-px flex-1 bg-urgent" />
      <span className="tabular ml-1 rounded bg-urgent px-1 font-mono text-micro text-white">
        {label}
      </span>
    </div>
  )
}
