# Khatwa — the whole idea, and how it's built

This document is the deep version. [README.md](../README.md) is the quick tour and
[FEATURES.md](FEATURES.md) is the user-facing feature list; this is the thing to read to
actually understand *why* the system is shaped the way it is, down to the data model and
the AI planner's internals.

---

## Part 1 — The idea

### The problem

A checklist app tells you whether you ticked a box today. It cannot tell you whether
you're getting *better* — whether this week beat last week, whether a habit is trending
up or down, whether the time you're spending on something is actually increasing. Most
habit trackers stop at the checkbox because the checkbox is easy and the measurement is
hard: it requires owning duration, difficulty, and a scoring model that survives being
revised after the fact (you untick something three days later — what happens to the
points you already earned?).

Khatwa is built around answering that second question. Every screen is
in service of one idea: **turn what you did into a number you can compare against what
you did before**, honestly, including when you make mistakes and correct them.

A second, newer idea sits on top of the first: **most people don't start with a
well-formed habit.** They start with a goal — "learn Spanish", "get better at 3D
modelling" — and have no idea what the actual daily practice should look like. The
Goals feature is an AI-assisted front door that turns a goal into the same
well-formed habits and to-dos the rest of the app already knows how to measure.

### The two decisions everything else follows from

**1. Nothing is ever incremented. Everything is recomputed.**

There is no `points` column anywhere that gets `+= 2` when you complete something.
Instead, `daily_record` and `weekly_record` are *caches* of a pure function over the
source rows (`occurrence`, `time_log`). Whenever anything that could affect a day's
score changes — a completion, an untick, a Google sync, a settings change to the
scoring table — the affected date range is recomputed from scratch and the cache rows
are overwritten.

This one decision is why:
- reverting a completion takes back *exactly* the points and XP it granted, with no
  compensating ledger entry and no phantom XP sitting around;
- running the same Google sync payload five times in a row produces a byte-identical
  database, because "apply this change" and "recompute from source" are the same
  operation whether it's the first application or the fifth;
- there's a "recompute all statistics" button in Settings that just works — it deletes
  every cache row and rebuilds them, and if the rebuild is correct then the cache was
  always redundant with the truth in the source tables.

**2. The app owns the schedule; Google is just a completion mirror.**

Early on this looked like it should be a Google Calendar app. It verified out: Calendar
events have no completion field at all (`status` is only
`confirmed | tentative | cancelled`) — an app claiming to detect a "done" calendar event
is inventing that signal. Google **Tasks** has real completion semantics
(`needsAction | completed` plus a timestamp), so that's the sync target — but a Task
has no time of day and no duration; the API discards them. So the split is:

```
App owns:      recurrence, time of day, duration target, difficulty, all analytics
Google Tasks:  the tick — a completion signal that syncs from any device
```

The app expands each habit's recurrence into daily occurrences on a rolling horizon and
writes the matching Google Task each day. A Task carries no timed phone notification
either (date-only tasks are silent), so a second, write-only calendar
(`calendar.app.created` scope, a calendar the app creates and nothing else) mirrors each
occurrence as a timed event purely for the reminder push. Completion is never read from
that calendar — only from Tasks.

---

## Part 2 — Process architecture

Khatwa runs on the web: a static React app on Vercel's CDN, and one Node function that
serves every `/api/*` route. The browser holds no database handle and never sees an
OAuth token; the only way in is a fixed list of RPC channels.

```
┌─ browser (React 19, Vite) ──────────────────────────── static files
│    every action goes through window.api.*  (src/renderer/lib/webApi.ts)
│         ↕ POST /api/rpc/<channel>, JSON args → NDJSON stream back:
│           events while it runs (progress, toasts, dataChanged), then one result
└─ server (one Vercel function — everything privileged lives here)
     http/        router, sealed session cookie, the RPC table, uploads, OAuth, cron
     application/ orchestrates persistence + domain into one coherent operation
     domain/      pure functions only — no I/O, no Date.now(), time is a parameter
     ai/          the Goals planner — Actor/Intervenor loop, provider adapters
     sync/        Google sync state machine
     google/      OAuth (web + PKCE), thin HTTP clients for Tasks/Calendar
     persistence/ Postgres + migrations + repositories (the only SQL in the app)
     platform/    sealed secrets, private attachment store, push relay
```

