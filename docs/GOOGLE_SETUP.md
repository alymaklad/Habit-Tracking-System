# Connecting Google

The app works fully without Google — habits, timer, scoring, streaks, charts and browser
reminders all run without it. Connecting Google adds two things: ticking a habit from your
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

## 3. Create a Web application client

*APIs & Services → Credentials → Create credentials → OAuth client ID*

- Application type: **Web application** (a Desktop client cannot redirect to an `https`
  site, so the desktop build's client will not work here).
- **Authorised redirect URIs:** `https://<your-site>/api/google/callback` — add one per
  domain you use, plus `http://localhost:5173/api/google/callback` for development.
- Copy the **Client ID** and **Client secret**.

## 4. Give them to the server

On Vercel: **Project → Settings → Environment Variables**

```
GOOGLE_CLIENT_ID=…apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=…
```

and redeploy. Locally, put the same two lines in `.env.local`. The secret stays on the
server; the browser only ever sees Google's consent page.

## 5. Link

Users open **Settings → Google Calendar** and click **Link Google Calendar**. The page
goes to Google's consent screen; they approve, and Google sends them straight back.

The app never sees your Google password. Tokens are sealed (AES-256-GCM, keyed by the
server's `APP_SECRET`) before they reach the database, and never reach the browser.

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
calendar **it creates itself**, named *Khatwa*.

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

5. **Sync runs while Khatwa is open, and once a day otherwise.** An open tab syncs on
   your interval; a daily server job covers everyone else. (On Vercel Pro the cron can run
   every few minutes — see docs/DEPLOY.md.)

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

---

## Disconnecting

**Settings → Google Calendar → Unlink** revokes the token with Google and deletes the
stored copy. Your habit history is kept — erasing it is a separate, explicit action.
