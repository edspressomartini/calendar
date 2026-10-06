# Getting Up Next installable with Homebrew

Everything needed to turn this repository into `brew install --cask`, and how
updates reach people afterwards. Written 2 October 2026.

`docs/publishing-plan.md` covers the whole road to publication, including
Google verification. This file is only the distribution half, in the order it
has to happen.

---

## The decision this plan was built on, and its reversal

**Originally: no Apple Developer Program membership**, taken deliberately on
3 October 2026. **Reversed on 4 October 2026** after watching what it actually
cost a user. Releases from `v0.2.0` are signed with a Developer ID and
notarised; `docs/apple-signing-plan.md` is the procedure.

The rest of this section is kept because the constraint it describes still
applies to `v0.1.0`, and because the reasoning explains why several decisions
further down look the way they do.

The Gatekeeper requirement — [casks must be signed and notarised, with
unsigned ones disabled from 1 September
2026](https://github.com/Homebrew/homebrew-cask/issues/222922) — applies to
the official `homebrew/cask` repository. A personal tap is not covered by it,
which is why an un-notarised cask was possible at all. It was not pleasant.

**What a user actually experienced.** `brew install --cask` succeeded. The app
did not open. Homebrew applies the `com.apple.quarantine` attribute, macOS
assessed the app, found no notarisation and refused — and on current macOS
there is no "open anyway" button in that dialog. They had to know to go to
System Settings → Privacy & Security and click **Open Anyway**, and to do it
again after every `brew upgrade`, because the replaced binary is assessed
afresh. Homebrew's own maintainers put it plainly: _"The system doesn't prompt
you with any way to work around it — unless you know how Gatekeeper works on
macOS."_

That last paragraph, written as a cost to be tolerated, is what made the £79
obviously worth paying. The `--no-quarantine` escape hatch is
[being removed from `brew`](https://github.com/Homebrew/brew/issues/20755)
precisely to stop taps doing this, so there was never a way around it.

**What it never cost was in-process hardening.** Ad-hoc builds kept the
hardened runtime, at the price of the `disable-library-validation`
entitlement. A Developer ID has now removed that price too, because every
nested binary shares one Team ID. See `docs/spec.md` §8.8.

## What is still required

1. **A download URL that never changes shape.** A GitHub Release asset. The
   release workflow already publishes one.
2. **A cask file in a tap**, which is just a public repository named
   `homebrew-<something>`. No review, no approval, no waiting.

---

## Step by step

### Make the first release

- [x] **Add the two build secrets** to the GitHub `release` environment
      (Settings → Environments → release → Add secret): `GOOGLE_CLIENT_ID` and
      `GOOGLE_CLIENT_SECRET`. Done 3 October 2026. The OAuth client is injected
      at build time and never committed, so a release built without them cannot
      sign in to Google at all.

- [ ] **Add the five Apple secrets** to the same environment: `CSC_LINK`,
      `CSC_KEY_PASSWORD`, `APPLE_API_KEY_BASE64`, `APPLE_API_KEY_ID` and
      `APPLE_API_ISSUER`. Procedure in `docs/apple-signing-plan.md`.

- [x] **Tag the version already in `package.json`.** There is no useful
      throwaway tag: electron-builder names the release from `package.json`,
      not from the tag that triggered the workflow, so a `v0.0.1-test` tag
      makes it try to publish against a `v0.1.0` tag that does not exist and
      fail with a bare 422. The workflow now checks the two agree before
      building rather than after.

      ```sh
      git tag v0.1.0 && git push origin v0.1.0
      ```

      To retry after a failure, delete both the tag and any release it made:

      ```sh
      git push origin :refs/tags/v0.1.0 && git tag -d v0.1.0
      gh release delete v0.1.0 --yes
      ```

### Verify before anyone else sees it

- [ ] **Download the DMG on a Mac that has never built this project** — a
      colleague's, or a fresh user account. This is the only way to see what a
      real user sees.

      Expect it to **open normally**, with nothing worse than the ordinary
      "this was downloaded from the internet" prompt. Then confirm the tray
      icon appears, Google sign-in completes, the Keychain prompt appears, and
      launch-at-login works.

- [ ] **Check the signature explicitly:**

      ```sh
      codesign -dv --verbose=4 "/Applications/Up Next.app"
      xcrun stapler validate "/Applications/Up Next.app"
      ```

      `codesign` should report `Authority=Developer ID Application: …
      (LRHKHKMD3J)` and `flags=0x10000(runtime)`. `stapler` should report the
      ticket is valid.

      Deliberately not `spctl`: on current macOS it reports against a policy
      engine the system no longer uses to decide launches, and it called the
      first notarised release rejected on a machine that opened it without a
      dialog. See `docs/distribution-routes.md` route 4.

- [ ] **Confirm the Electron fuses survived packaging**, since signing happens
      after they are flipped:

      ```sh
      npx @electron/fuses read --app "/Applications/Up Next.app"
      ```

### The tap

- [x] **Create a public repository named `homebrew-tap`** under
      `edspressomartini`. Done 3 October 2026. The `homebrew-` prefix is
      mandatory; it is what lets people write `edspressomartini/tap` instead of
      the full name.

- [x] **Add `Casks/up-next.rb`**, live at 0.1.0. Two things `brew audit` caught
      that are worth not repeating: `depends_on macos:` must be `:ventura`, not
      `">= :ventura"`, which is deprecated and warns three times per install;
      and the minimum has to match `LSMinimumSystemVersion` in the shipped
      `Info.plist`, which Electron 44 sets to 13.0. The two `brew audit --new`
      complaints that remain — repository not notable enough, and the signature
      failing Gatekeeper — only apply to submissions to the official cask
      repository, which this is not.

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

        depends_on macos: :ventura
        depends_on arch: :arm64

        app "Up Next.app"

        # No caveats. The build is notarised, so there is nothing the user has
        # to be warned about or talked through.

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
      brew trust edspressomartini/tap
      brew install --cask up-next
      ```

      `brew trust` is required and was not in the original plan. Homebrew 6
      refuses a third-party cask outright — _"Refusing to load cask … from
      untrusted tap"_ — until the tap is trusted. Notarisation does not change
      this: it is Homebrew's own gate, not Gatekeeper's. It remains one more
      step between a user and the app, and on a managed Mac it may be refused
      entirely, which is why `docs/distribution-routes.md` now sends anyone
      without Homebrew straight to the DMG.

      Then just open the app. Having built it on the same Mac does **not**
      pre-approve anything — the 3 October tap install was refused exactly as
      a stranger's would be — so this is a real test of the notarised build.

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
2. The release workflow builds, signs with the Developer ID, waits for Apple
   to notarise, staples the ticket and attaches the DMG to a new GitHub
   Release. Its job summary prints the `version` and `sha256` lines for the
   next step, so the hash never has to be computed by hand. Budget a few extra
   minutes for the notary service; it is the slowest step and Apple gives no
   guarantee.
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

| Step                           | How long                      |
| ------------------------------ | ----------------------------- |
| Build secrets                  | Done                          |
| First successful release build | Done, `v0.1.0`                |
| Tap and cask                   | Done                          |
| Apple certificate and API key  | Half an hour, mostly waiting  |
| First notarised release        | One run, plus Apple's queue   |
| Each release afterwards        | Ten minutes plus notarisation |

None of this depended on Google verification, which is a separate track and
passed on 6 October 2026. An unverified app shows a warning at sign-in; it
still installs and still works.