Each account's data lives in its own Postgres schema. A request opens one connection,
points `search_path` at that schema, and closes it when the response is done — so no
query names a user, and none can forget to.

**The hard rule that makes testing possible:** `domain/` has zero imports from anywhere
else in the app and zero I/O. `recurrence.ts`, `scoring.ts`, `time.ts`, `todo.ts`,
`levels.ts`, `achievements.ts` are all pure functions of their arguments. Every one of
them is tested without a database, a clock, or a mock — you pass in a date, you get a
deterministic answer. This is also why the app's timezone handling is trustworthy: a
Google `due` field comes back as midnight UTC, and converting that through a timezone
naively shifts the date for anyone west of UTC. That bug class doesn't get a chance to
appear because `parseGoogleDue` never calls `.toLocaleDateString()`— it treats the date
portion as an opaque string and never promotes it to an instant.

### The RPC surface

Every channel is a string literal registered once, in one file
([http/rpc.ts](../src/server/http/rpc.ts)), grouped into namespaces that mirror the
browser's `window.api.*` shape:

```
habits · occurrence · timer · view · todo · proposal · goals · ai · settings · google · push · app
```

Two thin wrappers declare them:

```ts
q(fn)   // read-only: call a service, return a value
m(fn)   // q() + afterwards streams `dataChanged` so the browser refetches
```

`mutate` exists because the renderer never tries to predict server state locally — no
optimistic updates, no client-side mirroring of what the database "should" now say.
Every mutation ends with a `dataChanged` event and every screen's `useData` hook
re-fetches. This is slower in theory and has never once caused a bug in practice,
which is the trade a small app should make.

---

## Part 3 — The data model

Seventeen tables per account schema, six migrations, append-only (a shipped migration is never edited —
a fix is a new migration with a new id).

| Table | What it holds |
|---|---|
| `habit` | Definition: recurrence, time, target/baseline minutes, difficulty, `goal_id` |
| `occurrence` | One concrete day of one habit. `UNIQUE(habit_id, date)`. Carries the Google Task/event ids, provisioning state, and `date` as a **local** `YYYY-MM-DD` string, never an instant |
| `time_log` | A measured, manual, or `assumed` span of minutes against an occurrence |
| `daily_record` / `weekly_record` | Derived caches — see Part 1 |
| `difficulty_proposal` | A pending/accepted/rejected suggestion to raise or lower a target |
| `user_achievement` / `personal_record` | Unlocked badges and best-ever numbers |
| `sync_state` / `sync_log` / `pending_op` | Google sync watermark, audit log, outbound queue |
| `oauth_token` | Google tokens, sealed with AES-256-GCM under `APP_SECRET` — plaintext never reaches the database |
| `todo` | Manual items and habit subtasks share one table (see below) |
| `habit_subtask_template` | A habit's default steps, applied to each new occurrence |
| `goal` | Title, target date, weekly budget, status, mind map + resources as JSON |
| `settings` | A single key-value store; `AppSettings` is serialized as one JSON blob under key `'app'`, plus ad-hoc `flag:*` rows for things like API keys that aren't really "settings" |

**Two design choices worth calling out:**

*The `todo` table is one table for two different things on purpose.* A manual item
(owned by a date, carried forward if unfinished) and a subtask (owned by an occurrence,
never carried — moving a step to tomorrow would silently rewrite what happened
yesterday) share a lifecycle: ordering, completion, drop/restore. A CHECK constraint
enforces that a row is exactly one shape or the other. `reconcileOccurrence()` is the
bridge back to habits: finishing every subtask on an occurrence completes the habit;
un-finishing one reopens it and claws the points back — symmetric, because the scoring
engine's "recompute, don't increment" rule applies here too.

*Foreign keys from `goal` use `ON DELETE SET NULL`, never `CASCADE`.* Deleting a goal
must not delete the habits and to-dos it created — it only severs the link. History
belongs to the habit/to-do, not to the goal that happened to spawn it.

---

## Part 4 — The scoring and progression engine

