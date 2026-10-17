import { describe, expect, it } from 'vitest'
import {
  HELPER_BINARY_NAME,
  resolveHelperPath,
} from '../../src/main/calendar/providers/eventkit/helperPath.ts'

/** Packaged the binary ships in Contents/Resources; in dev it is a build output. */

describe('resolveHelperPath', () => {
  it('reads the binary from the app resources when packaged', () => {
    const path = resolveHelperPath({
      isPackaged: true,
      resourcesPath: '/Applications/Up Next.app/Contents/Resources',
      appPath: '/Applications/Up Next.app/Contents/Resources/app.asar',
    })

    expect(path).toBe(`/Applications/Up Next.app/Contents/Resources/${HELPER_BINARY_NAME}`)
  })

  it('reads the build output when running from a dev tree', () => {
    const path = resolveHelperPath({
      isPackaged: false,
      resourcesPath: '/repo/node_modules/electron/dist/Electron.app/Contents/Resources',
      appPath: '/repo',
    })

    expect(path).toBe(`/repo/build/helper/${HELPER_BINARY_NAME}`)
  })
})
