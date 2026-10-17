# Security review — 16 October 2026

A whole-repository review of `v0.4.0`, not a diff review. Five findings: one High,
one Medium, three Low. Four are fixed in this commit; the rest are listed below with
what is actually left to do.

The architecture held up. Of the six defences the code claims for itself, five were
confirmed by reading the code and probing the edge cases, and one — log redaction —
was refuted. That one is the High finding.

---

## Fixed in this commit

### High — the account email address was written to the log file

`TransientProviderError` and `ReauthRequiredError` both built their message by
interpolating `accountId`, and `accountId` is the primary calendar id, which is the
user's email address. `IpcRouter` logs `describeError(error)` when a handler throws,
`describeError` returned `${name}: ${message}`, and `redactValue` matches on exact
keys — so a string under the key `error` passed straight through to
`~/Library/Logs/Up Next/main.log`:

```
TransientProviderError: temporary provider failure for alice@company.com: request rejected
```

Not a token leak: `describeError` only ever read `.message`, and the `Authorization`
header lives on `GaxiosError.config`. But it contradicted §8.7, and a test actively
pinned the behaviour in place, so it was a deliberate choice whose consequence had
not been traced.

**Fixed** by removing the account id from both messages — it stays available as a
typed property — and by making `describeError` return the full message only for our
own `AppError` subclasses, and the class name alone for anything else.

### Medium — a non-JSON error response became a log line verbatim

Gaxios sets `error.message` to the entire response body when that body is not JSON
(`extractAPIErrorFromResponse`). A captive portal, a TLS-terminating corporate proxy
or an HTML 502 from an intermediary therefore chose the text of a log line. Since
`electron-log`'s file transport is line-oriented and a body can contain newlines,
that is a log-injection primitive: forged entries, not just noise.

`googleErrors.ts` claimed "nothing from the raw error object escapes this file", but
`mapGoogleError` was only wired into `listCalendars` and `fetchOneCalendar`. The
whole authentication path — `getToken`, `revokeToken`, the `calendarList.list` inside
`resolveIdentity` — was unmapped.

**Fixed** at both ends: the `describeError` change above means no foreign message can
reach a log at all, and the token exchange now translates failures into
`AuthFlowError('exchange_failed')` at the boundary, so the file's stated invariant is
true rather than aspirational. Google's `error` field is also checked against a known
set now, instead of being interpolated as free text.

### Low — `ELECTRON_RENDERER_URL` was honoured in packaged builds

Read unconditionally rather than gated on `isDev`, so an environment variable could
choose the renderer's origin — and that origin was then handed to `IpcRouter` as a
trusted sender. The chain broke anyway, because `applySessionSecurity` is built with a
compile-time `isDev: false` and cancels any non-`app://` main-frame load, so the real
impact was a blank window plus a needlessly wide sender allowlist. Fixed regardless,
since a fuse is already spent defending this exact class of thing.

### Low — `.env.local` was mode 0644

World-readable on a multi-user Mac, and the one place in the working tree holding a
real credential. The desktop client secret is not confidential (§8.9), so this was
hygiene rather than a vulnerability. Now `0600`. Confirmed separately that the file
has never been tracked, and that no secret appears anywhere in the history.

### Low — `will-frame-navigate` was not handled

`will-navigate` is main-frame only. Near-unreachable here, because the CSP sets
`default-src 'none'` and `frame-ancestors 'none'` and there is no frame to navigate,
but it is one line.

---

## Security TODOs — what is actually left

Nothing below is blocking a release. They are ordered by how much they would matter
if something else went wrong.

- [ ] **Read the fuses off the shipped `0.4.0` DMG.** They were verified on an
      installed `0.2.1` bundle and on a local `0.2.0` build, and
      `electron-builder.yml` has not changed since — but the thing that ships has not
      itself been checked. Re-read after any Electron major upgrade too: a new fuse
      defaults to enabled, and the tool prints fuses that an older `@electron/fuses`
      has no name for.
