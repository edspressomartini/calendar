# Getting Up Next onto someone else's Mac

Four routes, and which one to point a given person at. Written 3 October 2026
when every route ended in a Gatekeeper refusal; revised 4 October after the
Apple Developer Program enrolment removed that (`docs/apple-signing-plan.md`).

`docs/homebrew-plan.md` covers how releases are built and the cask maintained.
This file is only about the person on the other end.

---

## The thing all of these have in common

From `v0.2.0` onwards, Up Next is **signed with a Developer ID Application
certificate and notarised by Apple**, with the ticket stapled into the bundle.
macOS opens it the way it opens any other downloaded app: one "are you sure,
this came from the internet" prompt, and nothing to override.

Anyone still on `v0.1.0` has an ad-hoc signed build and will keep seeing the
**Open Anyway** dance until they upgrade. Tell them to upgrade rather than
explaining the workaround.

Nobody has to take that on trust. Every release body carries the DMG's
SHA-256, and the installed app can be checked directly:

```sh
spctl --assess --type execute --verbose=4 "/Applications/Up Next.app"
# accepted, source=Notarized Developer ID
```

## Route 1 — Homebrew, for people who already have it

```sh
brew tap edspressomartini/tap
brew trust edspressomartini/tap
brew install --cask up-next
```

`brew trust` is not optional. Homebrew 6 refuses a cask from a third-party tap
until the tap is trusted.

Best route for anyone who already uses Homebrew, because `brew upgrade` is
then the whole update story and the pinned SHA-256 is checked on every
download. Not worth installing Homebrew _for_ — it is a large thing to add to
a machine to avoid dragging an icon.

## Route 2 — the DMG, for everyone else

[The latest release](https://github.com/edspressomartini/calendar/releases/latest)
has one asset. Download it, open it, drag Up Next to Applications.

Identical app, no Homebrew, no trust step. The only cost is that updates are
manual: nothing tells them a new version exists, and the app deliberately has
no auto-updater.

They can check what they downloaded before opening it. Every release body
carries the SHA-256:

```sh
shasum -a 256 ~/Downloads/up-next-0.2.0-arm64.dmg
```

## Route 3 — from source, for colleagues who write code

```sh
git clone https://github.com/edspressomartini/calendar.git
cd calendar && brew bundle && npm run setup && npm run install:local
```

No quarantine attribute at all, because that comes from downloading a file and
a locally built app never has one. The real draw now is that they are trusting
source they can read rather than a binary someone handed them.

They will need the ad-hoc entitlements override in the README unless they have
a Developer ID of their own.

They need their own Google OAuth client in `.env.local` (§8.3), which is a
Cloud Console project of their own and perhaps twenty minutes. Worth it for
one or two people, not for a team.

## Route 4 — the managed fleet, which is the hard one

A Mac enrolled in MDM is still the awkward case, though much less so than it
was. Two things can block them:

**The Gatekeeper setting may be locked to App Store only.** That is stricter
than the default and refuses everything that did not come from the App Store,
notarised or not. Nothing about how the app is built changes this; only the
IT team can.

**Homebrew may be unavailable or the tap untrustable**, since granting
`brew trust` on a managed machine may not be a standard user's to give.
Route 2 sidesteps this entirely.

What the Developer ID bought here is a conversation that can succeed. An
allowlist entry can now name **Team ID `LRHKHKMD3J`**, which is stable across
every release, instead of a code hash that changed every time. Ask IT to allow
that Team ID, or the bundle identifier `com.upnext.app`.

---

## Which to suggest

| Person                     | Route                                      |
| -------------------------- | ------------------------------------------ |
| Already uses Homebrew      | 1 — the tap                                |
| Does not, on their own Mac | 2 — the DMG                                |
| Writes code and is curious | 3 — from source, and no dialog             |
| Work Mac under MDM         | 2 — the DMG; ask IT if it is still blocked |

## What is left that could still block someone

1. **A fleet locked to App Store only.** The Developer ID does not help, and
   neither would anything short of shipping on the App Store.
2. **The Mac App Store** would fix that, at the cost of sandboxing the app,
   which this design would not survive intact — a non-activating always-on-top
   panel is not something the sandbox is friendly towards, and
   `setLoginItemSettings` needs replacing with a bundled login helper.
3. **Intel Macs.** Releases are arm64 only. A universal build is a
   configuration change, not a redesign, if anyone actually asks.
