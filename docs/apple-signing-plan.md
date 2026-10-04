# Developer ID signing and notarisation

How Up Next moves from an ad-hoc signature to a real Apple Developer ID, so
that macOS opens it without the user overriding Gatekeeper.

Companion to [docs/homebrew-plan.md](homebrew-plan.md) and
[docs/distribution-routes.md](distribution-routes.md), both of which describe
the workarounds this plan makes unnecessary.

## Status

Apple Developer Program enrolment purchased 4 October 2026. Team ID
`LRHKHKMD3J`.

| Step                                 | State                                |
| ------------------------------------ | ------------------------------------ |
| Apple Developer Program membership   | active                               |
| Developer ID Application certificate | not created                          |
| App Store Connect API key            | not created                          |
| GitHub `release` environment secrets | not added                            |
| Repo changes                         | done, on `feat/developer-id-signing` |
| Tagged `v0.2.0` release              | not cut                              |

## What this changes

| Today                                             | After                                |
| ------------------------------------------------- | ------------------------------------ |
| Ad-hoc signature (`identity: '-'`)                | Developer ID Application certificate |
| Not notarised                                     | Notarised and stapled                |
| User must click **Open Anyway** for every version | Double-click and it opens            |
| `disable-library-validation` entitlement required | Deleted                              |
| No Team ID, so MDM cannot allowlist the app       | Allowlist by Team ID                 |

### One thing to decide first

The enrolment is an **individual**, not an organisation. That means the
certificate's common name is the holder's **legal name**, and it is embedded in
every build. Anyone who runs `codesign -dv --verbose=4 "Up Next.app"` on a
downloaded copy can read it, and it appears in the macOS "verified developer"
dialog.

Putting a company name there instead requires a DUNS number and a separate
organisation enrolment, which is slower and cannot be switched after the fact
without re-signing under a different team. Decide before creating the
certificate, not after.

## Part 1 — Apple side

### 1. Get the Team ID