- [ ] **Decide whether `REDACTED_KEYS` earns its place.** `LogContext` is typed as
      scalars only, so no caller can pass a nested object carrying an `access_token`
      key. The set defends against a shape the type system already forbids. Either
      keep it and say so explicitly as belt-and-braces, or remove it and rely on the
      typed context plus `describeError`. What it must not be is a defence that is
      believed to work and does not, which is what it was until this commit.
- [ ] **Rate-limit `settings:update`.** Not in `RATE_LIMITED_CHANNELS`, so a renderer
      with code execution can spin disk writes. No privilege gain, so this is
      robustness rather than security.
- [ ] **Gate `data:` and `blob:` on `isDev`** in `applySessionSecurity`. Currently
      allowed unconditionally; CSP `default-src 'none'` neutralises it, so this is
      tidying an inconsistency between the two locks rather than closing a hole.
- [ ] **Get someone else to look.** Every claim in this document is mine, checked
      against the code by me. There has been no external audit and no penetration
      test. The source, the threat model and the test suite are public so that this
      is checkable rather than trusted, which is the mitigation, not a substitute.
- [ ] **Write down what happens when a dependency advisory lands.** `scripts/audit.ts`
      keeps the audit blocking with dated, justified exceptions, which is the right
      pattern — but there is no stated response time, and no auto-updater to push a
      fix through once one is taken. See the launch checklist on patch delivery.

---

## Verified, with the edge cases probed

Recorded so these are not re-investigated from scratch.

| Claim                                            | Verdict                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sender-origin checks on **every** IPC channel    | Holds. `ipcMain.handle` appears exactly once in the tree and there is no `ipcMain.on` anywhere, so every channel passes all three gates. `CHANNEL_CALLERS` is total, so a new channel cannot compile without a caller list                                                                                                |
| No plaintext token fallback                      | Holds. Both read and write throw before any I/O when `safeStorage` is unavailable. Directory `0700`, file `0600`, `fsync` then `rename`, filename is a SHA-256 of the account id, undecryptable files are deleted rather than left                                                                                        |
| Path traversal in the `app://` handler           | Holds. Probed double-encoding, `%2f`-smuggled traversal, a leading `/`, and null bytes. All rejected                                                                                                                                                                                                                      |
| Host allowlist on external links                 | Holds. Probed backslash tricks, IDN homoglyphs, a trailing-dot host, and `evil.zoom.us.attacker.com`. All rejected. The design is better than the allowlist alone: no URL ever crosses IPC, so the renderer sends an event id and main resolves it                                                                        |
| Log redaction covering **values**, not just keys | **Refuted.** See the High finding, now fixed                                                                                                                                                                                                                                                                              |
| Fuses applied                                    | Holds, read out of the built bundle rather than off the config: `runAsNode`, `enableNodeOptionsEnvironmentVariable`, `enableNodeCliInspectArguments` and `grantFileProtocolExtraPrivileges` off; cookie encryption, ASAR integrity and `onlyLoadAppFromAsar` on. `Info.plist` carries a real `ElectronAsarIntegrity` hash |

Also checked and clean: window hardening across all four windows, the CSP, session
permission handlers, the OAuth flow end to end (PKCE S256, constant-time state
comparison, a `Host` check that rejects `localhost` to block DNS rebinding, one-shot
listener on an ephemeral port), scope minimisation, data minimisation in the event
mapper, the absence of any HTML-injection path (enforced by an ESLint rule), the
settings and TODO stores, the entitlements, the CI workflows (actions pinned by SHA,
`contents: write` only on release, signing material behind an environment gate), and
the supply-chain configuration.

The three weeks of work since `v0.2.1` added surface area and it holds up: the quick-add
window is the only focusable one and is scoped to three channels; `widget:fitHeight`
is the only renderer-supplied number and is bounded by Zod and then re-clamped in main
against the display; the global shortcut accelerator is validated by an allowlist
before `globalShortcut.register` sees it; TODO titles are bounded, counted rather than
logged, and redacted in main when privacy mode is on.

Two things this review could not cover: the `edspressomartini/homebrew-tap` repository,
which is outside this workspace, and the shipped `0.4.0` DMG itself.
