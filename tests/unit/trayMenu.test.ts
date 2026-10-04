import { beforeEach, describe, expect, it } from 'vitest'
import { builtMenus, resetElectronMock, type FakeMenuItem } from '../mocks/electron.ts'
import { TrayController, type TrayActions } from '../../src/main/tray/TrayController.ts'
import { DEFAULT_SETTINGS } from '../../src/main/storage/schema.ts'
import type { AppLogger } from '../../src/main/infra/logger.ts'
import type { SettingsReader } from '../../src/main/storage/SettingsStore.ts'

const silentLogger: AppLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => silentLogger,
}

const settings: SettingsReader = { getSettings: () => DEFAULT_SETTINGS }

const noopActions: TrayActions = {
  toggleWidget: () => {},
  openQuickAdd: () => {},
  openSettings: () => {},
  syncNow: () => {},
  setPrivacyMode: () => {},
  moveToDisplay: () => {},
  reconnect: () => {},
  quit: () => {},
}

function labelsOf(menu: FakeMenuItem[]): string[] {
  return menu.map((entry) => entry.label ?? `<${entry.type ?? 'item'}>`)
}

function startTray(version: string): FakeMenuItem[] {
  const tray = new TrayController(settings, noopActions, version, silentLogger)
  tray.start()
  const menu = builtMenus.at(-1)
  if (!menu) {
    throw new Error('the tray built no menu')
  }
  return menu
}

/**
 * There is no Dock icon and so no About box: this menu is the only place a
 * user can see what they are running (docs/spec.md §6).
 */
describe('the tray menu version line', () => {
  beforeEach(() => {
    resetElectronMock()
  })

  it('shows the version it was given', () => {
    const menu = startTray('1.2.3')
    expect(labelsOf(menu)).toContain('Version 1.2.3')
  })

  it('is not clickable, because it is information rather than an action', () => {
    const entry = startTray('1.2.3').find((item) => item.label === 'Version 1.2.3')
    expect(entry?.enabled).toBe(false)
    expect(entry?.click).toBeUndefined()
  })

  it('sits directly above Quit, out of the way of the actions', () => {
    const labels = labelsOf(startTray('1.2.3'))
    expect(labels.at(-2)).toBe('Version 1.2.3')
    expect(labels.at(-1)).toBe('Quit Up Next')
  })
})
