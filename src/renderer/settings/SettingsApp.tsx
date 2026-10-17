import { useEffect, useState, type JSX } from 'react'
import { SETTINGS_TABS, type SettingsTab } from '../../shared/types/settings.ts'
import { settingsApi } from '../common/lib/ipcClient.ts'
import { useAccounts } from '../common/hooks/useAccounts.ts'
import { useColourScheme } from '../common/hooks/useColourScheme.ts'
import { useSettings } from '../common/hooks/useSettings.ts'
import { AccountsView } from './views/AccountsView.tsx'
import { CalendarPickerView } from './views/CalendarPickerView.tsx'
import { DisplayView } from './views/DisplayView.tsx'
import { PreferencesView } from './views/PreferencesView.tsx'

const TAB_LABELS: Readonly<Record<SettingsTab, string>> = {
  accounts: 'Accounts',
  calendars: 'Calendars',
  display: 'Display',
  preferences: 'Preferences',
}

export function SettingsApp(): JSX.Element {
  const [tab, setTab] = useState<SettingsTab>('accounts')

  useEffect(() => {
    return settingsApi().onShowTab(setTab)
  }, [])

  const accounts = useAccounts()
  const settings = useSettings()
  // So the scheme is picked in a window already wearing it.
  useColourScheme(settings.settings?.colourScheme ?? null)

  return (
    <div className="flex h-full flex-col bg-bg">
      <nav className="flex gap-1 border-b border-border px-3 pt-8 pb-2">
        {SETTINGS_TABS.map((entry) => (
          <button
            key={entry}
            type="button"
            onClick={() => {
              setTab(entry)
            }}
            className={`rounded px-3 py-1 text-sm ${
              tab === entry ? 'bg-bg-subtle text-text' : 'text-text-muted hover:bg-bg-subtle'
            }`}
          >
            {TAB_LABELS[entry]}
          </button>
        ))}
      </nav>

      <main className="flex-1 overflow-y-auto px-4 py-4">
        {tab === 'accounts' && <AccountsView state={accounts} />}
        {tab === 'calendars' && <CalendarPickerView state={accounts} />}
        {tab === 'display' && <DisplayView />}
        {tab === 'preferences' && <PreferencesView state={settings} />}
      </main>
    </div>
  )
}
