# Khatwa

A habit tracker that measures improvement rather than counting ticks — streaks, XP,
adaptive difficulty and weekly deltas — synchronised with Google Tasks so a habit can be
completed from any device. It runs on the web: Vercel for the app and API, Neon Postgres
for the data.

```bash
npm install
npm run dev        # http://localhost:5173, data in a local Postgres under .data/
```

Google and the AI planner are optional.

**Deploying:** [docs/DEPLOY.md](docs/DEPLOY.md).

**What it does, screen by screen:** [docs/FEATURES.md](docs/FEATURES.md).
**The whole idea and a deep technical walkthrough:** [docs/PROJECT.md](docs/PROJECT.md).

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
┌─ renderer (React 19 + Vite) ──────── static files on Vercel's CDN
│      ↕ POST /api/rpc/<channel>  (fixed channel list, NDJSON stream back)
└─ server (one Vercel function, Node) ─
      http/         router, sessions, RPC table, uploads, OAuth callbacks, cron
      application/  HabitService, ScheduleService, ViewService,
                    RecomputeService, NotificationService, ReminderScheduler
      domain/       pure functions — recurrence, scoring, streaks, XP,
                    levels, difficulty, achievements   (no I/O, time injected)
      sync/         SyncOrchestrator → TaskProvisioner ⇄ TaskSyncer, EventMirror
      google/       OAuth (web + PKCE), TasksClient, CalendarClient, sealed token vault
      persistence/  Neon Postgres, one schema per account + migrations + repositories
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
npm run verify      # typecheck + lint + tests + production build
```

| Command | What it covers |
|---|---|
| `npm run typecheck` | Both projects, strict |
| `npm run lint` | The server, for floating or misused promises |
| `npm test` | Unit, integration and HTTP tests against an in-memory Postgres (PGlite) |
| `npm run build` | The exact output Vercel deploys |

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
mirror, push relay, accounts, all eight screens, light and dark themes.

**Not built** — friend groups, leaderboards and challenges (Phase 3; their screens say so
rather than showing invented data), and the Chrome extension (Phase 4).

Design canvas: the eight screens as artboards, with dark and light modes, live in a
published Artifact — see `design/ui/` for the working files and `design/ui/build.mjs`,
which generates them.
