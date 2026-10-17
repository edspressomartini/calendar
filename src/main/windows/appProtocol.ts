import { readFile } from 'node:fs/promises'
import { extname, join, normalize, resolve, sep } from 'node:path'
import { protocol } from 'electron'
import type { WindowRole } from '../../shared/ipc/channels.ts'
import type { AppLogger } from '../infra/logger.ts'

/**
 * Serves the renderer from `app://` rather than `file://` (docs/spec.md §8.4).
 *
 * A dedicated scheme gives each window a real origin to check senders against,
 * lets us attach the CSP to every response, and keeps `file://` powerless —
 * the grantFileProtocolExtraPrivileges fuse stays off (§8.8).
 */

export const APP_SCHEME = 'app'

const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ')

const MIME_TYPES: ReadonlyMap<string, string> = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.woff2', 'font/woff2'],
  // Never requested in practice — Chromium takes the woff2 — but the stylesheet
  // names it as a fallback, so serving it unknown would fail silently.
  ['.woff', 'font/woff'],
])

/** Must run before the app is ready. */
export function registerAppSchemePrivileges(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: APP_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: false },
    },
  ])
}

export function appOrigin(role: WindowRole): string {
  return `${APP_SCHEME}://${role}`
}

export function appUrlFor(role: WindowRole): string {
  return `${appOrigin(role)}/index.html`
}

/**
 * In dev the renderer comes from Vite; in production only from `app://`.
 *
 * `search` is for state the renderer needs before it has mounted, which it
 * cannot be sent over IPC: a push arriving before the renderer subscribes is
 * dropped, and the first render is exactly when nothing has subscribed yet.
 * The protocol handler routes on the pathname, so a query string is ignored
 * when the file is served.
 */
export function resolveRendererUrl(
  role: WindowRole,
  devServerUrl: string | null,
  search?: URLSearchParams,
): string {
  const url = devServerUrl
    ? new URL(`${role}/index.html`, `${devServerUrl}/`)
    : new URL(appUrlFor(role))
  if (search) {
    url.search = search.toString()
  }
  return url.toString()
}

/**
 * @param rendererRoot directory holding the built renderer output
 */
export function registerAppProtocol(rendererRoot: string, logger: AppLogger): void {
  const root = resolve(rendererRoot)

  protocol.handle(APP_SCHEME, async (request) => {
    const url = new URL(request.url)
    const relativePath = url.pathname === '/' ? '/index.html' : url.pathname

    const filePath = resolveRequestPath(root, url.hostname, relativePath)
    if (!filePath) {
      logger.warn('blocked app:// request outside the renderer root')
      return new Response('Not found', { status: 404 })
    }

    try {
      const contents = await readFile(filePath)
      return new Response(new Uint8Array(contents), {
        status: 200,
        headers: {
          'content-type':
            MIME_TYPES.get(extname(filePath).toLowerCase()) ?? 'application/octet-stream',
          'content-security-policy': CONTENT_SECURITY_POLICY,
          'x-content-type-options': 'nosniff',
          'cache-control': 'no-store',
        },
      })
    } catch {
      return new Response('Not found', { status: 404 })
    }
  })
}

/**
 * Each window gets its own origin so IPC senders can be told apart (§8.5),
 * but the bundler emits one shared `assets/` directory for chunks both
 * windows use. Documents resolve inside the window's own directory; hashed
 * assets resolve from the shared one. Both stay under the renderer root.
 */
export function resolveRequestPath(
  root: string,
  role: string,
  relativePath: string,
): string | null {
  if (!/^[a-z][a-z0-9-]*$/.test(role)) {
    return null
  }
  const base = relativePath.startsWith('/assets/') ? root : join(root, role)
  return safeJoin(base, relativePath)
}

/**
 * Resolves a request path inside `base`, or null if it would escape.
 * `..`, encoded separators, null bytes and absolute paths are all refused.
 */
export function safeJoin(base: string, relativePath: string): string | null {
  let decoded: string
  try {
    decoded = decodeURIComponent(relativePath)
  } catch {
    return null
  }
  if (decoded.includes('\0')) {
    return null
  }

  // Node's normalize would collapse a leading `..` and keep the result inside
  // the root anyway, but refusing the segment outright states the intent and
  // does not depend on that behaviour.
  if (decoded.split(/[\\/]/).includes('..')) {
    return null
  }

  const root = resolve(base)
  const candidate = resolve(join(root, normalize(decoded)))
  if (candidate !== root && !candidate.startsWith(root + sep)) {
    return null
  }
  return candidate
}
