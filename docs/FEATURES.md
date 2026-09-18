# Adaptive Habit League — what it does

A Windows desktop app that turns daily habits into a measurable progression system.
A checklist tells you whether you ticked a box; this tells you whether you are getting
better — and, when you don't yet know *what* to practise, it helps you build the plan.

Everything works offline. Google and the AI planner are optional add-ons.

---

## The core idea

You define a habit once — what it is, which days it runs, what time, how long. The app
expands that into a concrete entry for every day, scores each one, and derives streaks,
points, XP and a level from the results. Nothing is ever incremented by hand: every
number on screen is recomputed from what actually happened, so un-doing a completion
takes back exactly what it gave, and the whole history can be rebuilt at any time.

The week runs **Saturday to Friday**. Every weekly figure — points, the weekly review,
the weekly target — is measured on that boundary.

---

## Screens

### Dashboard — today

One card per habit scheduled today, showing its time, target duration, current streak,
XP reward and a progress ring.

- **Start / Stop** runs a timer. The card ticks up every second while it runs.
- **Done** marks the habit complete without a timer. It is credited at its target and
  badged `ASSUMED` so hours figures stay honest about where the time came from.
- **Undo** takes a completion back — and takes back its points.
- The header shows the day's score, the week's date range, and your level bar.

### To-do

A daily list with two kinds of entry that share one lifecycle:

- **Manual items** — anything you type. Unfinished ones carry forward to the next day, and
  the app counts how many days an item has been pushed, so chronic avoidance is visible.
- **Habit steps** — sub-tasks attached to one day's habit (e.g. a teaching session's
  *prepare → give → send notes*). Ticking the last step completes the habit; un-ticking a
  step reopens it. A habit can carry a template of steps that every new day arrives with.

Manual items score nothing, deliberately: anything you can type and tick in two seconds
would make XP farmable.

### Habits

Create and edit habits: name, days of the week, time of day, target minutes, baseline
minutes, reminder lead time, notes. Pause a habit rather than deleting it — history is
kept. Difficulty suggestions from the engine (see *Adaptive difficulty*) appear here for
you to accept or dismiss.

### Goals — the AI planner

For when you know *what* you want ("hold a basic conversation in Spanish") but not what
to practise each week. You describe the goal, a target date and how much time per week
you can give it; the planner drafts a plan; you edit it; the app creates real habits and
to-dos from it. A goal is a front door onto the rest of the app, not a separate system —
its sessions are ordinary habits and its milestones are ordinary to-dos, so scoring,
streaks, the calendar, reminders and Google sync all apply.

What a plan contains:

| Part | What it becomes |
|---|---|
| **Sessions** — recurring practice blocks with days, time and duration | One habit each |
| **Milestones** — 3–8 dated, checkable checkpoints | One to-do each, on its date |
| **Mind map** — the goal broken into sub-topics | Kept on the goal, drawn as a tree |
| **Resources** — courses, books, sites, with verified links | Kept on the goal |

How the draft is produced — an agent loop with two roles:

1. **Research.** The model searches the web for current resources and realistic pacing.
2. **Draft.** It writes the plan as strictly structured data, already knowing your
   existing habits' time slots so it does not schedule over them.
3. **Review — the Intervenor.** A supervisor checks the draft before you ever see it:
   plain code finds schedule conflicts against your real habits and checks the weekly
   time budget and milestone dates; every resource link is fetched independently to
   confirm it exists and is on topic (dead or off-topic links are removed, not shown);
   then one separate model call, shown only the finished draft, judges whether the plan
   actually serves the goal.
4. **Revise.** Any problem goes back to the drafter with specific feedback. Up to three
   attempts; if concerns remain, the last draft is shown with them listed for you to judge.

The wizard names each phase as it runs ("Revising, attempt 2 of 3") and lets you edit
every session and milestone before anything is created. On the goal's page you tick
milestones, see each session's streak, and mark the goal **achieved** or **given up** —
which pauses its habits without touching the history or XP already earned.

**Providers.** Bring your own API key for **Anthropic (Claude)** or **Groq**, chosen in
Settings. Keys and models are stored per provider. Calls are billed to your own account
with that provider.

### Calendar

- **Week view** — a time grid, Saturday to Friday, with each habit drawn at its real time
  and sized by its duration, coloured by status. **Click any block to mark it complete or
  undo it — including past days.**
- **Month view** — a grid with per-day dots for completed, partial, missed and upcoming.

### Progress

Eight-week charts: hours per week, completion rate, points per week, average difficulty.
Beside them, the **weekly review**: total time against the previous week, improvement
percentage, tasks completed, consistency, XP, best and weakest habit, plus a written
analysis and one concrete recommendation.

### Performance

The current week in detail, with a **weekly points target** you set:

- points so far against the target, and how many weeks in a row you have hit it;
- a week-by-week strip of recent weeks, each judged hit or missed (the current week is
  "in progress", never a miss);
- day-by-day points with the change against the previous scheduled day;
- best and weakest day; every habit ranked by completion rate with its trend against its
  own previous week;
- a month heat-map.

### Achievements

Eight badges — first 7-day streak, 10 hours, 50 tasks, 100 hours, perfect week, 30-day
streak, beat your previous record, comeback — and personal records: longest streak,
most hours in a week, most points in a week, most productive day.

### Settings

Google account, AI planner provider and key, sync interval, notification channels and
types, theme (dark, light, system), reduced motion, start with Windows, minimise to
tray, every scoring value, and a *recompute all statistics* button that rebuilds every
derived number from the source rows.

---

## The engine

**Scoring.** Full completion +2, partial +1, justified skip 0, missed −1. Bonuses: beat
your weekly target +5, complete your historically worst day +3, seven-day consistency
+10. A skip only costs points when you have not marked it justified. Every value is
editable in Settings.

**Completion tiers.** Logged minutes against target: 100 % is full, 25 % or more is
partial, below that is not started.

**Streaks, XP, levels.** XP per completion scales with difficulty; levels run Beginner →
Consistent → Disciplined → Focused → Elite → Relentless → Formidable and on, on a rising
curve.

**Adaptive difficulty.** Each week, a habit completed 90 % or more of the time gets a
proposal to raise its target; under 70 % a proposal to lower it. Proposals are never
applied automatically — you accept or dismiss them.

---

## Google

Optional. With a Google account connected:

- Each day's habits are written into a **Google Tasks** list, so you can tick them off
  from your phone; the tick syncs back within one poll interval. Ticking here syncs out.
  Un-ticking anywhere takes the points back.
- Reminders reach your phone through a **calendar the app creates** (write-only, and the
  only calendar it can see), because a Google Task on its own fires no timed
  notification on mobile.
- The app never auto-creates habits from Google, so nothing drifts; tasks it did not
  create are left alone.

Why Tasks and not Calendar events, and every limitation of the Tasks API, is written up
in [GOOGLE_SETUP.md](GOOGLE_SETUP.md).

---

## Notifications

Four kinds, each switchable: a habit starts in *N* minutes (default 30, per-habit
override), completion, streak alive, weekly review ready. Three channels: Windows toast,
the mirrored calendar event (phone), and a push relay (ntfy by default, self-hostable).
Reminders survive restarts and sleep, fire at most once, and are dropped rather than
delivered late in a burst.

---

## System

Runs in the tray with today's progress in the tooltip; minimise-to-tray; optional launch
at startup; a desktop shortcut (`npm run shortcut`); dark and light themes.

---

## Commands

```bash
npm run dev         # run from source
npm run build       # production build
npm run dist        # Windows installer
npm run verify      # typecheck + tests + smoke checks
npm run shortcut    # desktop shortcut
```
