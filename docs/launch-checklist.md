# Launch checklist

What is left before this app is something other people can install and rely on.
Ordered by what blocks what, not by effort.

Status as of 30 September 2026: the app runs in development, reads a real personal
Google Calendar, and has 220 passing tests. The public site now carries a homepage, a
privacy policy and a security overview, and the repository has a README. Nothing has
been signed, packaged for distribution, or shown to anyone else.

---

## 0. The three decisions everything else waits on

| Decision                                                                           | Who  | Why it blocks things                                                                                                                                                                |
| ---------------------------------------------------------------------------------- | ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ~~Bundle identifier~~ — settled as `com.upnext.app`                                | Done | Was `com.pinnedcalendar.app`. Changed during the rename, while the author was the only user, because the Keychain entry, notification permission and login item are all keyed to it |
| ~~Apple Developer Program membership~~ — enrolled 4 Oct 2026, Team ID `LRHKHKMD3J` | Done | Nothing could be given to anyone else without it. Since 1 Sep 2026 Homebrew disables casks that fail Gatekeeper                                                                     |
| Whether the company is asked at all                                                | You  | Determines whether this stays a personal tool or needs a company-owned OAuth client. See `docs/company-questions.md`                                                                |

---

## 1. Blocking: Google

- [x] **Brand verification passed**, 2 October 2026, on `https://upnextapp.co.uk/`.
      The consent screen now shows the Up Next name and logo.
- [ ] **Move to In production.** Testing expires refresh tokens after 7 days, so the
      app stops working weekly. This does not need verification and should not wait
      for it.
- [ ] **Understand the 100-user cap.** An unverified production app is limited to 100
      users _for the lifetime of the project_, and the cap cannot be reset. Irrelevant at
      two users; fatal if this ever goes public from the same project.
- [ ] **Google verification**, only needed to remove the "unverified app" warning and
      lift the cap. Needs a demo video, scope justification and brand verification.
      Expect roughly 2–3 business days for branding and around 10 for sensitive scopes.
- [x] **Prove ownership of the home page URL.** Google's branding attempt failed with
      "not registered to you". `github.io` is on the Public Suffix List, so a _Domain_
      property is impossible, but _URL prefix_ properties are not. Two now exist, both
      verified by HTML file with the same token, `googleae8d5da130c7a7f8.html`:

  | Property                                       | File lives in                         | Verified   |
  | ---------------------------------------------- | ------------------------------------- | ---------- |
  | `https://edspressomartini.github.io/calendar/` | this repo, `site/`                    | 30 Sep '26 |
  | `https://edspressomartini.github.io/`          | the `edspressomartini.github.io` repo | 1 Oct '26  |

  The second one needed a **user-site repo**, named exactly `edspressomartini.github.io`,
  because the host root is served from there and nothing else can put a file at it. The
  path-only property was not enough on its own: authorised domains are checked at the
  domain level. Never delete either file — Search Console re-checks and un-verifies.
  `.prettierignore` covers the one in this repo, since its exact bytes are the proof.

  Both properties stayed verified and branding still failed. The reason was never
  Search Console: `github.io` is on the Public Suffix List, so the registrable domain
  is GitHub's, and no one can prove ownership of it. `upnextapp.co.uk` was bought at
  123reg on 2 October to end this.

- [x] **`edspressomartini.github.io` is in Authorized domains** on the Branding page,
      and always was. The entry was never the missing piece.
- [ ] **Verify `upnextapp.co.uk` as a Domain property**, once the 123reg DNS records
      resolve and GitHub Pages serves the site there. A Domain property is DNS-based,
      which is the proof branding actually wants.
- [ ] **Repoint the Branding page** at the new domain, and change the app name to
      `Up Next` while there. Then retry, no earlier than 24 hours after the Search
      Console verification; an early retry fails with the identical message. The
      Search Console property and the Cloud project must stay on the same Google
      account, which is what the check compares.

## 2. Blocking: signing and packaging

Procedure and reasoning: `docs/apple-signing-plan.md`.

