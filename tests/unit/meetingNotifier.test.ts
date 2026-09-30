import { beforeEach, describe, expect, it } from 'vitest'
import { MeetingNotifier } from '../../src/main/notifications/MeetingNotifier.ts'
import { DEFAULT_SETTINGS } from '../../src/main/storage/schema.ts'
import type { SettingsReader } from '../../src/main/storage/SettingsStore.ts'
import type { MeetingJoiner } from '../../src/main/calendar/MeetingJoiner.ts'
import type { AppLogger } from '../../src/main/infra/logger.ts'
import type { AgendaItem, AgendaSnapshot } from '../../src/shared/types/agenda.ts'
import type { MeetingAlert } from '../../src/shared/ipc/contract.ts'
import type { AppSettings } from '../../src/shared/types/settings.ts'
import { Notification, resetElectronMock } from '../mocks/electron.ts'

/** Two moments, each announced once per event instance (docs/spec.md §6). */

const silentLogger: AppLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => silentLogger,
}

let joined: string[] = []
let widgetShown = 0
const alertsShown: MeetingAlert[] = []

const joiner = {
  join: (eventId: string) => {
    joined.push(eventId)
    return Promise.resolve(true)
  },
} as unknown as MeetingJoiner

function settingsWith(overrides: Partial<AppSettings> = {}): SettingsReader {
  const settings: AppSettings = { ...DEFAULT_SETTINGS, ...overrides }
  return { getSettings: () => settings }
}

function item(overrides: Partial<AgendaItem> = {}): AgendaItem {
  return {
    id: 'evt',
    accountId: 'work',
    colour: 'sky',
    title: 'Design review',
    start: '2026-09-25T10:00:00.000Z',
    end: '2026-09-25T10:30:00.000Z',
    isAllDay: false,
    status: 'upcoming',
    startsInMinutes: 1,
    minutesRemaining: 31,
    canJoin: true,
    ...overrides,
  }
}

function snapshot(items: AgendaItem[], privacyMode = false): AgendaSnapshot {
  return {
    now: '2026-09-25T09:59:00.000Z',
    window: { start: '2026-09-25T06:00:00.000Z', end: '2026-09-25T21:00:00.000Z' },
    secondaryTimeZone: null,
    timed: items,
    allDay: [],
    accounts: [],
    nextUp: items[0] ?? null,
    viewMode: 'merged',
    todoPlacement: 'below',
    privacyMode,
  }
}

function createNotifier(settings: SettingsReader = settingsWith()): MeetingNotifier {
  return new MeetingNotifier(
    settings,
    joiner,
    () => {
      widgetShown += 1
    },
    (alert) => {
      alertsShown.push(alert)
    },
    silentLogger,
  )
}

beforeEach(() => {
  resetElectronMock()
  joined = []
  widgetShown = 0
  alertsShown.length = 0
})

describe('warning before a meeting', () => {
  it('fires once inside the lead time', () => {
    const notifier = createNotifier()
    notifier.handleSnapshot(snapshot([item({ startsInMinutes: 1 })]))

    expect(Notification.shown).toHaveLength(1)
    expect(Notification.shown[0]?.options.body).toBe('Starts in 1 min')
  })

  it('does not repeat on the next snapshot', () => {
    const notifier = createNotifier()
    notifier.handleSnapshot(snapshot([item({ startsInMinutes: 1 })]))
    notifier.handleSnapshot(snapshot([item({ startsInMinutes: 1 })]))

    expect(Notification.shown).toHaveLength(1)
  })

  it('stays quiet while the meeting is still far off', () => {
    const notifier = createNotifier()
    notifier.handleSnapshot(snapshot([item({ startsInMinutes: 10 })]))

    expect(Notification.shown).toHaveLength(0)
  })
})