[developer.apple.com/account](https://developer.apple.com/account) →
**Membership details**. It is ten alphanumeric characters, e.g. `A1B2C3D4E5`.

### 2. Create the Developer ID Application certificate

Via Xcode, which generates the private key straight into the login keychain:

1. Xcode → **Settings** → **Accounts** → **+** → sign in with the Apple ID
2. Select the team → **Manage Certificates…**
3. **+** (bottom left) → **Developer ID Application**

It must be **Developer ID Application**. "Apple Development" is for local
builds on registered devices and will not notarise. "Mac App Distribution" is
for the App Store and produces a build that only the App Store can install.
Apple will reject a notarisation request signed with either
([Apple: notarisation requirements](https://developer.apple.com/documentation/security/resolving-common-notarization-issues)).

Developer ID Application certificates are limited to five per account and last
five years. Only the Account Holder or an Admin can create one.

### 3. Export it as a `.p12` for CI

1. **Keychain Access** → **login** keychain → **My Certificates**
2. Find `Developer ID Application: <name> (<TEAMID>)`
3. Expand the disclosure triangle and **confirm a private key sits underneath
   it**. Without the key the export is a public certificate and useless for
   signing.
4. Right-click → **Export** → **Personal Information Exchange (.p12)**
5. Set a strong password and keep it

### 4. Create an App Store Connect API key for notarisation

Preferred over an Apple ID plus app-specific password: it is independently
revocable, scoped to a role, and does not hand CI a credential tied to the
Apple ID itself.

1. [appstoreconnect.apple.com](https://appstoreconnect.apple.com) → **Users and
   Access** → **Integrations** → **App Store Connect API** → **Team Keys**
2. **Generate API Key**, name `notarytool-ci`, access **Developer**
3. **Download the `.p8`. Apple serves it once and never again.** Losing it
   means revoking the key and generating a new one.
4. Note the **Key ID** and the **Issuer ID** (the Issuer ID is shown above the
   key list, not on the key itself)

## Part 2 — GitHub secrets

Produce the base64 blobs:

```sh
base64 -i ~/Desktop/upnext-signing.p12 | pbcopy    # CSC_LINK
base64 -i ~/Desktop/AuthKey_XXXXXXXXXX.p8 | pbcopy # APPLE_API_KEY_BASE64
```

Add to **Settings → Environments → `release` → Environment secrets**, the same
place as the Google OAuth secrets. Environment scope matters: it keeps them off
pull-request builds, including those from forks.

| Secret                 | Value                          |
| ---------------------- | ------------------------------ |
| `CSC_LINK`             | base64 of the `.p12`           |
| `CSC_KEY_PASSWORD`     | the password set during export |
| `APPLE_API_KEY_BASE64` | base64 of the `.p8`            |
| `APPLE_API_KEY_ID`     | the Key ID                     |
| `APPLE_API_ISSUER`     | the Issuer ID                  |

Five, not six: notarytool derives the team from the API key, so there is no
`APPLE_TEAM_ID`. Making the Team ID a secret would also be actively unhelpful,
because GitHub masks secrets in logs and the Team ID appears in the `codesign`
output the verification step prints.

`CSC_LINK` and `CSC_KEY_PASSWORD` are electron-builder's own variable names; it
imports the certificate into a temporary keychain itself, so the workflow does
not need to run `security create-keychain` by hand. `APPLE_API_KEY_BASE64` is
local to the workflow, which decodes it to a file and passes the _path_ as
`APPLE_API_KEY`, which is what `@electron/notarize` expects.

Then **delete the `.p12` and `.p8` from disk**, after putting a copy in a
password manager. Neither belongs in the repo, and the `.p8` cannot be
re-downloaded.

## Part 3 — Repo changes

Done on `feat/developer-id-signing`. Recorded here because the reasoning does
not all survive in the diff.

1. **`electron-builder.yml`** — remove `identity: '-'` so electron-builder
   discovers the imported Developer ID, and set `notarize: true`. Rewrite the
   comment block, which currently explains the ad-hoc compromise at length.

   Note: the existing comment advises `identity: null` for this moment. That is
   wrong — in electron-builder `null` means _do not sign at all_. Omitting the
   key is what enables auto-discovery.

2. **`build/entitlements.mac.plist`** — delete
   `com.apple.security.cs.disable-library-validation`. It exists only because
   an ad-hoc signature has no Team ID for the Electron framework to match
   against; a real certificate makes it unnecessary. Keep `allow-jit`, which V8
   genuinely requires.

   This does break local builds on a machine with no certificate, because
   electron-builder falls back to an ad-hoc signature and the app then cannot
   load its own framework. `build/entitlements.adhoc.plist` exists for that
   case and is selected by a command-line override documented in the README. It
   is never used by a release.

3. **`.github/workflows/release.yml`**
   - decode `APPLE_API_KEY_BASE64` to a file and pass the five credentials to
     the packaging step
   - replace the signature check, which only asserted that _some_ signature
     existed with the hardened runtime flag, with four claims: the signature
     verifies, the authority is `Developer ID Application`, the hardened
     runtime is on, and `xcrun stapler validate` plus `spctl --assess --type
execute` both pass
   - strip the **Open Anyway** paragraph from the generated release notes

   The verification is not belt and braces. `notarizeIfProvided` in
   `app-builder-lib` logs a warning and **returns normally** when it cannot
   assemble credentials:

   ```js
   const options = MacTargetHelper.getNotarizeOptions(appPath)
   if (!options) {
     log.warn(
       { reason: '`notarize` options were unable to be generated' },
       'skipped macOS notarization',
     )
     return
   }
   ```

   A mistyped secret therefore produces a green release containing a signed but
   un-notarised DMG that passes every `codesign` check and fails on every
   user's machine. `stapler validate` is the step that catches it, because it
   reads the ticket out of the bundle rather than asking Apple a question.

4. **`package.json`** — bump to `0.2.0`. The tag-matching guard in the workflow
   means this cannot be skipped.

5. **Docs and site** — remove the Gatekeeper workaround narrative from
   `README.md`, `site/index.html`, `site/security.html`,
   `docs/distribution-routes.md` and `docs/homebrew-plan.md`. The security page
   in particular currently argues at length that an un-notarised build is
   acceptable; that argument no longer applies.

6. **Homebrew cask** (`edspressomartini/homebrew-tap`) — drop the `caveats`
   block entirely, bump `version` and `sha256`.

## Part 4 — Verify

Notarisation usually completes in under five minutes but Apple does not
guarantee it; the first submission for a new team is often the slowest. The
packaging step blocks until Apple answers.

After the release publishes, on a machine that has never run the app:

```sh
# Authority chain: expect Developer ID Application, then Developer ID
# Certification Authority, then Apple Root CA.
codesign --display --verbose=4 "/Applications/Up Next.app" 2>&1 | grep Authority

# The notarisation ticket is stapled into the bundle, so this works offline.
xcrun stapler validate "/Applications/Up Next.app"

# What Gatekeeper itself will decide. "accepted" with source
# "Notarized Developer ID" is the goal.
spctl --assess --type execute --verbose=4 "/Applications/Up Next.app"
```

The real test is behavioural, not diagnostic: download the DMG in a browser so
it carries the quarantine attribute, install, double-click, and confirm macOS
shows the ordinary "downloaded from the internet, are you sure" prompt rather
than the "unidentified developer" refusal.

## If something goes wrong

Notarisation rejections come back as a log URL rather than a readable error.
Fetch it with:

```sh
xcrun notarytool log <submission-id> \
  --key AuthKey_XXXXXXXXXX.p8 --key-id <KEY_ID> --issuer <ISSUER_ID>
```

The common causes for an Electron app are a nested binary that was not signed,
a missing hardened runtime on a helper, or an entitlement Apple does not permit
for Developer ID distribution.

Rolling back is cheap: the previous release stays published, and the cask can
be pointed at it again by reverting one commit in the tap.