Everything in `domain/scoring.ts` and `application/recomputeService.ts` is a pure
function of the occurrence and time-log rows for a date range:

- **Completion tier** from minutes logged against target: ≥100% full, ≥25% partial,
  below that not-started.
- **Points**: full +2, partial +1, justified skip 0, unjustified miss −1 (a skip only
  costs points if you haven't marked it justified — the app never applies a penalty
  whose reason isn't visible to you). Weekly bonuses: beat your points target +5,
  complete your historically worst weekday +3, seven-day consistency +10.
- **Streaks** walk backward from today through consecutive scheduled-and-completed
  days.
- **XP** scales with a habit's difficulty tier; **levels** (Beginner → Consistent →
  Disciplined → Focused → Elite → Relentless → Formidable → …) sit on a rising XP curve.
- **Adaptive difficulty**: a habit completed ≥90% of its scheduled days in a week gets a
  proposal to raise its target; <70% gets a proposal to lower it. Proposals are
  surfaced, never auto-applied — a suggestion the user didn't consent to isn't
  measurement, it's the app rewriting its own rules.

`origin: 'timer' | 'manual' | 'assumed'` on every `time_log` row is what keeps the
hours-improvement numbers honest: a habit ticked in Google with no timer run is credited
at its target minutes but visibly badged `ASSUMED` in the UI, so a spike in "hours this
week" that's really just phone-ticking is never silently indistinguishable from a
measured spike.

---

## Part 5 — Google sync

One syncer, because there's one API doing real work (Tasks) and one write-only mirror
(Calendar) that's never read from.

**Pull.** The Tasks API has no sync token, so incremental pulls use
`updatedMin = watermark − 5 min` (deliberate overlap) and the watermark advances from
the *maximum `updated` timestamp in the response*, never the local clock — this is what
makes the sync correct across clock skew and safe to replay. ID-keyed upserts plus the
overlap window mean a replayed batch is a no-op, not a duplicate.

**Push.** A local completion enqueues a `pending_op` that PATCHes the task's status.
Conflict rule: if the remote `updated` is newer than the local op's timestamp, the app
does not overwrite — it flags a conflict for you to resolve rather than silently
clobbering whichever side synced last.

**Provisioning is the trickiest part**, because Google assigns task IDs server-side —
there's no way to create one idempotently in a single round trip. The defence is
three-layered: `occurrence` has `UNIQUE(habit_id, date)` plus a `provision_state`;
before creating, an adoption pass looks for an existing task carrying the
`[ahl:<habit_id>]` marker this app writes into every task's notes; and a reconcile sweep
runs on every startup to adopt anything a crash orphaned between "task created in
Google" and "id saved locally".

**Identification of an incoming task**, in order: the stored `google_task_id` (always
wins — renaming a task in Google never breaks the mapping); the `[ahl:...]` marker plus
due date; a normalized-title match as a last resort. The app never auto-creates a habit
from an unrecognized task — that's the one thing that would let duplicate-habit drift
creep in unnoticed.

---

## Part 6 — The Goals feature: an AI planning agent, in depth

This is the newest and most architecturally distinct part of the app, so it gets its
own full treatment.

### The problem it solves, precisely

A habit needs five decisions before it's schedulable: what, how often, what time,
how long, at what difficulty. "Learn Spanish" answers none of them. The Goals wizard's
job is to turn one underspecified sentence into those five decisions for several
sessions plus a handful of dated milestones — and to do it *safely*, meaning the result
must never silently conflict with what you already do, must never hand you a citation
that doesn't exist, and must never be a black box you can't edit before it takes effect.

### Why a goal is not a new scheduling concept

The single most important design decision here: **a goal produces ordinary habits and
ordinary to-dos.** `goalService.commit()` calls the exact same `habitService.create()`
and `todoService.addManual()` that the Habits and To-do screens call. This means:

- scoring, streaks, XP, the calendar, reminders, and Google sync apply to a goal's
  sessions automatically — zero new code in any of those layers;
- "pause a goal" is just `habits.setActive(false)` on the habits it created (confirmed
  by reading `scheduleService.expandHorizon`, which only iterates active habits — no new
  "goal is paused" branch was needed anywhere);