describe('announcing the start', () => {
  const live = item({ status: 'live', startsInMinutes: 0, minutesRemaining: 30 })

  it('prompts to join the moment it begins', () => {
    const notifier = createNotifier()
    notifier.handleSnapshot(snapshot([live]))

    expect(Notification.shown).toHaveLength(1)
    expect(Notification.shown[0]?.options.body).toBe('Meeting in progress — join now')
  })

  it('offers a Join button and a way to say you are already in it', () => {
    const notifier = createNotifier()
    notifier.handleSnapshot(snapshot([live]))

    const shown = Notification.shown[0]
    expect(shown?.options.actions?.[0]?.text).toBe('Join')
    expect(shown?.options.closeButtonText).toBe('Already in it')
  })

  it('joins when the button is pressed', () => {
    const notifier = createNotifier()
    notifier.handleSnapshot(snapshot([live]))
    Notification.shown[0]?.emit('action')

    expect(joined).toEqual(['evt'])
  })

  it('drops the Join button when there is no link', () => {
    const notifier = createNotifier()
    notifier.handleSnapshot(snapshot([{ ...live, canJoin: false }]))

    expect(Notification.shown[0]?.options.actions).toHaveLength(0)
    expect(Notification.shown[0]?.options.body).toBe('Meeting in progress')
  })

  it('shows the widget when a linkless notification is clicked', () => {
    const notifier = createNotifier()
    notifier.handleSnapshot(snapshot([{ ...live, canJoin: false }]))
    Notification.shown[0]?.emit('click')

    expect(widgetShown).toBe(1)
    expect(joined).toHaveLength(0)
  })

  it('fires only once as the meeting runs on', () => {
    const notifier = createNotifier()
    notifier.handleSnapshot(snapshot([live]))
    notifier.handleSnapshot(snapshot([{ ...live, startsInMinutes: -1 }]))
    notifier.handleSnapshot(snapshot([{ ...live, startsInMinutes: -2 }]))

    expect(Notification.shown).toHaveLength(1)
  })

  it('also raises the centre-screen alert, which cannot be dropped by macOS', () => {
    const notifier = createNotifier()
    notifier.handleSnapshot(snapshot([live]))

    expect(alertsShown).toHaveLength(1)
    expect(alertsShown[0]).toMatchObject({ eventId: 'evt', title: 'Design review', canJoin: true })
  })

  it('raises the alert only once per meeting', () => {
    const notifier = createNotifier()
    notifier.handleSnapshot(snapshot([live]))
    notifier.handleSnapshot(snapshot([{ ...live, startsInMinutes: -1 }]))

    expect(alertsShown).toHaveLength(1)
  })

  it('does not raise an alert for a warning', () => {
    const notifier = createNotifier()
    notifier.handleSnapshot(snapshot([item({ startsInMinutes: 1 })]))

    expect(alertsShown).toHaveLength(0)
  })

  it('stays silent for a meeting that began long ago', () => {
    const notifier = createNotifier()
    notifier.handleSnapshot(snapshot([{ ...live, startsInMinutes: -40 }]))

    expect(Notification.shown).toHaveLength(0)
  })

  it('does not also fire the warning for the same meeting', () => {
    const notifier = createNotifier()
    notifier.handleSnapshot(snapshot([item({ startsInMinutes: 1 })]))
    notifier.handleSnapshot(snapshot([{ ...live }]))

    // One warning, one start prompt, and no repeats.
    expect(Notification.shown).toHaveLength(2)
    expect(Notification.shown.map((entry) => entry.options.body)).toEqual([
      'Starts in 1 min',
      'Meeting in progress — join now',
    ])
  })

  it('does not warn twice when the lead time is zero', () => {
    const notifier = createNotifier(settingsWith({ notificationLeadMinutes: 0 }))
    notifier.handleSnapshot(snapshot([item({ startsInMinutes: 0 })]))
    notifier.handleSnapshot(snapshot([live]))

    expect(Notification.shown).toHaveLength(1)
  })
})

describe('when notifications are off or unsupported', () => {
  it('says nothing at all', () => {
    const notifier = createNotifier(settingsWith({ notificationLeadMinutes: null }))
    notifier.handleSnapshot(snapshot([item({ status: 'live', startsInMinutes: 0 })]))

    expect(Notification.shown).toHaveLength(0)
  })

  it('stays quiet when the platform cannot show notifications', () => {
    Notification.supported = false
    const notifier = createNotifier()
    notifier.handleSnapshot(snapshot([item({ startsInMinutes: 1 })]))

    expect(Notification.shown).toHaveLength(0)
  })
})

describe('privacy mode', () => {
  it('never puts the meeting title in a notification', () => {
    const notifier = createNotifier()
    notifier.handleSnapshot(
      snapshot([item({ startsInMinutes: 1, title: 'Board pay review' })], true),
    )

    const shown = Notification.shown[0]
    expect(shown?.options.title).toBe('Busy')
    expect(JSON.stringify(shown?.options)).not.toContain('Board pay review')
  })

  it('never puts the meeting title in the centre-screen alert either', () => {
    const notifier = createNotifier()
    notifier.handleSnapshot(
      snapshot([item({ status: 'live', startsInMinutes: 0, title: 'Board pay review' })], true),
    )

    expect(alertsShown[0]?.title).toBe('Busy')
    expect(JSON.stringify(alertsShown)).not.toContain('Board pay review')
  })
})