- [x] **Join the Apple Developer Program** (£79/yr). Enrolled 4 October 2026.
- [ ] **Create a Developer ID Application certificate** and an App Store Connect API key
      for `notarytool`.
- [x] **Add the Google secrets** to the GitHub `release` environment:
      `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`.
- [ ] **Add the Apple secrets** to the same environment: `CSC_LINK`,
      `CSC_KEY_PASSWORD`, `APPLE_API_KEY_BASE64`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`.
      Note `APPLE_API_KEY_BASE64`: the workflow decodes it to a file, because
      `@electron/notarize` wants a path rather than the key itself.
- [ ] **Confirm the entitlements are sufficient.** Now `allow-jit` only, since a
      Developer ID makes `disable-library-validation` unnecessary. If the signed build
      fails to launch, that assumption is wrong — add the minimum needed and record why
      in the spec rather than reaching for the ad-hoc plist.
- [ ] **Verify the Electron fuses actually applied** to the packaged app, with
      `npx @electron/fuses read --app dist/mac-arm64/*.app`.
- [x] **Run the release workflow end to end.** First succeeded for `v0.1.0`.
- [x] **Run it again with signing and notarisation on.** `v0.2.0`, 4 October 2026. The
      keychain import and the notary service both worked first time; the `Package` step
      took about 22 minutes, nearly all of it waiting on Apple.

## 3. Things that only exist in a packaged build

These behave differently, or only exist, outside `electron-vite dev`. Installing
`v0.2.0` from the tap on 4 October 2026 exercised several of them implicitly: the app
launched, drew its UI and reached Google, which it could not have done with the
`app://` protocol, the fuses, the ASAR or the tray icon broken.

- [x] The `app://` protocol serving the real built renderer, rather than the dev server.
- [x] The tray icon resolving from `resources/` inside the ASAR.
- [x] `LSUIElement` hiding the Dock icon.
- [x] The Keychain entry under a real code signature. Confirmed, including the
      consequence: changing signer raises a one-off _"Up Next wants to use your
      confidential information"_ prompt. **Always Allow** is the answer. A Developer ID
      signature is stable across releases, so it does not recur — unlike the old ad-hoc
      signature, which differed on every build.
- [ ] Electron fuses and ASAR integrity, **asserted rather than observed**. Read them
      explicitly with `npx @electron/fuses read --app "/Applications/Up Next.app"`.
- [ ] Launch at login, which is a no-op in development by design.
- [ ] Notification permission, which is granted per bundle id, not per app name.

## 4. Distribution

- [x] Create the public tap repository `edspressomartini/homebrew-tap`.
- [x] Write `Casks/up-next.rb`, including a `zap` stanza so uninstalling removes
      the stored settings, the TODO list (`todos.json`) and the token.
- [x] Verify `brew install --cask edspressomartini/tap/up-next`. Done 4 October 2026
      with the cached download deleted first, so the DMG was fetched fresh and carried
      the quarantine attribute. It opened with no Gatekeeper dialog.
- [ ] Confirm `brew uninstall --zap --cask up-next` really does clear
      `~/Library/Application Support/Up Next` and the Keychain item. Still only
      asserted.
- [ ] If colleagues are involved, get the tap allowed by whatever manages their Macs.
      Since Homebrew 6, packages from an untrusted third-party tap are ignored, and a
      standard user cannot grant that trust. **`brew trust` is Homebrew's own gate and
      notarisation does not remove it**, so the DMG is now the lower-friction route for
      anyone who does not already use Homebrew — see `docs/distribution-routes.md`.

## 5. Product gaps before anyone else uses it

- [ ] **An onboarding path.** A first run with no account shows an empty widget and a
      Settings window. Nothing explains the unverified-app warning they are about to see.
- [ ] **A visible failure state for a dead token.** The status strip says "needs
      reconnecting", but nothing prompts; a user could stare at a stale agenda for days.
- [ ] **Uninstall story.** Confirm the `zap` stanza actually clears
      `~/Library/Application Support/Up Next`, which now holds the TODO list as
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
