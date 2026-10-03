import { useEffect, useRef, useState, type JSX, type KeyboardEvent } from 'react'
import {
  MAX_NOTIFICATION_LEAD_MINUTES,
  MAX_SYNC_INTERVAL_MINUTES,
  MAX_WIDGET_TEXT_SCALE,
  MIN_SYNC_INTERVAL_MINUTES,
  MIN_WIDGET_TEXT_SCALE,
  WIDGET_TEXT_SCALE_STEP,
} from '../../../shared/constants.ts'
import { acceleratorFromChord, formatAccelerator } from '../../../shared/shortcuts.ts'
import { supportedTimeZones } from '../../../shared/timezone.ts'
import type { ThemeSource, TodoPlacement, ViewMode } from '../../../shared/types/settings.ts'
import type { SettingsState } from '../../common/hooks/useSettings.ts'
import { settingsApi } from '../../common/lib/ipcClient.ts'

interface PreferencesViewProps {
  readonly state: SettingsState
}

/** Read once: the runtime's full IANA list is long and never changes. */
const TIME_ZONES = supportedTimeZones()

export function PreferencesView({ state }: PreferencesViewProps): JSX.Element {
  const settings = state.settings
  if (!settings) {
    return <p className="text-sm text-text-muted">Loading…</p>
  }

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-base font-medium">Preferences</h2>
      {state.error && <p className="text-xs text-urgent">{state.error}</p>}

      <Row label="View">
        <select
          value={settings.viewMode}
          onChange={(event) => {
            void state.update({ viewMode: event.target.value as ViewMode })
          }}
          className="rounded border border-border bg-bg px-2 py-1 text-sm"
        >
          <option value="merged">Merged</option>
          <option value="split">Split by account</option>
        </select>
      </Row>

      <Row
        label="Widget text size"
        hint="Scales the whole widget. Drag the widget's edge afterwards if you want the extra room back."
      >
        <TextScaleSlider
          value={settings.widgetTextScale}
          onChange={(percent) => void state.update({ widgetTextScale: percent })}
        />
      </Row>

      <Row label="TODO list" hint="Where the list sits relative to the timeline.">
        <select
          value={settings.todoPlacement}
          onChange={(event) => {
            void state.update({ todoPlacement: event.target.value as TodoPlacement })
          }}
          className="rounded border border-border bg-bg px-2 py-1 text-sm"
        >
          <option value="below">Below the calendar</option>
          <option value="above">Above the calendar</option>
        </select>
      </Row>

      <Row
        label="Add TODO shortcut"
        hint="Works anywhere, in any app. Needs Command, Control or Option."
      >
        <ShortcutRecorder
          value={settings.quickAddShortcut}
          onRecord={async (accelerator) => {
            const applied = await state.update({ quickAddShortcut: accelerator })
            return applied === null || applied.quickAddShortcut === accelerator
          }}
        />
      </Row>

      <Row label="Theme">
        <select
          value={settings.theme}
          onChange={(event) => {
            void state.update({ theme: event.target.value as ThemeSource })
          }}
          className="rounded border border-border bg-bg px-2 py-1 text-sm"
        >
          <option value="system">Follow macOS</option>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </select>
      </Row>

      <Row label="Refresh every" hint="A shorter interval catches meetings added at short notice.">
        <input
          type="number"
          min={MIN_SYNC_INTERVAL_MINUTES}
          max={MAX_SYNC_INTERVAL_MINUTES}
          value={settings.syncIntervalMinutes}
          onChange={(event) => {
            void state.update({ syncIntervalMinutes: Number(event.target.value) })
          }}
          className="w-20 rounded border border-border bg-bg px-2 py-1 text-sm"
        />
      </Row>

      <Row
        label="Day starts at"
        hint="The timeline widens automatically for anything outside these hours."
      >
        <HourSelect
          value={settings.dayStartHour}
          max={23}
          onChange={(hour) => void state.update({ dayStartHour: hour })}
        />
      </Row>

      <Row label="Day ends at">
        <HourSelect
          value={settings.dayEndHour}
          min={1}
          max={24}
          onChange={(hour) => void state.update({ dayEndHour: hour })}
        />
      </Row>

      <Row
        label="Second time zone"
        hint="Adds a second column of times to the widget, for calendars that run in another zone."
      >
        <select
          value={settings.secondaryTimeZone ?? 'none'}
          onChange={(event) => {
            const value = event.target.value
            void state.update({ secondaryTimeZone: value === 'none' ? null : value })
          }}
          className="w-56 rounded border border-border bg-bg px-2 py-1 text-sm"
        >
          <option value="none">None</option>
          {TIME_ZONES.map((zone) => (
            <option key={zone} value={zone}>
              {zone.replace(/_/g, ' ')}
            </option>
          ))}
        </select>
      </Row>

      <Row label="Notify before" hint="Set to off to stop meeting notifications.">
        <select
          value={settings.notificationLeadMinutes ?? 'off'}
          onChange={(event) => {
            const value = event.target.value
            void state.update({
              notificationLeadMinutes: value === 'off' ? null : Number(value),
            })
          }}
          className="rounded border border-border bg-bg px-2 py-1 text-sm"
        >
          <option value="off">Off</option>
          {Array.from({ length: MAX_NOTIFICATION_LEAD_MINUTES + 1 }, (_unused, minutes) => (
            <option key={minutes} value={minutes}>
              {minutes === 0 ? 'At start' : `${minutes} min`}
            </option>
          ))}
        </select>
      </Row>

      <Toggle
        label="Privacy mode"
        hint="Replaces meeting titles with “Busy” everywhere. Turn this on before screen sharing."
        checked={settings.privacyMode}
        onChange={(checked) => void state.update({ privacyMode: checked })}
      />

      <Toggle
        label="Hide titles in the menu bar"
        hint="Shows only the countdown next to the menu-bar icon."
        checked={settings.hideTitlesInMenuBar}
        onChange={(checked) => void state.update({ hideTitlesInMenuBar: checked })}
      />

      <Toggle
        label="Float on top"
        checked={settings.alwaysOnTop}
        onChange={(checked) => void state.update({ alwaysOnTop: checked })}
      />

      <Toggle
        label="Hide from screen sharing"
        hint="Keeps the widget out of recordings and shared screens. Turn it off to show it on a call. Some capture tools ignore this, so use privacy mode if the day must not be read."
        checked={settings.hideFromScreenShare}
        onChange={(checked) => void state.update({ hideFromScreenShare: checked })}
      />

      <Toggle
        label="Launch at login"
        checked={settings.launchAtLogin}
        onChange={(checked) => void state.update({ launchAtLogin: checked })}
      />

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => void settingsApi().syncNow()}
          className="rounded border border-border px-3 py-1 text-xs text-accent hover:bg-accent/10"
        >
          Sync now
        </button>
        <button
          type="button"
          onClick={() => void settingsApi().testAlert()}
          className="rounded border border-border px-3 py-1 text-xs text-accent hover:bg-accent/10"
        >
          Show a test alert
        </button>
      </div>
    </section>
  )
}

