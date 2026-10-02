# Publishing plan

How this goes from "runs on my Mac" to "other people can install it", in the
order things actually unblock each other. Written 2 October 2026.

Three things are often confused. They are independent, and only the third one
needs the other two:

| Goal                                       | Needs                   | Cost      |
| ------------------------------------------ | ----------------------- | --------- |
| A native app on my own Mac                 | Nothing                 | Done      |
| No "unverified app" warning at sign-in     | Google verification     | ~£10/year |
| Anyone else can install it, including brew | Apple Developer Program | $99/year  |

---

## Part 0: the thing that is actually blocking verification

Google rejects the home page URL with "not registered to you", and no amount
of re-verifying fixes it. The cause is not a missing step.

`github.io` is on the [Public Suffix List](https://publicsuffix.org/): it is a
shared host where anyone can have a subdomain. Search Console will verify a
URL-prefix property on it, and did — twice, both still live. Google's branding
check wants ownership of a **domain**, which on a public-suffix host nobody
can demonstrate, because DNS verification is impossible there.

**This is fixable without a support ticket.** Buy a domain. The appeal route is
worse: an appeal can only be submitted as part of a full verification
submission, which means recording the demo video first, and then waiting on a
human to agree with an argument about the Public Suffix List.

---

## Part 1: a domain of your own (~£10/year, half an hour)

1. **Buy a domain.** Cloudflare Registrar sells at wholesale with no markup and
   no first-year-cheap-then-expensive trick. Anything works; something like
   `pinnedcalendar.app` reads better on a consent screen than a personal
   domain, because the consent screen shows it to anyone who installs this.

2. **Point it at GitHub Pages.** At the DNS provider, for the apex:

   | Type  | Name | Value                                                                      |
   | ----- | ---- | -------------------------------------------------------------------------- |
   | A     | @    | `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153` |
   | AAAA  | @    | `2606:50c0:8000::153`, `::8001:153`, `::8002:153`, `::8003:153`            |
   | CNAME | www  | `edspressomartini.github.io`                                               |

   On Cloudflare, set the records to **DNS only** (grey cloud) at first.
   Proxying breaks GitHub's certificate provisioning until the certificate
   exists.

3. **Tell GitHub about it.** In the `calendar` repository, Settings → Pages →
   Custom domain, enter the domain and save. Add a matching `site/CNAME` file
   containing just the domain, so the Actions deployment does not drop it on
   the next publish. Wait for **Enforce HTTPS** to become available and tick it;
   certificate issuance takes a few minutes to an hour.

4. **Verify it in Search Console as a Domain property**, which is the option
   `github.io` never allowed. Add property → Domain → the bare domain → add the
   TXT record it gives you at the DNS provider → Verify. This is ownership of
   the whole zone, which is exactly what the branding check is looking for.
   Use the Google account that owns the Cloud project: `edwardmartin.inbox@gmail.com`.

5. **Update the Branding page** at Google Auth Platform → Branding:
   - Application home page → `https://<domain>/`
   - Application privacy policy link → `https://<domain>/privacy.html`
   - Authorized domains → the bare domain, replacing `edspressomartini.github.io`

6. **Resubmit branding verification.** Wait 24 hours after the Search Console
   verification before doing so; Google asks for it and an early retry fails
   with the identical message.

Keep the two `github.io` properties and both verification files where they
are. They cost nothing and they are evidence if anyone asks.

---

## Part 2: sensitive scope verification (free, ~10 business days)

Only needed to lift the 100-user cap and remove the warning screen. Blocked on
nothing but effort.

7. **Publish the app to Production** first, if it is not already. This does not
   require verification and should not wait for it. Testing mode expires
   refresh tokens after seven days, so the app stops working weekly until this
   is done.

8. **Scope justification.** The text is in the chat history; it explains what
   each scope draws on screen, why no narrower scope exists, and that nothing
   leaves the device.

9. **Demo video**, an unlisted YouTube link. One continuous recording, no cuts:
   the app with no account connected, clicking Connect, the Google consent
   screen with the app name and both scopes legible, granting consent, then
   today's events appearing in the widget. Reviewers reject videos that skip
   the consent screen or splice clips.

10. **Submit.** Branding is quick; sensitive scopes take around ten business
    days.

---

## Part 3: Apple ($99/year, the real blocker for other people)

Nothing here is optional if anyone but you installs this. Since 1 September
2026 Homebrew disables casks that fail Gatekeeper, so an unsigned cask is not
a shortcut — it is a cask that stops working.

11. **Join the Apple Developer Program** on your own account. Using a friend's
    only works if his is an _Organization_ account that can add you as a team
    member. If it is an Individual account there is no team, so the only way is
    him handing over his signing certificate and private key: that breaches the
    developer agreement, publishes your app under his legal identity, and makes
    your mistakes his problem.

12. **Create a Developer ID Application certificate**, and an App Store Connect
    API key for `notarytool`.

13. **Add the release secrets** to the GitHub `release` environment:
    `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_API_KEY`, `APPLE_API_KEY_ID`,
    `APPLE_API_ISSUER`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`.

14. **Draw an app icon.** `build/icon.icns` does not exist, so every build so
    far has shipped the default Electron icon. It is the first thing anyone
    sees.

15. **Turn notarisation on** in `electron-builder.yml` (`notarize: false` today)
    and keep `hardenedRuntime: true`. A real Developer ID gives every nested
    binary the same Team ID, which is what local ad-hoc signing cannot do and
    why `scripts/sign-local.sh` has to drop the hardened runtime.

16. **Run the release workflow end to end on a throwaway tag.** It has never
    executed. Expect to fix something.

17. **Check the signed build on a clean Mac**: Gatekeeper accepts it, the
    Keychain prompt appears once, notification permission is granted, launch at
    login works, and the tray icon resolves from inside the ASAR. The first
    signed build will require signing in to Google again, because the Keychain
    identity changes with the signature.

---

## Part 4: Homebrew

18. **Create the public tap** `edspressomartini/homebrew-tap`.

19. **Write `Casks/pinned-calendar.rb`**, with a `zap` stanza that removes
    `~/Library/Application Support/Pinned Calendar` — settings, `todos.json`
    and the encrypted tokens — and the Keychain item.

20. **Install it on a clean machine** with
    `brew install --cask edspressomartini/tap/pinned-calendar`, and confirm
    `brew upgrade` replaces it cleanly.

21. **If colleagues are involved**, the tap needs allowing by whatever manages
    their Macs. Since Homebrew 6, packages from an untrusted third-party tap are
    ignored and a standard user cannot grant that trust.

---

## Before anyone else sees it

Not blocking, but all three are first-impression problems:

- **An onboarding path.** A first run with no account shows an empty widget and
  a Settings window, and nothing explains the unverified-app warning they are
  about to see.
- **A prompt when a token dies.** The status strip says "needs reconnecting",
  but nothing asks; a user could stare at a stale agenda for days.
- **The app icon**, as above.

---

## What this costs

| Item                    | Cost      | Needed for                        |
| ----------------------- | --------- | --------------------------------- |
| Domain                  | ~£10/year | Google verification, Part 1       |
| Apple Developer Program | $99/year  | Anyone else installing it, Part 3 |
| Google verification     | Free      | Removing the warning, Part 2      |

If the answer to Apple is no, Part 1 and Part 2 still stand on their own: you
get a clean consent screen and a permanent login, and you keep building the app
locally with `npm run package && ./scripts/sign-local.sh`.
