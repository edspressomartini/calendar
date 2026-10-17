import { useEffect, useState, type JSX } from 'react'
import { meetingAlertSchema, type MeetingAlert } from '../../shared/ipc/contract.ts'
import { formatClockTime, formatDuration } from '../common/lib/formatTime.ts'
import { alertApi } from '../common/lib/ipcClient.ts'

/**
 * The centre-screen alert (docs/spec.md §6). Deliberately plain: one meeting,
 * one decision — join it, or say you are already in it.
 */
export function AlertApp(): JSX.Element | null {
  const [alert, setAlert] = useState<MeetingAlert | null>(null)

  useEffect(() => {
    return alertApi().onAlert((incoming) => {
      const parsed = meetingAlertSchema.safeParse(incoming)
      if (parsed.success) {
        setAlert(parsed.data)
      }
    })
  }, [])

  if (!alert) {
    return null
  }

  return (
    <div className="drag-region flex h-full flex-col justify-between rounded-lg border border-live/50 bg-bg p-4">
      <div className="flex flex-col gap-1">
        <span className="text-small font-semibold tracking-widest text-live uppercase">
          Meeting in progress
        </span>
        <h1 className="truncate text-base font-medium" title={alert.title}>
          {alert.title}
        </h1>
        <span className="tabular font-mono text-body text-text-muted">
          {formatClockTime(alert.start)} – {formatClockTime(alert.end)}
          {alert.minutesRemaining > 0 && ` · ${formatDuration(alert.minutesRemaining)} left`}
        </span>
      </div>

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={() => void alertApi().dismiss()}
          className="no-drag rounded border border-border px-3 py-1 text-xs text-text-muted hover:bg-bg-subtle"
        >
          Already in it
        </button>
        {alert.canJoin && (
          <button
            type="button"
            onClick={() => void alertApi().join(alert.eventId)}
            className="no-drag rounded bg-live px-3 py-1 text-xs font-medium text-white hover:opacity-90"
          >
            Join now
          </button>
        )}
      </div>
    </div>
  )
}
