import type { BrowserWindow, Session, WebPreferences } from 'electron'
import type { AppLogger } from '../infra/logger.ts'
import { APP_SCHEME } from './appProtocol.ts'

/**
 * Applied to every window and to the shared session (docs/spec.md §8.4).
 * A window that skips this is a bug.
 */

export interface WindowSecurityOptions {
  readonly preloadPath: string
  readonly isDev: boolean
}

export function hardenedWebPreferences(options: WindowSecurityOptions): WebPreferences {
  return {
    preload: options.preloadPath,
    sandbox: true,
    contextIsolation: true,
    nodeIntegration: false,
    nodeIntegrationInWorker: false,
    nodeIntegrationInSubFrames: false,
    webSecurity: true,
    allowRunningInsecureContent: false,
    experimentalFeatures: false,
    webviewTag: false,
    spellcheck: false,
    devTools: options.isDev,
  }
}

/** No navigation, no new windows, no webviews — whatever the page tries. */
export function applyWindowSecurity(window: BrowserWindow, logger: AppLogger): void {
  const contents = window.webContents

  contents.on('will-navigate', (event) => {
    event.preventDefault()
    logger.warn('blocked navigation attempt from a renderer')
  })

  // `will-navigate` is main-frame only; a subframe needs its own handler.
  contents.on('will-frame-navigate', (event) => {
    event.preventDefault()
    logger.warn('blocked subframe navigation attempt from a renderer')
  })

  contents.on('will-redirect', (event) => {
    event.preventDefault()
    logger.warn('blocked redirect attempt from a renderer')
  })

  contents.setWindowOpenHandler(() => {
    logger.warn('blocked window.open from a renderer')
    return { action: 'deny' }
  })

  contents.on('will-attach-webview', (event) => {
    event.preventDefault()
    logger.warn('blocked webview attachment')
  })
}

/**
 * Session-wide controls: deny every permission, and cancel any renderer
 * request that is not our own scheme. The CSP says the same thing; this is the
 * second lock.
 */
export function applySessionSecurity(
  session: Session,
  options: { isDev: boolean; devServerOrigin: string | null },
  logger: AppLogger,
): void {
  session.setPermissionRequestHandler((_contents, permission, callback) => {
    logger.warn('denied permission request', { permission })
    callback(false)
  })

  session.setPermissionCheckHandler(() => false)

  session.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: !isAllowedRequest(details.url, options) })
  })
}

function isAllowedRequest(
  url: string,
  options: { isDev: boolean; devServerOrigin: string | null },
): boolean {
  if (url.startsWith(`${APP_SCHEME}://`)) {
    return true
  }
  // devtools:// and blob:/data: are used by Electron and the bundler itself.
  if (url.startsWith('devtools://') || url.startsWith('blob:') || url.startsWith('data:')) {
    return true
  }
  if (options.isDev && options.devServerOrigin && url.startsWith(options.devServerOrigin)) {
    return true
  }
  if (options.isDev && url.startsWith('ws://')) {
    return true
  }
  return false
}
