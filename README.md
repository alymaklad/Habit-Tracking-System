# Adaptive Habit League

A Windows desktop habit tracker that measures improvement rather than counting ticks —
streaks, XP, adaptive difficulty and weekly deltas — synchronised with Google Tasks so a
habit can be completed from any device.

```bash
npm install
npm run dev
```

The app works completely offline. Google is optional.

---

## Why Google Tasks and not Google Calendar

Google **Calendar events have no completion concept**. Their `status` field is only
`confirmed | tentative | cancelled` — there is no "done" flag, no checkbox, no completion
timestamp. Any app claiming to detect a completed calendar event is inventing it.

**Google Tasks is the only Google resource with real completion semantics**
(`status: needsAction | completed` plus a `completed` timestamp), so that is what drives
the app.

The trade-off is that a Task carries no time of day and no duration — the API discards
them. So the app owns the schedule:

```
App owns:      recurrence, time of day, duration target, difficulty, all analytics
Google Tasks:  the tick — a completion signal that syncs from any device
```

Each day the app writes the matching task into your Google list. Ticking it anywhere
completes the habit here.

A second, write-only scope (`calendar.app.created`, limited to a calendar the app creates)
exists for one reason: a date-only Google Task fires **no timed notification on a phone**,
so reminders are mirrored as timed calendar events. Nothing on that calendar is read back.

Full detail, including every limitation: [docs/GOOGLE_SETUP.md](docs/GOOGLE_SETUP.md).

---

## Architecture

```
┌─ renderer (React 19 + Vite) ──────── UI only, no Node access
│      ↕ contextBridge IPC (fixed channel list)
├─ preload ─────────────────────────── the renderer's entire capability surface
└─ main (Node) ──────────────────────
      application/  HabitService, ScheduleService, ViewService,
                    RecomputeService, NotificationService, ReminderScheduler
      domain/       pure functions — recurrence, scoring, streaks, XP,
                    levels, difficulty, achievements   (no I/O, time injected)
      sync/         SyncOrchestrator → TaskProvisioner ⇄ TaskSyncer, EventMirror
      google/       OAuth (loopback + PKCE), TasksClient, CalendarClient, token vault
      persistence/  SQLite (better-sqlite3) + migrations + repositories
```

Two rules hold the design together:

**The domain layer is pure.** No I/O, no clock — time is injected. That is what makes
scoring deterministic and testable.

**Nothing is ever incremented.** Points, XP, streaks and levels are *recomputed* as pure
functions of the occurrence rows and time logs, then written over what was there. Three
required behaviours fall out of that for free:

- running a sync five times produces a byte-identical database;
- un-ticking a Google task takes back exactly the points it granted, with no compensating
  entry and no phantom XP;
- the entire history can be rebuilt from source rows at any time.

---

## Where time data comes from

Google can tell you *whether* you did something, never *how long*. So:

| Source | Meaning |
|---|---|
| `timer` | Measured by the in-app timer |
| `manual` | Entered by you after the fact |
| `assumed` | Ticked in Google with no timer run — credited at target, and **badged in the UI** |

Assumed entries are visibly marked so hours-improvement figures stay honest about their
provenance.

---

## Verification

```bash
npm run verify      # typecheck + tests + both smoke suites
```

| Command | What it covers |
|---|---|
| `npm run typecheck` | Both projects, strict |
| `npm test` | 167 unit and integration tests, headless |
| `npm run smoke` | 21 end-to-end checks in the real Electron runtime |
| `npm run smoke:ui` | Boots the actual window and asserts the UI mounted |

The tests that matter most: five consecutive recomputes leave the database byte-identical;
reverting a completion keeps measured timer minutes while dropping assumed credit; a
simulated crash between "task created in Google" and "id saved locally" adopts the orphan
instead of duplicating it; the sync watermark advances from the server's clock rather than
the local one; and a date-only Google `due` lands on the correct local day in both
`Africa/Cairo` and `America/New_York`.

---

## Status

**Built** — schedule engine, scoring, streaks, XP and levels, adaptive difficulty,
achievements and personal records, Google Tasks sync (both directions), calendar reminder
mirror, push relay, tray and background sync, all eight screens, light and dark themes.

**Not built** — friend groups, leaderboards and challenges (Phase 3; they need a hosted
backend, and their screens say so rather than showing invented data), and the Chrome
extension (Phase 4).

Design canvas: the eight screens as artboards, with dark and light modes, live in a
published Artifact — see `design/ui/` for the working files and `design/ui/build.mjs`,
which generates them.