- deleting a goal (`ON DELETE SET NULL`, see Part 3) never deletes the history it
  produced.

A `goal_id` column on `habit` and `todo` is the entire footprint this feature has on the
existing schema. Everything else is additive: one new table (`goal`), one new service,
one new IPC namespace.

### The planning pipeline: Actor, Intervenor, Reflexion

Producing the plan itself is not a single model call — a bare "here's a goal, give me
JSON" call would happily schedule a session on top of your existing Workout habit, or
cite a URL that resolves to a parked domain. The pipeline is three roles:

```
Actor.research(goal, context)      tools: web_search        → free-text findings
Actor.finalize(findings, feedback?) structured output       → draft GoalPlan
Intervenor.review(draft, context)
   ├─ scheduleConflicts()   pure code, no model — sessions vs. your real occurrences
   ├─ resourceVerifier()    independent fetch per resource URL — does it even resolve
   └─ critique()            one cold model call, shown ONLY the finished draft
   PASS → return   |   FAIL → feedback fed back into Actor.finalize()   |   cap 3 → return with warnings
```

**Actor** proposes and revises; it never judges its own output. **Intervenor** inspects,
corrects, constrains, and redirects, but never writes a single word of the plan — its
four possible verdicts are accept, fix-in-place (drop one dead link, ask for a
replacement — not fail the whole draft), redirect (specific feedback, another attempt),
and halt (iteration cap reached, return the last draft with the unresolved concerns
listed so you can judge them, rather than loop forever chasing a "perfect" plan that's
ultimately your subjective call anyway).

**Why the deterministic check runs before the model-based one:** a schedule conflict
between a proposed session and your actual `Workout` habit is *certain* — plain
arithmetic on two time ranges, computed in `scheduleConflicts.ts` with no model
involved. An LLM asked to self-review "did I create a conflict?" is right most of the
time and wrong some of the time. Running the free, certain check first means the
expensive, fallible check (the critique call) is never spent discovering something code
already knew for free — and it means a plan can be rejected for a hard conflict without
burning a model call at all.

**Why link verification is a separate fetch, never the model's word for it.** A model
can misremember a URL between its research turn (where it actually saw the search
result) and its structured-output turn (where it reconstructs the plan from memory) —
this is a well-known failure mode, not a hypothetical. So every resource with a URL is
independently fetched by the Intervenor and judged for topical relevance in one batched
call (not one call per link — see the cost note below); a dead or off-topic link is
stripped to `null` in place, with a note asking the drafter for a replacement, rather
than failing the entire plan over one bad citation.

**Two-phase Actor, and why.** Structured output (a schema-locked JSON response) and live
tool use don't compose cleanly in one turn — you can't ask a model to both call
`web_search` and simultaneously guarantee its response matches a fixed schema in the
same request. So research (tools on, free-form text out) and finalize (tools off,
schema-locked out) are two separate calls; research runs once per goal, finalize runs
once per Reflexion iteration.

### Ports and adapters — how two LLM providers share one loop

The loop, the Intervenor, and the entire wizard UI depend on one interface:

```ts
interface AiClient {
  research(prompt): Promise<string>
  finalize(prompt): Promise<RawGoalPlan>
  critique(prompt): Promise<Critique>
  fetchPage(url): Promise<FetchedPage>
  judgeRelevance(pages, topic): Promise<boolean[]>
}
```

[anthropicClient.ts](../src/server/ai/anthropicClient.ts) implements this against Claude
(native `web_search` / `web_fetch` server-side tools, `messages.parse()` for guaranteed
schema-valid output). [groqClient.ts](../src/server/ai/groqClient.ts) implements the exact
same interface against Groq's OpenAI-compatible endpoint — which has none of those
niceties, so the adapter absorbs the differences:

- **No native web fetch** → a plain `fetch()` plus one extra structured call to judge
  which of the fetched pages are relevant.
