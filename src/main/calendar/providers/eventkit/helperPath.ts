import { join } from 'node:path'

/**
 * Packaged, the binary sits in `Contents/Resources`. In dev it is whatever
 * `npm run build:helper` last produced.
 */
export interface HelperLocation {
  readonly isPackaged: boolean
  readonly resourcesPath: string
  readonly appPath: string
}

export const HELPER_BINARY_NAME = 'up-next-eventkit'

export function resolveHelperPath(location: HelperLocation): string {
  if (location.isPackaged) {
    return join(location.resourcesPath, HELPER_BINARY_NAME)
  }
  return join(location.appPath, 'build', 'helper', HELPER_BINARY_NAME)
}
