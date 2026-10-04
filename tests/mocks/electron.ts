/**
 * Stand-in for Electron so main-process modules can be unit tested in plain
 * Node. Only the surfaces the tests touch are implemented.
 */

export const safeStorageState = {
  available: true,
  failDecrypt: false,
}

const CIPHER_PREFIX = 'enc:'

export const safeStorage = {
  isEncryptionAvailable(): boolean {
    return safeStorageState.available
  },
  // Not real encryption, but it must not leave the plaintext readable, or
  // tests asserting "nothing is written in the clear" would pass for free.
  encryptString(plaintext: string): Buffer {
    const encoded = Buffer.from(plaintext, 'utf8').toString('base64')
    return Buffer.from(`${CIPHER_PREFIX}${encoded}`, 'utf8')
  },
  decryptString(ciphertext: Buffer): string {
    if (safeStorageState.failDecrypt) {
      throw new Error('cannot decrypt')
    }
    const text = ciphertext.toString('utf8')
    if (!text.startsWith(CIPHER_PREFIX)) {
      throw new Error('not our ciphertext')
    }
    return Buffer.from(text.slice(CIPHER_PREFIX.length), 'base64').toString('utf8')
  },
}

export const openedExternalUrls: string[] = []

export const shell = {
  openExternal(url: string): Promise<void> {
    openedExternalUrls.push(url)
    return Promise.resolve()
  },
}

export const protocol = {
  registerSchemesAsPrivileged(): void {},
  handle(): void {},
}

export const app = {
  isPackaged: false,
  getPath(): string {
    return '/tmp'
  },
  getAppPath(): string {
    return '/tmp'
  },
  getVersion(): string {
    return '0.0.0-test'
  },
}

/** Mirrors the subset of Electron's MenuItemConstructorOptions the app uses. */
export interface FakeMenuItem {
  readonly label?: string
  readonly type?: string
  readonly enabled?: boolean
  readonly checked?: boolean
  readonly accelerator?: string
  readonly submenu?: FakeMenuItem[]
  readonly click?: (item: { checked: boolean }) => void
}

/** Every template passed to Menu.buildFromTemplate, newest last. */
export const builtMenus: FakeMenuItem[][] = []

export const Menu = {
  buildFromTemplate(template: FakeMenuItem[]): FakeMenuItem[] {
    builtMenus.push(template)
    return template
  },
}

export class Tray {
  contextMenu: FakeMenuItem[] | null = null
  title = ''
  toolTip = ''
  destroyed = false

  setContextMenu(menu: FakeMenuItem[]): void {
    this.contextMenu = menu
  }

  setTitle(title: string): void {
    this.title = title
  }

  setToolTip(toolTip: string): void {
    this.toolTip = toolTip
  }

  destroy(): void {
    this.destroyed = true
  }
}

export const nativeImage = {
  createFromPath(): { setTemplateImage(value: boolean): void } {
    return { setTemplateImage(): void {} }
  },
}

interface FakeRectangle {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

interface FakeDisplay {
  readonly id: number
  readonly label: string
  readonly size: { readonly width: number; readonly height: number }
  readonly bounds: FakeRectangle
  readonly workArea: FakeRectangle
}

const primaryBounds: FakeRectangle = { x: 0, y: 0, width: 1920, height: 1080 }

const primaryDisplay: FakeDisplay = {
  id: 1,
  label: 'Built-in Display',
  size: { width: primaryBounds.width, height: primaryBounds.height },
  bounds: primaryBounds,
  workArea: { x: 0, y: 25, width: 1920, height: 1055 },
}

export const screen = {
  getPrimaryDisplay(): FakeDisplay {
    return primaryDisplay
  },
  getAllDisplays(): FakeDisplay[] {
    return [primaryDisplay]
  },
  getDisplayMatching(): FakeDisplay {
    return primaryDisplay
  },
}

export interface NotificationAction {
  readonly type: string
  readonly text?: string
}

export interface NotificationOptions {
  readonly title?: string
  readonly subtitle?: string
  readonly body?: string
  readonly silent?: boolean
  readonly actions?: NotificationAction[]
  readonly closeButtonText?: string
}

type NotificationHandler = (...args: unknown[]) => void

/** Records what the app would have shown, and lets tests fire its buttons. */
export class Notification {
  static supported = true
  static readonly shown: Notification[] = []

  private readonly handlers = new Map<string, NotificationHandler[]>()

  constructor(readonly options: NotificationOptions) {}

  static isSupported(): boolean {
    return Notification.supported
  }

  on(event: string, handler: NotificationHandler): this {
    const existing = this.handlers.get(event) ?? []
    existing.push(handler)
    this.handlers.set(event, existing)
    return this
  }

  show(): void {
    Notification.shown.push(this)
  }

  /** Test helper: simulate the user interacting with the notification. */
  emit(event: string, ...args: unknown[]): void {
    for (const handler of this.handlers.get(event) ?? []) {
      handler(...args)
    }
  }
}

export interface FakeIpcEvent {
  readonly senderFrame: { readonly url: string } | null
}

type IpcHandler = (event: FakeIpcEvent, payload: unknown) => unknown

const ipcHandlers = new Map<string, IpcHandler>()

export const ipcMain = {
  handle(channel: string, handler: IpcHandler): void {
    ipcHandlers.set(channel, handler)
  },
  removeHandler(channel: string): void {
    ipcHandlers.delete(channel)
  },
}

/** Drives a registered handler the way Electron would. */
export async function invokeIpc(
  channel: string,
  senderUrl: string | null,
  payload?: unknown,
): Promise<unknown> {
  const handler = ipcHandlers.get(channel)
  if (!handler) {
    throw new Error(`no handler registered for ${channel}`)
  }
  const event: FakeIpcEvent = { senderFrame: senderUrl === null ? null : { url: senderUrl } }
  return await handler(event, payload)
}

export function registeredChannels(): string[] {
  return [...ipcHandlers.keys()]
}

export function resetElectronMock(): void {
  safeStorageState.available = true
  safeStorageState.failDecrypt = false
  openedExternalUrls.length = 0
  builtMenus.length = 0
  ipcHandlers.clear()
  Notification.shown.length = 0
  Notification.supported = true
}
