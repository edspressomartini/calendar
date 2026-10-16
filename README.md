<img src="icons/icon-1024.png" alt="" width="72" align="left" hspace="12">

# Up Next

A small always-on-top macOS widget that shows today's calendar, so meetings stop
ambushing you mid-task. It sits in the corner of a monitor you choose, floats above
full-screen apps, appears on every Space, and never steals focus from whatever you are
typing in. There is no Dock icon — just a countdown to your next meeting in the menu bar.

It also keeps a TODO list beside the day: add one from anywhere with a global shortcut
(`⌃⌥T` by default, changeable in settings), tick it off, or roll it forward when today
gets away from you.

Everything runs on your own Mac. No server, no account to create, no analytics.

**[Homepage](https://upnextapp.co.uk/)** ·
**[Privacy policy](https://upnextapp.co.uk/privacy.html)** ·
**[Security overview](https://upnextapp.co.uk/security.html)**

---

## Install

```sh
brew tap edspressomartini/tap
brew trust edspressomartini/tap
brew install --cask up-next
```

`brew trust` is not optional: since Homebrew 6 a cask from a third-party tap is refused
until the tap is trusted, and on a managed Mac you may not be able to grant that.

No Homebrew? [Download the latest DMG](https://github.com/edspressomartini/calendar/releases/latest)
and drag Up Next to Applications. Same app. For a work Mac, or for colleagues who would
rather build it themselves, see [distribution routes](docs/distribution-routes.md).

Updating is `brew upgrade`. There is deliberately no auto-updater: Homebrew verifies a
pinned hash for each release, so there is no update server to trust.

Requirements: **Apple silicon, macOS Ventura or newer**, and a Google account.

Releases are signed with an Apple Developer ID and notarised by Apple, so macOS opens
them normally. The [security overview](https://upnextapp.co.uk/security.html) covers what
that does and does not tell you.

### Where this has got to

| Step                                | Status                                       |
| ----------------------------------- | -------------------------------------------- |
| The tap repository and cask         | Live, `edspressomartini/homebrew-tap`        |
| Latest release                      | `v0.2.1`, signed and notarised               |
| Google OAuth brand verification     | Passed 2 October 2026                        |
| Google sensitive-scope verification | Passed 6 October 2026; no warning at sign-in |
| Apple Developer Program             | Enrolled; releases are signed and notarised  |

The full list, in dependency order, is in [`docs/launch-checklist.md`](docs/launch-checklist.md).

---

## Run it yourself

Building locally needs no Apple account. electron-builder signs with whatever Developer ID
it finds in your keychain and falls back to an ad-hoc signature if there is none, which is
enough for a binary you compiled on the machine you are running it on.

```sh
brew bundle                 # Node 24 and the rest of the toolchain
npm run setup               # install dependencies and the Electron binary
cp .env.example .env.local  # then add your own Google OAuth client
npm run dev
```

You need your own Google OAuth client, because the one this app ships with is tied to a
personal Google Cloud project. In the [Google Cloud console](https://console.cloud.google.com/):
create a project, enable the **Google Calendar API**, configure the OAuth consent screen
as **External**, and create an OAuth client of type **Desktop app**. Put the client ID and
secret in `.env.local`. The app requests two read-only scopes and nothing else:
`calendar.events.readonly` and `calendar.calendarlist.readonly`.

To build it and put it in `/Applications` as a real app:

```sh
npm run install:local
```

That packages, signs and replaces the installed copy, quitting it first if it is running.
Run it again after any change — the installed app is a copy, so editing the source does
nothing to it until it is rebuilt. `npm run package` on its own just produces the DMG.

Neither is notarised, because notarisation needs credentials only CI has. A local build
therefore runs fine on the machine that built it and gets blocked by Gatekeeper on any
other Mac. Use a real release for that.

**On a Mac behind a TLS-intercepting proxy** — most managed fleets — packaging fails with
`unable to get local issuer certificate`. electron-builder downloads the Electron binary
over HTTPS and Node does not read the system keychain, so it never sees the proxy's CA.
Hand it the machine's trust store:

```sh
security find-certificate -a -p /Library/Keychains/System.keychain > /tmp/ca-bundle.pem
security find-certificate -a -p /System/Library/Keychains/SystemRootCertificates.keychain >> /tmp/ca-bundle.pem
export NODE_EXTRA_CA_CERTS=/tmp/ca-bundle.pem
```

CI is unaffected; GitHub's runners are not behind a proxy.

**Without a Developer ID certificate in your keychain**, the build is signed ad-hoc, which
has no Team ID for library validation to match the Electron framework against, and the app
will not launch. Build with the entitlements that tolerate it:

```sh
npm run build && electron-builder --mac --publish never \
  --config.mac.entitlements=build/entitlements.adhoc.plist \
  --config.mac.entitlementsInherit=build/entitlements.adhoc.plist
```

---

## Security

The short version: two read-only Google scopes, a refresh token encrypted by the macOS
Keychain and bound to the app's code signature, calendar content held in memory and never
written to disk, outbound traffic to Google's endpoints and nowhere else, no telemetry,
no crash reporting, no auto-updater. The UI is fully sandboxed with no Node and no network
access, and every message it sends to the privileged process is schema-validated and
origin-checked.

The [security overview](https://upnextapp.co.uk/security.html) is
written for someone deciding whether to allow this on a managed Mac. The threat model,
the attack surface table and the reasoning behind each control are in
[`docs/spec.md`](docs/spec.md) §8.

Found a vulnerability? Please report it privately rather than opening an issue.

---

## Development

| Command                 | What it does                                                         |
| ----------------------- | -------------------------------------------------------------------- |
| `npm run dev`           | Run the app with hot reload                                          |
| `npm run check`         | Typecheck, lint, format check and tests — run this before committing |
| `npm test`              | Vitest, 236 tests                                                    |
| `npm run package`       | Build a local unsigned DMG                                           |
| `npm run install:local` | Build, sign and replace `/Applications/Up Next.app`                  |
| `npm run icons`         | Redraw the tray glyph and the app icon                               |

Node 24 is required and enforced; `npm run dev` fails fast on anything else.

The app is Electron 44, React 19, TypeScript 6 and Tailwind 4. The privileged process
owns all state and the clock, and pushes finished view models to the UI, which derives
nothing. Adding a message channel means a schema, a sender check and a row in the table
in `docs/spec.md` §8.5 — the three exist together or the channel does not ship.

[`docs/spec.md`](docs/spec.md) is the design document: the structure, the visual language,
the security model, and a final section recording every deviation from the original plan
and why. It is worth reading before changing anything structural.

## Status

Version 0.2.1, released 5 October 2026: signed with an Apple Developer ID, notarised,
and installable from the Homebrew tap or as a DMG. Runs daily against a real calendar.
The app shows its own version at the bottom of the menu-bar menu.

Google's sensitive-scope verification passed on 6 October 2026, so sign-in is the
ordinary Google flow with no "unverified app" warning and no 100-user cap.

## Licence

[MIT](LICENSE). Vulnerability reports go to the address in [`SECURITY.md`](SECURITY.md)
rather than the issue tracker.
