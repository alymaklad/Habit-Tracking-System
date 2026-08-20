# Connecting Google

The app works fully without Google — habits, timer, scoring, streaks, charts and desktop
reminders all run locally. Connecting Google adds two things: ticking a habit from your
phone, and reminders that reach your phone.

You need your own Google Cloud project. It takes about ten minutes, once.

---

## 1. Create a project and enable the APIs

1. Go to [console.cloud.google.com](https://console.cloud.google.com) and create a project
   (any name).
2. Enable **both** APIs under *APIs & Services → Library*:
   - **Google Tasks API**
   - **Google Calendar API**

## 2. Configure the consent screen

*APIs & Services → OAuth consent screen*

- User type: **External**
- Fill in the app name and your own email for both contact fields.
- Add the two scopes the app uses, and no others:

| Scope | What it allows |
|---|---|
| `https://www.googleapis.com/auth/tasks` | Read and update your tasks |
| `https://www.googleapis.com/auth/calendar.app.created` | Create a calendar and manage events **on that calendar only** |

> **Set publishing status to "In production".**
>
> This is the one setting that will bite you if you skip it. While the consent screen is
> in **Testing**, Google revokes the refresh token after **7 days**, and the app will ask
> you to reconnect every week. Switching to *In production* removes that. The app stays
> unverified, which is fine for personal use — you will see a "Google hasn't verified this
> app" screen on first connect. Click *Advanced → Go to (app name)*.

## 3. Create a Desktop app client

*APIs & Services → Credentials → Create credentials → OAuth client ID*

- Application type: **Desktop app**
- Copy the **Client ID**. The client secret is optional; installed apps cannot keep
  secrets, and this app uses PKCE to protect the exchange.

## 4. Connect

Open **Settings → Google account**, paste the client ID, save, then click **Connect
Google**. Your browser opens Google's consent screen; approve, and the tab tells you to
come back.

The app never sees your Google password. Tokens are encrypted with Windows DPAPI and
stored locally; they never cross into the app's UI process.

---

## What each permission is for

**`tasks` — the completion signal.**
This is the only Google resource that has one. A Google Task has
`status: needsAction | completed` and a completion timestamp. The app creates one task per
scheduled day, and reads back whether you ticked it.

**`calendar.app.created` — reminder delivery only.**
Google Tasks notifications are Google Calendar notifications underneath, and a task with a
date but no time becomes an all-day entry that fires **no timed push**. The Tasks API
cannot write a time. So to make "German starts in 30 minutes" reach your phone, the app
mirrors each occurrence as a timed event — with a popup reminder — onto a secondary
calendar **it creates itself**, named *Adaptive Habit League*.

That scope cannot see or touch your existing calendars. Nothing on that calendar is ever
read back to decide whether a habit was done.

---

## Limitations, stated plainly

1. **Completion detection uses Google Tasks, not Google Calendar.** Calendar events have
   no completion field in the API — there is no "done" flag to read. That is a Google
   limitation, not a design choice.

2. **Google Tasks cannot store a time of day or a duration.** The app owns both and writes
   them into the task's notes (`18:00 · 2h target`) so they are readable on your phone.

3. **Task recurrence is not exposed by the Tasks API.** The app generates one task per day
   itself, over a rolling horizon you set in Settings, rather than relying on Google's
   repeat feature.

4. **Sync is polling-based.** The Tasks API offers no push notifications of any kind, so a
   completion you make elsewhere is detected within one poll interval — five minutes by
   default — not instantly.

5. **The app must be running to sync.** It lives in the system tray and syncs in the
   background; if the machine is off, changes are picked up next time it starts.

---

## Push notifications for streaks and reviews (optional)

A calendar reminder can only say "this starts soon". Notifications the app decides for
itself — your streak is alive, the weekly review is ready — have no calendar equivalent,
so they go through a relay instead.

1. Install [ntfy](https://ntfy.sh) on your phone (free, open source; Pushover and Telegram
   work the same way if you prefer).
2. Subscribe to a topic. **Pick something long and random** — a topic is effectively a
   shared secret, and on the public server anyone who guesses it can read it.
3. Enter the same topic in **Settings → Notifications → Push relay**, then **Send test**.

---

## Verifying it end to end

Once connected:

1. Create a habit — say *Study AI*, Mon–Fri, 18:00, 2 hours.
2. Open Google Tasks on your phone. Today's *Study AI* should be there, with
   `18:00 · 2h target` in the notes.
3. Tick it on the phone.
4. Within one poll interval the card flips to **completed**, XP is awarded and the streak
   moves.
5. Untick it. The points come back off — and any time you measured with the in-app timer
   is kept.
6. Turn off your network mid-use. The app keeps working; changes queue and flush when the
   connection returns.

---

## Disconnecting

**Settings → Google account → Disconnect** revokes the token with Google and deletes the
local copy. Your habit history is kept — erasing it is a separate, explicit action.
