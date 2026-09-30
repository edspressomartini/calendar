# Launch checklist

What is left before this app is something other people can install and rely on.
Ordered by what blocks what, not by effort.

Status as of 30 September 2026: the app runs in development, reads a real personal
Google Calendar, and has 220 passing tests. The public site now carries a homepage, a
privacy policy and a security overview, and the repository has a README. Nothing has
been signed, packaged for distribution, or shown to anyone else.

---

## 0. The three decisions everything else waits on

| Decision                                              | Who | Why it blocks things                                                                                                                      |
| ----------------------------------------------------- | --- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Bundle identifier, currently `com.pinnedcalendar.app` | You | The Keychain entry, notification permission and login item are all keyed to it. Changing it later makes every existing user sign in again |
| Apple Developer Program membership                    | You | Nothing can be given to anyone else without it. Since 1 Sep 2026 Homebrew disables casks that fail Gatekeeper                             |
| Whether the company is asked at all                   | You | Determines whether this stays a personal tool or needs a company-owned OAuth client. See `docs/company-questions.md`                      |

---

## 1. Blocking: Google

- [ ] **Decide Testing vs In production.** Testing expires refresh tokens after 7 days,
      so the app stops working weekly. Fine for now; not fine for daily use.
- [ ] **Move to In production.** Requires the homepage and privacy policy already
      published at `https://edspressomartini.github.io/calendar/`.
- [ ] **Understand the 100-user cap.** An unverified production app is limited to 100
      users _for the lifetime of the project_, and the cap cannot be reset. Irrelevant at
      two users; fatal if this ever goes public from the same project.
- [ ] **Google verification**, only needed to remove the "unverified app" warning and
      lift the cap. Needs a demo video, scope justification and brand verification.
      Expect roughly 2–3 business days for branding and around 10 for sensitive scopes.
- [ ] **Check `github.io` is acceptable for brand verification.** It is a shared domain
      that cannot be proved in Search Console. If rejected, the two pages move to a
      domain you own and nothing else changes.

## 2. Blocking: signing and packaging

- [ ] **Join the Apple Developer Program** ($99/yr).
- [ ] **Create a Developer ID Application certificate** and an App Store Connect API key
      for `notarytool`.
- [ ] **Add the release secrets** to the GitHub `release` environment: `CSC_LINK`,
      `CSC_KEY_PASSWORD`, `APPLE_API_KEY`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`,
      `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`.
- [ ] **Confirm the entitlements are sufficient.** Currently `allow-jit` only. If the
      signed build fails to launch, add the minimum needed and record why in the spec.
- [ ] **Verify the Electron fuses actually applied** to the packaged app, with
      `npx @electron/fuses read --app dist/mac-arm64/*.app`.
- [ ] **Run the release workflow end to end** on a throwaway tag. It has never executed.

## 3. Things the packaged app has never been tested for

The app has only ever run under `electron-vite dev`. These behave differently, or only
exist, in a packaged build:

- [ ] The `app://` protocol serving the real built renderer, rather than the dev server.
- [ ] Electron fuses, ASAR integrity and only-load-from-asar.
- [ ] `LSUIElement` hiding the Dock icon.
- [ ] Launch at login, which is a no-op in development by design.
- [ ] The Keychain entry under a real code signature. A signed app gets a different
      Keychain identity from unsigned Electron, so **the first signed build will require
      signing in to Google again**.
- [ ] Notification permission, which is granted per bundle id, not per app name.
- [ ] The tray icon resolving from `resources/` inside the ASAR.

## 4. Distribution

- [ ] Create the public tap repository `edspressomartini/homebrew-tap`.
- [ ] Write `Casks/pinned-calendar.rb`, including a `zap` stanza so uninstalling removes
      the stored settings, the TODO list (`todos.json`) and the token.
- [ ] Verify `brew install --cask edspressomartini/tap/pinned-calendar` on a clean machine.
- [ ] If colleagues are involved, get the tap allowed by whatever manages their Macs.
      Since Homebrew 6, packages from an untrusted third-party tap are ignored, and a
      standard user cannot grant that trust.

## 5. Product gaps before anyone else uses it

- [ ] **An onboarding path.** A first run with no account shows an empty widget and a
      Settings window. Nothing explains the unverified-app warning they are about to see.
- [ ] **A visible failure state for a dead token.** The status strip says "needs
      reconnecting", but nothing prompts; a user could stare at a stale agenda for days.
- [ ] **Uninstall story.** Confirm the `zap` stanza actually clears
      `~/Library/Application Support/Pinned Calendar`, which now holds the TODO list as
      well as the settings, and the Keychain item.
- [ ] **A real app icon.** There is a generated tray glyph but no `build/icon.icns`.
- [x] **A README.** Written, Homebrew-first, with the tap marked as not yet live.

## 6. Known gaps, deliberately deferred

- **No push notifications from Google.** Google's push requires a public HTTPS webhook,
  which would mean running a server. Polling every 3 minutes is the alternative, and the
  interval is configurable down to 1 minute.
- **Intel Macs are not built.** arm64 only until someone asks.
- **No Apple Calendar or Microsoft 365 provider.** EventKit is the fallback if the
  company refuses the OAuth client; it needs a Swift helper, an Info.plist usage string
  and a permission prompt.
- **The day window is anchored to local time**, not to the secondary time zone.
