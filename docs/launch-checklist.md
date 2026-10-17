# Launch checklist

What is left before this app is something other people can install and rely on.
Ordered by what blocks what, not by effort.

Status as of 16 October 2026: `v0.4.0` is released, signed with a Developer ID,
notarised, and installable with `brew install --cask edspressomartini/tap/up-next`.
272 tests pass. The site is live on its own domain at <https://upnextapp.co.uk/> with a
homepage, privacy policy and security overview, and Google verification has passed.
What is left is mostly first-run experience and the company conversation, not plumbing.

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
      for it. **Probably already done** — the same account has stayed connected for
      roughly three weeks, which Testing would not allow — but it has not been read
      back off the console, so confirm it there rather than inferring it from here.
- [x] **Understand the 100-user cap.** An unverified production app is limited to 100
      users _for the lifetime of the project_, and the cap cannot be reset. Moot now
      verification has passed, but it is why verification was worth doing before sharing
      the app around rather than after.
- [x] **Google verification passed**, 6 October 2026, lifting the cap and removing the
      "unverified app" warning. The first submission was rejected because the privacy
      policy said what data is held and where, but not how it is protected — a separate
      requirement. Adding a "How this data is protected" section and a contact address
      on the page itself cleared it. Replying to the rejection email is the
      resubmission; the console hides the submit button while a request is open.
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
- [x] **Verify `upnextapp.co.uk` as a Domain property** and **repoint the Branding
      page** at it. Done — the site serves from the custom domain (`site/CNAME`), and
      verification passed against it on 6 October 2026. A Domain property is DNS-based,
      which is the proof branding actually wanted; the `github.io` URL-prefix properties
      never could be, because `github.io` is on the Public Suffix List.

## 2. Blocking: signing and packaging

Procedure and reasoning: `docs/apple-signing-plan.md`.

- [x] **Join the Apple Developer Program** (£79/yr). Enrolled 4 October 2026.
- [x] **Create a Developer ID Application certificate** and an App Store Connect API key
      for `notarytool`. Both exist and are in use: the installed build is signed
      `Developer ID Application: Edward Martin (LRHKHKMD3J)` with the hardened runtime
      on (`flags=0x10000(runtime)`).
- [x] **Add the Google secrets** to the GitHub `release` environment:
      `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`.
- [x] **Add the Apple secrets** to the same environment: `CSC_LINK`,
      `CSC_KEY_PASSWORD`, `APPLE_API_KEY_BASE64`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`.
      Note `APPLE_API_KEY_BASE64`: the workflow decodes it to a file, because
      `@electron/notarize` wants a path rather than the key itself.
- [x] **Confirm the entitlements are sufficient.** `allow-jit` only, since a Developer
      ID makes `disable-library-validation` unnecessary. Confirmed by the signed build
      launching and running; the assumption held.
- [x] **Verify the Electron fuses actually applied** to the packaged app. Done on the
      installed bundle rather than the build directory — see section 3.
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
- [x] Electron fuses and ASAR integrity, **observed** on the installed `v0.2.1` bundle
      on 6 October 2026 with `npx @electron/fuses read --app "/Applications/Up Next.app"`.
      Every fuse is in the intended state: `RunAsNode`, `EnableNodeOptionsEnvironmentVariable`,
      `EnableNodeCliInspectArguments`, `LoadBrowserProcessSpecificV8Snapshot` and
      `GrantFileProtocolExtraPrivileges` disabled; `EnableCookieEncryption`,
      `EnableEmbeddedAsarIntegrityValidation` and `OnlyLoadAppFromAsar` enabled. Re-read
      this after any Electron major upgrade — a new fuse defaults to enabled, and the
      tool prints one the installed `@electron/fuses` does not have a name for.
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
      `~/Library/Application Support/Up Next`, `~/Library/Logs/Up Next` and
      `~/Library/Preferences/com.upnext.app.plist`. All three exist and are listed in
      the stanza, but `brew uninstall` has no `--dry-run`, so this has to be an actual
      uninstall-and-reinstall. **It will not clear the Keychain item**, and no cask can:
      `zap trash:` takes file paths only. That is harmless — the ciphertext it decrypts
      goes with `userData` — but the item does stay behind, so say so rather than
      claiming otherwise. To remove it:
      `security delete-generic-password -s "Up Next Safe Storage"`.
- [ ] If colleagues are involved, get the tap allowed by whatever manages their Macs.
      Since Homebrew 6, packages from an untrusted third-party tap are ignored, and a
      standard user cannot grant that trust. **`brew trust` is Homebrew's own gate and
      notarisation does not remove it**, so the DMG is now the lower-friction route for
      anyone who does not already use Homebrew — see `docs/distribution-routes.md`.

## 5. Product gaps before anyone else uses it

- [ ] **An onboarding path.** A first run with no account shows an empty widget and a
      Settings window, with nothing explaining what to do next. Less urgent now
      verification has removed the unverified-app warning, but still the weakest part
      of a first run.
- [ ] **A visible failure state for a dead token.** The status strip says "needs
      reconnecting", but nothing prompts; a user could stare at a stale agenda for days.
- [ ] **Uninstall story.** Confirm the `zap` stanza actually clears
      `~/Library/Application Support/Up Next`, which now holds the TODO list as
      well as the settings. The Keychain item is out of scope — see section 4.
- [x] **A real app icon.** `build/icon.icns` exists, added 2 October 2026.
- [x] **A README.** Written, Homebrew-first, with the tap marked as not yet live.

## 6. Security

A full review of `v0.4.0` is in `docs/security-review.md`, with the outstanding items
as a checklist. Four findings were fixed on the spot; none of what remains blocks a
release, and the one that matters most is reading the fuses off the shipped DMG rather
than off a local build.

## 7. Known gaps, deliberately deferred

- **No push notifications from Google.** Google's push requires a public HTTPS webhook,
  which would mean running a server. Polling every 3 minutes is the alternative, and the
  interval is configurable down to 1 minute.
- **Intel Macs are not built.** arm64 only until someone asks.
- **No Apple Calendar or Microsoft 365 provider.** EventKit is the fallback if the
  company refuses the OAuth client; it needs a Swift helper, an Info.plist usage string
  and a permission prompt.
- **The day window is anchored to local time**, not to the secondary time zone.
