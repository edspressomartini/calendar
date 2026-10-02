# Getting Up Next installable with Homebrew

Everything needed to turn this repository into `brew install --cask`, and how
updates reach people afterwards. Written 2 October 2026.

`docs/publishing-plan.md` covers the whole road to publication, including
Google verification. This file is only the distribution half, in the order it
has to happen.

---

## What Homebrew actually requires

Three things, and only the first costs money:

1. **A signed and notarised `.dmg`.** Since 1 September 2026 Homebrew disables
   casks whose contents fail Gatekeeper. An ad-hoc signature — what
   `scripts/sign-local.sh` produces — is fine on the machine that built it and
   fails on every other machine.
2. **A public download URL that never changes shape.** A GitHub Release asset
   is the normal answer, and the release workflow already publishes one.
3. **A cask file in a tap**, which is just a public repository named
   `homebrew-<something>`. No review, no approval, no waiting. The official
   `homebrew/cask` repository has rules about notability that a personal
   project will not meet; a tap has none.

---

## Step by step

### Apple, the only paid part

- [ ] **Join the Apple Developer Program**, £79/year, at
      <https://developer.apple.com/programs/>. Enrolment is usually same-day
      for an individual but can take 48 hours if they ask for ID.

      Use your own account. A friend's account means the app is published under
      his legal identity, his name appears on the certificate, and he can
      revoke it. It also breaks the moment he leaves or stops paying.

- [ ] **Create a Developer ID Application certificate** in the developer
      portal. Not "Mac App Distribution" — that one is for the App Store and
      will not work outside it. Export it from Keychain Access as a `.p12`
      with a password.

- [ ] **Create an App Store Connect API key** with the Developer role, under
      Users and Access → Integrations. Download the `.p8` once; it cannot be
      downloaded twice. Note the Key ID and Issuer ID shown beside it. This is
      what notarisation authenticates with.

### Wire it into the release workflow

- [ ] **Add five secrets** to the GitHub `release` environment
      (Settings → Environments → release → Add secret):

      | Secret                | Value                                     |
      | --------------------- | ----------------------------------------- |
      | `CSC_LINK`            | the `.p12`, base64-encoded                |
      | `CSC_KEY_PASSWORD`    | the password you set when exporting it    |
      | `APPLE_API_KEY`       | the `.p8`, base64-encoded                 |
      | `APPLE_API_KEY_ID`    | the Key ID                                |
      | `APPLE_API_ISSUER`    | the Issuer ID                             |

      `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` need to be there too; the
      OAuth client is injected at build time and never committed.

      Base64 on macOS: `base64 -i cert.p12 | pbcopy`.

- [ ] **Turn notarisation on.** In `electron-builder.yml`, `notarize: false`
      becomes `true`. Leave `hardenedRuntime: true` alone. A real Developer ID
      gives every nested binary the same Team ID, which is exactly what ad-hoc
      signing cannot do and why the local signing script has to drop the
      hardened runtime.

- [ ] **Run the release workflow on a throwaway tag**, `v0.0.1-test`. It has
      never executed. Expect to fix something. Notarisation adds 5–15 minutes
      to the build while Apple's service scans the binary.

- [ ] **Delete the test tag and its release** once it works, so the first real
      release is `v0.1.0`.

### Verify before anyone else sees it

- [ ] **Download the DMG on a Mac that has never built this project** — a
      colleague's, or a fresh user account. Confirm: it opens without a
      Gatekeeper warning, the tray icon appears, Google sign-in completes, the
      Keychain prompt appears exactly once, and launch-at-login works.

- [ ] **Check the signature and notarisation explicitly:**

      ```sh
      spctl -a -vvv -t install "/Applications/Up Next.app"
      codesign -dv --verbose=4 "/Applications/Up Next.app"
      xcrun stapler validate "/Applications/Up Next.app"
      ```

      The first should say `accepted` and `source=Notarized Developer ID`.

