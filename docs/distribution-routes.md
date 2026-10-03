# Getting Up Next onto someone else's Mac

Four routes, and which one to point a given person at. Written 3 October 2026,
after installing from the tap and watching macOS refuse to open the result.

`docs/homebrew-plan.md` covers how releases are built and the cask maintained.
This file is only about the person on the other end.

---

## The thing all of these have in common

Up Next is **ad-hoc signed and not notarised**, because the project has no
Apple Developer Program membership (`docs/spec.md` §8.8). The signature is
real and carries the hardened runtime, but it has no Team ID behind it and
Apple has never scanned the binary.

So on first launch macOS refuses to open it, and the person has to go to
System Settings → Privacy & Security and click **Open Anyway**. Confirmed on
3 October 2026 on the machine that built the app, which is not exempt:

```
/Applications/Up Next.app: rejected
com.apple.quarantine: 0181;…;Homebrew Cask;…
```

**The approval is recorded against the signature's code hash**, so it lasts
until the binary changes. Every new version prompts once more. It is not per
launch.

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

Identical app, identical Gatekeeper refusal, no Homebrew. The cost is that
updates are manual: nothing tells them a new version exists, and the app
deliberately has no auto-updater.

They can check what they downloaded before trusting it. Every release body
carries the SHA-256:

```sh
shasum -a 256 ~/Downloads/up-next-0.1.0-arm64.dmg
```

## Route 3 — from source, for colleagues who write code

```sh
git clone https://github.com/edspressomartini/calendar.git
cd calendar && brew bundle && npm run setup && npm run install:local
```

**This is the only route with no Gatekeeper dialog at all**, because the
quarantine attribute comes from downloading a file and a locally built app
never has one. It also means they are trusting source they can read rather
than a binary someone handed them.

They need their own Google OAuth client in `.env.local` (§8.3), which is a
Cloud Console project of their own and perhaps twenty minutes. Worth it for
one or two people, not for a team.

## Route 4 — the managed fleet, which is the hard one

A Mac enrolled in MDM is a different problem, and the most likely one for
colleagues. Two things can block them:

**The Gatekeeper setting may be locked to App Store only.** That is stricter
than the default and refuses everything that did not come from the App Store.
There is no Open Anyway in that mode. Nothing about how the app is built
changes this.

**Homebrew may be unavailable or the tap untrustable**, since granting
`brew trust` on a managed machine may not be a standard user's to give.

The only real fix is the IT team allowing the app centrally, and ad-hoc
signing makes that harder than it should be. There is no Team ID to allow, so
an allowlist entry has to name the code hash — which changes with every
release, so every release needs a new entry.

**This is the one case where the Apple Developer Program would genuinely
help**, and the honest version of the tradeoff: a Developer ID is a stable
identity an MDM can allow once, and notarisation removes the dialog entirely.

It is still not a guarantee. A fleet locked to App Store only blocks a
notarised Developer ID app exactly as it blocks this one. Worth establishing
which of the two policies is in force before concluding the membership would
have bought anything.

---

## Which to suggest

| Person                     | Route                                   |
| -------------------------- | --------------------------------------- |
| Already uses Homebrew      | 1 — the tap                             |
| Does not, on their own Mac | 2 — the DMG                             |
| Writes code and is curious | 3 — from source, and no dialog          |
| Work Mac under MDM         | 4 — ask IT first; the rest may not work |

## What would remove the dialog, in order of cost

1. **Apple Developer Program**, £79 a year. Notarisation removes the dialog
   outright and gives MDM a stable identity to allow. Declined for now; the
   whole decision is in `docs/homebrew-plan.md`.
2. **Mac App Store**, same membership plus sandboxing the app, which this
   design would not survive intact — a non-activating always-on-top panel is
   not something the sandbox is friendly towards.
3. **Nothing else.** There is no free notarisation and no way to self-certify.
   Every alternative is a variation on asking the user to override.
