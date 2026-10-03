# Demo video and scope justification

What Google's sensitive-scope review needs, and a shot list for the video.
Written 3 October 2026.

Brand verification passed on 2 October. This is the second, separate review:
the one that removes "Google hasn't verified this app" and lifts the 100-user
cap. Roughly 10 business days once submitted.

---

## The two scopes being justified

| Scope                            | What it is used for                                           |
| -------------------------------- | ------------------------------------------------------------- |
| `calendar.events.readonly`       | Reading today's events to draw the agenda and the countdown   |
| `calendar.calendarlist.readonly` | Listing the user's calendars so they can choose which to show |

Both are read-only. There is no write scope, and no narrower read scope
exists: Google does not offer "today's events only".

---

## Before you record

**Use a throwaway Google account, not your own.** The video goes on YouTube
and gets watched by a reviewer. Your real meeting titles, attendee names and
employer should not be in it. Make a fresh Gmail account, add four or five
invented events for today — "Standup", "Design review", "1:1 with Sam",
"Lunch" — and sign the app in with that.

**Add that account as a test user** if the app is still in Testing, or make
sure it can sign in.

**Check these before hitting record:**

- Screen recording at 1080p or better. QuickTime → File → New Screen Recording
  is enough.
- The browser window is big enough that the **address bar is legible**. This
  is the single most common rejection: the reviewer must be able to read the
  `client_id` in the URL.
- No other windows, no notifications, no Slack. Turn on Do Not Disturb.
- The menu bar is visible throughout, since the countdown lives there.

**One continuous take.** No cuts, no edits, no jump between scenes. Google
asks for this explicitly so a reviewer can see the flow is real. 90 seconds to
three minutes is plenty. Narration is optional; on-screen captions are not
needed.

---

## Shot list

**1. The website.** Start on `https://upnextapp.co.uk/` in the browser, with
the address bar visible. Two or three seconds. This ties the OAuth client to
the verified domain.

**2. The app with nothing connected.** Open Up Next. Show the empty widget and
the Settings window, so it is obvious the data arrives only after consent.

**3. Start sign-in.** Click Connect in Settings. The system browser opens
Google's consent screen.

**4. Hold on the consent screen — the most important shot.** Stay here for at
least five seconds without moving the mouse. The frame must clearly show:

- the **URL bar**, with `client_id=...` readable
- the app name **Up Next** and the logo
- the **list of permissions** being requested

Scroll slowly down the permission list if it does not all fit.

**5. Grant it.** Tick both permissions, continue, and let the browser land on
the "Signed in" page the app serves back on localhost.

**6. `calendar.calendarlist.readonly` in use.** Back in Settings, show the
calendar list that just populated, and tick one off and on again. Say or
caption: _this list is what the calendar-list scope is for._ Without this shot
the reviewer cannot see that scope used at all, which is a common reason for a
second round.

**7. `calendar.events.readonly` in use.** Show the widget now listing today's
events, and the countdown to the next one in the menu bar. Hover an event to
show the detail. This is the core of the product and should get the most time.

**8. Disconnect.** Remove the account in Settings and show the widget emptying.
Demonstrating that access can be withdrawn is worth the ten seconds.

Stop recording. Upload to YouTube as **Unlisted**. Not private — a private
video cannot be watched by the reviewer, and the submission fails silently.

---

## What gets rejected

- The URL bar cropped out, or too small to read the client ID.
- A scope requested but never shown in use.
- Edited or stitched footage.
- A private YouTube link, or one that expires.
- The consent screen shown from a different app or client ID than the one
  under review.

---

## Scope justification text

Paste into the justification box, one per scope.

### `calendar.events.readonly`

> Up Next is a macOS menu-bar widget that displays the signed-in user's own
> schedule for the current day in a small always-visible panel, and counts down
> to their next meeting in the menu bar. It reads events to render that panel
> and that countdown, and to open a meeting's video link when the user clicks
> it. Read-only access is sufficient because the app never creates, edits or
> deletes events. A narrower scope does not exist; Google does not offer an
> events scope limited to a single day. Event data is held in memory only, is
> never written to disk, and never leaves the user's machine: the application
> has no server, no analytics and no third-party services. Tokens are stored
> encrypted via the macOS Keychain.

### `calendar.calendarlist.readonly`

> Users commonly have several calendars and do not want all of them in a small
> always-on-top panel. This scope is used solely to list the calendars on the
> account so the user can choose which ones the widget shows, in the app's
> Settings window. It is also used to identify the account's primary calendar
> address, so that connecting two accounts can be told apart. No calendar
> metadata is transmitted anywhere or persisted beyond the user's choice of
> which calendars to display.

---

## Supporting links for the submission form

| Field          | Value                                  |
| -------------- | -------------------------------------- |
| Home page      | `https://upnextapp.co.uk/`             |
| Privacy policy | `https://upnextapp.co.uk/privacy.html` |
| Demo video     | the unlisted YouTube URL               |

`https://upnextapp.co.uk/security.html` is worth linking in the free-text box
if there is one. It states plainly what is stored, what is not, and who has
access, which is exactly what the reviewer is trying to establish.
