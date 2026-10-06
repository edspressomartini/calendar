# Security policy

Up Next reads a work or personal calendar, so a vulnerability here is worth reporting
properly rather than opening as an issue.

## Reporting a vulnerability

Email **edwardmartin.inbox+calendar@gmail.com**. Please do not open a public issue, and
please give it a reasonable window before disclosing it anywhere else.

Useful things to include: what you did, what happened, the version from the bottom of
the menu-bar menu, and whether you think a credential is exposed.

This is a personal project with one maintainer, so there is no 24-hour response desk.
What you will get is an acknowledgement within a few days and an honest answer about
whether and when it will be fixed.

## What is in scope

- Anything that exposes the Google refresh or access token, including reaching it from
  the sandboxed UI, from a log file, or from another process on the same Mac.
- Anything that gets code running inside the privileged process, including through a
  message channel, a calendar field, or a loaded file.
- Anything that opens a URL outside the conferencing allowlist in
  `src/main/calendar/conferenceLinks.ts`.
- Calendar content reaching disk, a log, or any host other than Google's.
- A weakness in the release pipeline that would let someone else publish a build.

## What is not in scope

These are known and documented in [the security overview](https://upnextapp.co.uk/security.html),
not oversights:

- An attacker already running code as the signed-in user, or holding the unlocked Mac.
  The app's access is no broader than the Google Calendar session in the browser.
- Anything requiring root.
- The widget being readable over a screen share. `Hide from screen sharing` is a
  convenience that ScreenCaptureKit ignores; privacy mode is the actual control.
- The TODO list being stored unencrypted. It is text the user typed, with the same
  exposure as any other file in their home directory.
- The OAuth client secret being present in the binary. Google treats desktop client
  secrets as non-confidential; PKCE is what protects the exchange.

## Supported versions

The latest release only. There is no auto-updater, so a fix reaches you through
`brew upgrade` or a fresh download — see the release notes.

## Verifying a download

```sh
xcrun stapler validate "/Applications/Up Next.app"
codesign --display --verbose=4 "/Applications/Up Next.app"
```

The signing authority should read `Developer ID Application: Edward Martin (LRHKHKMD3J)`
and the flags should include `runtime`.
