import { describe, expect, it } from 'vitest'
import { emptyPromptFor } from '../../src/renderer/widget/emptyPrompt.ts'
import type { AgendaAccount } from '../../src/shared/types/agenda.ts'
import type { AccountStatus } from '../../src/shared/types/account.ts'

function account(id: string, status: AccountStatus): AgendaAccount {
  return { id, label: id, colour: 'sky', status, lastSyncedAt: null }
}

describe('emptyPromptFor', () => {
  it('asks for a connection when there is nothing connected', () => {
    const prompt = emptyPromptFor([])

    expect(prompt?.tab).toBe('accounts')
    expect(prompt?.actionLabel).toBe('Connect a calendar')
  })

  it('asks for a reconnect when every account is dead', () => {
    const prompt = emptyPromptFor([account('a', 'needsReauth'), account('b', 'needsReauth')])

    expect(prompt?.tab).toBe('accounts')
    expect(prompt?.actionLabel).toBe('Reconnect')
  })

  // One live account still has a day to draw, and the per-account status dot
  // already says the other one is broken.
  it('says nothing when at least one account still works', () => {
    expect(emptyPromptFor([account('a', 'needsReauth'), account('b', 'ready')])).toBeNull()
  })

  it('says nothing when everything is healthy', () => {
    expect(emptyPromptFor([account('a', 'ready')])).toBeNull()
  })

  it('treats a merely offline account as working, because it will come back', () => {
    expect(emptyPromptFor([account('a', 'offline')])).toBeNull()
  })
})