- **Groq's `groq/compound` system supplies search but sometimes refuses requests with an
  unexplained `413`** → research tries `groq/compound` → `groq/compound-mini` → the
  plan model with no search at all (told plainly it has none, and warned to only give a
  URL it's confident actually exists) — and even in that last, search-less case, every
  link it produces still goes through the same independent fetch-and-judge check before
  it reaches you.
- **Free-tier per-minute token limits are an order of magnitude tighter than
  Anthropic's** → output caps are small, a 413's error body (which names the exact limit
  and what was requested) is parsed to shrink the request and retry once, and a 429 is
  retried honoring the server's `retry-after` header before surfacing as an error.
- **Reasoning models (`gpt-oss-*`) spend output budget on private reasoning before
  answering** → `reasoning_effort: "low"` is set by default, since the Reflexion loop
  already supplies the second-guessing this app needs.

None of this is visible to `goalService`, the wizard, or the tests that exercise the
loop — they all depend on `AiClient`, and a `FakeAi` test double satisfies the same
interface with zero network calls, the same pattern the Google sync tests use
(`FakeGoogle` standing in for the real Tasks API).

[providers.ts](../src/server/ai/providers.ts) is the single place a provider is
registered — label, default model, key placeholder, factory function. Settings reads
that registry to render the provider picker; adding a third provider is one new adapter
file plus one entry there, nothing else.

### The Reflexion loop's honesty about its own cost

A worst case is 3 iterations × (research + finalize + critique) = up to 9 model calls,
plus one fetch and one judgement call for the resources. This is stated in the wizard
UI as a labeled progress indicator ("Revising, attempt 2 of 3") rather than a bare
spinner, because a feature that can silently take a minute needs to say so.

---

## Part 7 — Stack and why

| Piece | Choice | Why |
|---|---|---|
| Hosting | Vercel (Build Output API) | Static app on the CDN plus one Node function; the build writes the output format itself, so nothing is left to framework detection |
| UI | React 19 + Vite | No exotic requirement; hand-rolled inline `<svg>` for every chart and the mind map rather than a charting library — the app's few dozen visualizations don't justify the dependency |
| DB | Neon Postgres (`@neondatabase/serverless`) | One schema per account for isolation by construction; tests run the same SQL on PGlite, an in-memory Postgres |
| Accounts | Neon Auth | Email + password and Google, with the session kept server-side in a sealed cookie |
| Validation | `zod` | Every untrusted payload is parsed against a schema before it touches the database — a Google API response, and now an LLM's JSON, are both "external input that might not be what it claims to be" |
| Dates | `luxon` | IANA timezone-correct arithmetic; `date-fns`/native `Date` timezone handling is exactly the class of bug (see Part 2) this app cannot afford |
| AI | `@anthropic-ai/sdk` (Anthropic path) + raw `fetch` (Groq path) | The SDK's `messages.parse()` + Zod output format is materially better than hand-rolling JSON extraction from a text response; Groq's OpenAI-compatible API needed no SDK, just careful error handling |

---

## Part 8 — Testing philosophy

All tests headless and offline, against an in-memory Postgres (PGlite). Nothing hits a real network — Google is
substituted by [`FakeGoogle`](../tests/fakeGoogle.ts), an in-memory stand-in that
reproduces the real API's actual constraints (server-assigned ids, date-only `due`,
`updatedMin` filtering) rather than a mock that just returns canned data; the AI layer
is substituted by [`FakeAi`](../tests/fakeAi.ts) the same way, and the Groq adapter
specifically is tested against a scripted `fetch` implementation that plays back real
Groq error-response shapes (`413` with the limit/requested numbers in the body, `429`
with `retry-after`) so the retry and shrink logic is verified against the actual
contract, not an idealized one.

The tests that matter most, because they'd be the hardest bugs to catch by hand:

- five consecutive recomputes over the same data leave the database byte-identical;
- reverting a completion takes back exactly the points it granted — no drift, no
  residue;
- a simulated crash between "task created in Google" and "id saved locally" is adopted
  on the next reconcile pass instead of duplicated;
- a date-only Google `due` field lands on the correct local calendar day in both
  `Africa/Cairo` and `America/New_York` — the two timezones on either side of UTC that
  would expose an off-by-one-day bug in either direction;
- the Goals Intervenor rejects a schedule conflict without ever spending a model call
  to discover it, and the Reflexion loop halts at its iteration cap with the unresolved
  feedback surfaced rather than looping indefinitely.

```bash
npm run verify   # typecheck + lint + tests + production build
```
