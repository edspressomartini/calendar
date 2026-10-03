# Getting Up Next installable with Homebrew

Everything needed to turn this repository into `brew install --cask`, and how
updates reach people afterwards. Written 2 October 2026.

`docs/publishing-plan.md` covers the whole road to publication, including
Google verification. This file is only the distribution half, in the order it
has to happen.

---

## The decision this plan is built on

**No Apple Developer Program membership.** Taken deliberately on 3 October
2026, with the costs below understood. Everything here follows from it.

The Gatekeeper requirement — [casks must be signed and notarised, with
unsigned ones disabled from 1 September
2026](https://github.com/Homebrew/homebrew-cask/issues/222922) — applies to
the official `homebrew/cask` repository. A personal tap is not covered by it,
so this is possible. It is not pleasant.

**What a user actually experiences.** `brew install --cask` succeeds. The app
does not open. Homebrew applies the `com.apple.quarantine` attribute, macOS
assesses the app, finds no notarisation and refuses — and on current macOS
there is no "open anyway" button in that dialog. They have to know to go to
System Settings → Privacy & Security and click **Open Anyway**, and they have
to do it again after every `brew upgrade`, because the replaced binary is
assessed afresh. Homebrew's own maintainers put it plainly: _"The system
doesn't prompt you with any way to work around it — unless you know how
Gatekeeper works on macOS."_

The `--no-quarantine` escape hatch is
[being removed from `brew`](https://github.com/Homebrew/brew/issues/20755)
precisely to stop taps doing this, so do not plan around it.

**What it costs the app itself: less than first thought.** Builds are ad-hoc
signed (`identity: '-'`), which an unsigned arm64 binary needs in order to
execute at all. The **hardened runtime stays on** — verified on the packaged
app, `flags=0x10002(adhoc,runtime)`. It needs the
`disable-library-validation` entitlement to tolerate a signature with no Team
ID, which relaxes one protection and keeps the rest, including the DYLD
environment variable restrictions that block `DYLD_INSERT_LIBRARIES`. See
`docs/spec.md` §8.8.

So the loss is notarisation: Apple's malware scan of the binary, and a named
revocable identity. Not in-process hardening.

**Reversing this is two lines plus a deletion**, the day a certificate exists:
`identity: null`, `notarize: true`, and drop `disable-library-validation` from
`build/entitlements.mac.plist`.

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

      The workflow no longer reads any Apple secrets. It signs ad-hoc with the
      identity in `electron-builder.yml` and then asserts the signature carries
      the hardened runtime, so a build that silently went unsigned fails the
      release instead of shipping a DMG that cannot launch.

- [ ] **Tag the version already in `package.json`.** There is no useful
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
      real user sees; the machine that built it has the app already trusted.

      Expect Gatekeeper to refuse it. Confirm that System Settings → Privacy &
      Security → **Open Anyway** works, and that afterwards the tray icon
      appears, Google sign-in completes, the Keychain prompt appears, and
      launch-at-login works.

- [ ] **Check the signature explicitly:**

      ```sh
      codesign -dv --verbose=4 "/Applications/Up Next.app"
      spctl -a -vvv -t install "/Applications/Up Next.app"
      ```

      `codesign` should report `Signature=adhoc`. `spctl` will **reject** it —
      that is expected and is exactly the Gatekeeper refusal users hit. If
      `codesign` reports no signature at all, the build is broken: an unsigned
      arm64 binary will not run on Apple silicon under any circumstances.

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

        depends_on macos: ">= :sonoma"
        depends_on arch: :arm64

        app "Up Next.app"

        # Without this the install looks like it worked and the app will not
        # open, with nothing on screen explaining why.
        caveats <<~EOS
          Up Next is not notarised by Apple, so macOS will refuse to open it
          the first time, and again after each upgrade.

          To allow it:
            1. Try to open Up Next. macOS will block it.
            2. Open System Settings > Privacy & Security.
            3. Scroll down and click "Open Anyway" next to Up Next.

          This is because the project has no Apple Developer Program
          membership. See https://upnextapp.co.uk/security.html
        EOS

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
      untrusted tap"_ — until the tap is trusted. It is one more step between
      a user and the app, and on a managed Mac it may be refused entirely.

      Installing on the machine that built the app proves nothing about
      Gatekeeper: this Mac has already approved the ad-hoc signature, so the
      installed copy launched straight away despite carrying the quarantine
      attribute.

      Read the caveats Homebrew prints, then follow them as a user would.
      Confirm the Privacy & Security override actually makes the app open —
      this is the step most likely to lose people, and it needs to have been
      walked at least once by someone who did not build the app.

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
2. The release workflow builds, ad-hoc signs and attaches the DMG to a new
   GitHub Release. Its job summary prints the `version` and `sha256` lines for
   the next step, so the hash never has to be computed by hand.
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
| Build secrets                  | Done                        |
| First successful release build | An afternoon, realistically |
| Tap and cask                   | An hour                     |
| Each release afterwards        | Ten minutes                 |

None of this depends on Google verification. An unverified app shows a warning
at sign-in; it still installs and still works.
