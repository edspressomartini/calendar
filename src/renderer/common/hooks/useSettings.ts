import { useCallback, useEffect, useState } from 'react'
import { appSettingsSchema, type UpdateSettingsRequest } from '../../../shared/ipc/contract.ts'
import type { AppSettings } from '../../../shared/types/settings.ts'
import { fetchSettings, settingsApi } from '../lib/ipcClient.ts'

export interface SettingsState {
  readonly settings: AppSettings | null
  readonly error: string | null
  /** The settings main actually applied, or null if the change failed. */
  update(patch: UpdateSettingsRequest): Promise<AppSettings | null>
}

export function useSettings(): SettingsState {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    fetchSettings()
      .then((loaded) => {
        if (active) {
          setSettings(loaded)
        }
      })
      .catch(() => {
        if (active) {
          setError('Could not load settings.')
        }
      })
    return () => {
      active = false
    }
  }, [])

  const update = useCallback(async (patch: UpdateSettingsRequest) => {
    try {
      const raw = await settingsApi().updateSettings(patch)
      const applied = appSettingsSchema.parse(raw)
      setSettings(applied)
      setError(null)
      return applied
    } catch {
      setError('Could not save that change.')
      return null
    }
  }, [])

  return { settings, error, update }
}