interface ShortcutRecorderProps {
  readonly value: string
  /** Resolves false when macOS refused the combination to another app. */
  readonly onRecord: (accelerator: string) => Promise<boolean>
}

/**
 * Captures a real keypress rather than offering a list, because the whole
 * point is to dodge whatever else the user has bound, and only they know.
 */
function ShortcutRecorder({ value, onRecord }: ShortcutRecorderProps): JSX.Element {
  const [listening, setListening] = useState(false)
  const [refused, setRefused] = useState<string | null>(null)

  const capture = (event: KeyboardEvent<HTMLButtonElement>): void => {
    event.preventDefault()
    if (event.code === 'Escape') {
      setListening(false)
      return
    }

    const accelerator = acceleratorFromChord(event)
    if (accelerator === null) {
      // Modifiers on their own, or a combination we will not claim globally.
      return
    }

    setListening(false)
    void onRecord(accelerator).then((accepted) => {
      setRefused(accepted ? null : accelerator)
    })
  }

  return (
    <span className="flex flex-col gap-1">
      <button
        type="button"
        onClick={() => {
          setListening(true)
          setRefused(null)
        }}
        onBlur={() => {
          setListening(false)
        }}
        onKeyDown={capture}
        className="w-40 rounded border border-border bg-bg px-2 py-1 font-mono text-sm"
      >
        {listening ? 'Press keys…' : formatAccelerator(value)}
      </button>
      {refused && (
        <span className="text-xs text-urgent">
          {formatAccelerator(refused)} is already taken by another app. Kept{' '}
          {formatAccelerator(value)}.
        </span>
      )}
    </span>
  )
}