- [ ] **Confirm the Electron fuses survived packaging**, since signing happens
      after they are flipped:

      ```sh
      npx @electron/fuses read --app "/Applications/Up Next.app"
      ```

### The tap

- [ ] **Create a public repository named `homebrew-tap`** under
      `edspressomartini`. The `homebrew-` prefix is mandatory; it is what lets
      people write `edspressomartini/tap` instead of the full name.

- [ ] **Add `Casks/up-next.rb`:**

      ```ruby
      cask "up-next" do
        version "0.1.0"
        sha256 "<sha256 of the dmg>"

        url "https://github.com/edspressomartini/calendar/releases/download/v#{version}/up-next-#{version}-arm64.dmg"
        name "Up Next"
        desc "Always-on-top macOS widget showing today's calendar"
        homepage "https://upnextapp.co.uk/"

        livecheck do
          url :url
          strategy :github_latest
        end

        depends_on macos: ">= :sonoma"
        depends_on arch: :arm64

        app "Up Next.app"

        zap trash: [
          "~/Library/Application Support/Up Next",
          "~/Library/Logs/Up Next",
          "~/Library/Preferences/com.upnext.app.plist",
          "~/Library/Saved Application State/com.upnext.app.savedState",
        ]
      end
      ```

      Get the hash with `shasum -a 256 up-next-0.1.0-arm64.dmg`.

- [ ] **Test it on a clean machine:**

      ```sh
      brew tap edspressomartini/tap
      brew install --cask up-next
      ```

- [ ] **Check `brew uninstall --cask up-next` leaves nothing behind**, then
      `brew uninstall --zap --cask up-next` and confirm the support directory
      and the Keychain item are gone.

- [ ] **If colleagues on managed Macs are involved**, the tap has to be allowed
      by whatever manages them. Since Homebrew 6, packages from an untrusted
      third-party tap are ignored and a standard user cannot grant that trust.

---

## How updates work

**There is no auto-updater in the app, deliberately.** No `electron-updater`,
no update server, nothing phoning home. Homebrew is the update channel. That
means one less network service to trust and one less thing that can push code
onto someone's machine.

A release goes like this:

1. Bump `version` in `package.json`, commit, and push a matching tag:
   `git tag v0.2.0 && git push --tags`.
2. The release workflow builds, signs, notarises and attaches the DMG to a new
   GitHub Release.
3. In the tap, edit `Casks/up-next.rb`: new `version`, new `sha256`. Commit.
4. Users run `brew upgrade` — or `brew upgrade --cask up-next` for just this
   one — and Homebrew downloads the new DMG, checks it against the pinned
   hash, and replaces the app.

**Step 3 is manual and easy to forget.** Homebrew's autobump bots only watch
the official repositories, not personal taps. The `livecheck` block above is
what makes `brew livecheck --cask up-next` notice a newer release exists, so
at least the gap is visible. Automating it means a workflow in the tap
repository that opens a pull request on each release; worth doing after the
third time it gets forgotten, not before.

**The pinned `sha256` is the security property.** Homebrew refuses to install
if the download does not match, so a compromised release asset fails closed
rather than silently installing. This is why the cask is edited by hand per
release rather than pointing at a `latest` URL.

Two things users should know, and the README should say:

- **`brew upgrade` replaces the app but leaves data alone.** Settings, the TODO
  list and the stored Google tokens live in
  `~/Library/Application Support/Up Next` and survive upgrades. Only
  `--zap` removes them.
- **The app must be quit for an upgrade to apply cleanly.** Homebrew will
  replace a running app's bundle, but the running copy keeps the old code until
  it restarts.

---

## Rough timings

| Step                           | How long                    |
| ------------------------------ | --------------------------- |
| Apple Developer enrolment      | Same day, up to 48 hours    |
| Certificates and secrets       | An hour                     |
| First successful release build | An afternoon, realistically |
| Tap and cask                   | An hour                     |
| Each release afterwards        | Ten minutes                 |

None of this depends on Google verification. An unverified app shows a warning
at sign-in; it still installs and still works.
