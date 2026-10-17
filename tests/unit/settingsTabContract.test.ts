import { describe, expect, it } from 'vitest'
import { openSettingsSchema } from '../../src/shared/ipc/contract.ts'
import { CHANNELS, CHANNEL_CALLERS, PUSH_CHANNELS } from '../../src/shared/ipc/channels.ts'
import { SETTINGS_TABS } from '../../src/shared/types/settings.ts'

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

describe('the settings:showTab channel', () => {
  it('is a push channel, so it has no inbound payload to validate', () => {
    expect(PUSH_CHANNELS).toContain(CHANNELS.settingsShowTab)
  })

  it('is readable only by the settings window', () => {
    expect(CHANNEL_CALLERS[CHANNELS.settingsShowTab]).toEqual(['settings'])
  })
})