interface TextScaleSliderProps {
  readonly value: number
  readonly onChange: (percent: number) => void
}

/** Every step of a drag would otherwise be a settings write and a disk flush. */
const SCALE_COMMIT_DELAY_MS = 150

function TextScaleSlider({ value, onChange }: TextScaleSliderProps): JSX.Element {
  // The slider follows the pointer immediately; the saved value catches up.
  const [dragged, setDragged] = useState<number | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (timer.current) {
        clearTimeout(timer.current)
      }
    }
  }, [])

  const shown = dragged ?? value

  const drag = (percent: number): void => {
    setDragged(percent)
    if (timer.current) {
      clearTimeout(timer.current)
    }
    timer.current = setTimeout(() => {
      onChange(percent)
    }, SCALE_COMMIT_DELAY_MS)
  }

  return (
    <span className="flex items-center gap-2">
      <input
        type="range"
        min={MIN_WIDGET_TEXT_SCALE}
        max={MAX_WIDGET_TEXT_SCALE}
        step={WIDGET_TEXT_SCALE_STEP}
        value={shown}
        onChange={(event) => {
          drag(Number(event.target.value))
        }}
        className="w-56"
      />
      <span className="tabular w-12 font-mono text-sm">{shown}%</span>
    </span>
  )
}

interface HourSelectProps {
  readonly value: number
  readonly min?: number
  readonly max: number
  readonly onChange: (hour: number) => void
}

function HourSelect({ value, min = 0, max, onChange }: HourSelectProps): JSX.Element {
  const hours = Array.from({ length: max - min + 1 }, (_unused, index) => min + index)

  return (
    <select
      value={value}
      onChange={(event) => {
        onChange(Number(event.target.value))
      }}
      className="w-24 rounded border border-border bg-bg px-2 py-1 text-sm"
    >
      {hours.map((hour) => (
        <option key={hour} value={hour}>
          {`${String(hour).padStart(2, '0')}:00`}
        </option>
      ))}
    </select>
  )
}

interface RowProps {
  readonly label: string
  readonly hint?: string
  readonly children: JSX.Element
}

function Row({ label, hint, children }: RowProps): JSX.Element {
  return (
    <label className="flex items-start gap-3">
      <span className="w-40 shrink-0 pt-1 text-sm">{label}</span>
      <span className="flex flex-col gap-1">
        {children}
        {hint && <span className="text-xs text-text-muted">{hint}</span>}
      </span>
    </label>
  )
}

interface ToggleProps {
  readonly label: string
  readonly hint?: string
  readonly checked: boolean
  readonly onChange: (checked: boolean) => void
}

function Toggle({ label, hint, checked, onChange }: ToggleProps): JSX.Element {
  return (
    <label className="flex items-start gap-3">
      <span className="w-40 shrink-0 text-sm">{label}</span>
      <span className="flex flex-col gap-1">
        <input
          type="checkbox"
          checked={checked}
          onChange={(event) => {
            onChange(event.target.checked)
          }}
        />
        {hint && <span className="text-xs text-text-muted">{hint}</span>}
      </span>
    </label>
  )
}
