import { describe, expect, it } from 'vitest'
import { openSettingsSchema } from '../../src/shared/ipc/contract.ts'
import { CHANNELS, CHANNEL_CALLERS, PUSH_CHANNELS } from '../../src/shared/ipc/channels.ts'
import { SETTINGS_TABS, isSettingsTab } from '../../src/shared/types/settings.ts'
import { resolveRendererUrl } from '../../src/main/windows/appProtocol.ts'

/**
 * The tab arrives from a renderer, so it is untrusted input like every other
 * payload: these are the cases that would otherwise let an unknown string
 * reach the window that acts on it.
 */
describe('openSettingsSchema', () => {
  it('accepts every tab the settings window actually has', () => {
    for (const tab of SETTINGS_TABS) {
      expect(openSettingsSchema.safeParse({ tab }).success).toBe(true)
    }
  })

  it('accepts no tab at all, so existing callers keep working', () => {
    expect(openSettingsSchema.safeParse({}).success).toBe(true)
  })

  it('rejects a tab the settings window does not have', () => {
    expect(openSettingsSchema.safeParse({ tab: 'tokens' }).success).toBe(false)
  })

  it('rejects anything alongside the tab', () => {
    expect(openSettingsSchema.safeParse({ tab: 'accounts', extra: 1 }).success).toBe(false)
  })
})

describe('isSettingsTab', () => {
  it('accepts every real tab', () => {
    for (const tab of SETTINGS_TABS) {
      expect(isSettingsTab(tab)).toBe(true)
    }
  })

  it('refuses a missing or unknown tab, so a hand-edited URL cannot pick one', () => {
    expect(isSettingsTab(null)).toBe(false)
    expect(isSettingsTab('tokens')).toBe(false)
    expect(isSettingsTab('')).toBe(false)
  })
})

describe('resolveRendererUrl', () => {
  // A new window is told its tab through the URL rather than the channel,
  // because a push before the renderer mounts is dropped.
  it('carries the tab on the production scheme', () => {
    const url = resolveRendererUrl('settings', null, new URLSearchParams({ tab: 'preferences' }))

    expect(url).toBe('app://settings/index.html?tab=preferences')
  })

  it('carries the tab on the dev server', () => {
    const url = resolveRendererUrl(
      'settings',
      'http://localhost:5174',
      new URLSearchParams({ tab: 'accounts' }),
    )

    expect(url).toBe('http://localhost:5174/settings/index.html?tab=accounts')
  })

  it('is unchanged when no tab is asked for', () => {
    expect(resolveRendererUrl('settings', null)).toBe('app://settings/index.html')
    expect(resolveRendererUrl('widget', 'http://localhost:5174')).toBe(
      'http://localhost:5174/widget/index.html',
    )
  })
})

describe('the settings:showTab channel', () => {
  it('is a push channel, so it has no inbound payload to validate', () => {
    expect(PUSH_CHANNELS).toContain(CHANNELS.settingsShowTab)
  })

  it('is readable only by the settings window', () => {
    expect(CHANNEL_CALLERS[CHANNELS.settingsShowTab]).toEqual(['settings'])
  })
})
