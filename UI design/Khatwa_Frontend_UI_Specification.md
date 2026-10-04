# Khatwa --- Frontend UI Implementation Specification

**Product:** خطوة --- Khatwa\
**Tagline:** One step at a time.\
**Document purpose:** Complete frontend/UI specification for
implementing the Khatwa web/desktop and native mobile interfaces from
the approved Stitch designs.

------------------------------------------------------------------------

## 1. Product Experience

Khatwa is a personal growth application built around a simple idea:

> **You are climbing toward a life you want, one step at a time.**

The UI should make four questions immediately understandable:

  Area        User question                      Core metaphor
  ----------- ---------------------------------- -------------------------
  Today       What is my next step?              👣 Step
  Mountains   Where am I going?                  🏔 Mountain
  Journey     Where have I been?                 🗺 Journey / memory wall
  Me          Who am I becoming?                 👤 Identity
  Let Go      What am I carrying?                🎒 Backpack
  Journal     What am I learning about myself?   📖 Journal
  Tools       What helps me climb?               🧰 Tools

The product should feel like a **personal growth journal and life map**,
not a conventional productivity dashboard.

------------------------------------------------------------------------

# 2. Approved Visual Direction

## 2.1 Design language

Use the approved **Vellum & Intention** visual system:

-   tactile editorial minimalist
-   warm vellum / paper surfaces
-   subtle physical artifacts
-   literary typography
-   restrained natural colors
-   thin ledger-like rules
-   small imperfections
-   calm, contemplative interaction
-   no dopamine-heavy gamification
-   no glassmorphism
-   no neon SaaS aesthetic

The visual metaphor is:

> **A carefully kept personal journal, combined with a map of the user's
> life.**

Physical materials can appear as:

-   paper
-   vellum
-   card stock
-   cork
-   tape
-   pins
-   photographs
-   ink
-   stamps
-   journal lines
-   trail markers

Do not make every screen look like a scrapbook. Functional screens
should remain clean.

------------------------------------------------------------------------

# 3. Design Tokens

## 3.1 Colors

### Core

  Token                         Hex         Usage
  ----------------------------- ----------- -------------------------
  `surface`                     `#FFF8F3`   Main vellum background
  `surface-dim`                 `#E0D9D2`   Dimmed surfaces
  `surface-container-low`       `#FAF2EB`   Light paper surfaces
  `surface-container`           `#F4EDE6`   Main card stock
  `surface-container-high`      `#EEE7E0`   Recessed surfaces
  `surface-container-highest`   `#E9E1DB`   Stronger recessed areas
  `on-surface`                  `#1E1B17`   Primary text
  `on-surface-variant`          `#424844`   Secondary text
  `outline`                     `#727973`   Secondary borders
  `outline-variant`             `#C2C8C2`   Light borders

### Brand / semantic

  Token                   Hex         Usage
  ----------------------- ----------- -------------------------------
  `primary`               `#284636`   Deep forest
  `primary-container`     `#3F5E4D`   Laurel forest / active growth
  `on-primary`            `#FFFFFF`   Text on primary
  `secondary`             `#914B2C`   Terracotta / warm accent
  `secondary-container`   `#FDA27D`   Soft terracotta
  `tertiary`              `#334156`   Slate / reflective accent
  `tertiary-container`    `#4A586E`   Slate indigo
  `error`                 `#BA1A1A`   Actual errors only

Recommended visual usage:

-   **Forest green:** growth, active states, forward movement, completed
    actions.
-   **Terracotta:** important CTA, breakthrough, milestone, intention.
-   **Slate:** reflective/archive states.
-   **Carbon ink:** primary typography.
-   **Vellum/cream:** environment and paper.

Avoid making green/red behave like a punitive success/failure system.

------------------------------------------------------------------------

# 4. Typography

Use:

-   **Newsreader** for editorial / reflective headings.
-   **Plus Jakarta Sans** for functional UI.

### Type scale

  Style                Font                  Size   Line height
  -------------------- ------------------- ------ -------------
  Hero                 Newsreader            48px          56px
  Hero mobile          Newsreader            36px          44px
  Headline LG          Newsreader            32px          40px
  Headline LG mobile   Newsreader            26px          34px
  Headline MD          Newsreader            22px          30px
  Headline SM          Jakarta Sans          18px          26px
  Body LG              Jakarta Sans          16px          26px
  Body MD              Jakarta Sans          14px          22px
  Reflective           Newsreader italic     16px          24px
  Stamp                Newsreader            12px          16px
  UI label             Jakarta Sans          12px          16px
  Caption              Jakarta Sans          11px          15px

Use uppercase tracking for archival/stamp labels.

------------------------------------------------------------------------

# 5. Layout

## Desktop

-   Desktop breakpoint: `>1025px`
-   12-column layout
-   max content width around 1120px for journal-oriented views
-   generous outer vellum space
-   large visual compositions on Journey/Mountains
-   desktop sidebar for primary navigation

## Tablet

-   `641px–1024px`
-   fluid 6-column layout
-   avoid dense side-by-side panels when width is insufficient

## Mobile

-   `<640px`
-   single column
-   20px horizontal page margin
-   12px internal gutter
-   thumb-friendly controls
-   bottom navigation
-   bottom sheets for secondary actions
-   progressive disclosure

Do not simply stack desktop screens. Mobile layouts must be designed
intentionally.

------------------------------------------------------------------------

# 6. Physical UI Treatment

## Surfaces

### Flat paper

-   background: `#FBF8F3`
-   1px hairline rule
-   minimal/no shadow

### Card stock

-   `#F6F1EA`
-   1px `#EFE8DD`
-   subtle ambient shadow

### Recessed / docket

-   `#EFE8DD`
-   inset shadow

### Floating / pinned

-   white/warm surface
-   stronger soft shadow
-   used for modal, toolbar, bottom sheet, drag state

Avoid glassmorphism and glowing shadows.

------------------------------------------------------------------------

# 7. Component Language

## Buttons

### Primary

Wax-stamp feeling.

-   forest or terracotta fill
-   vellum text
-   1px tonal border
-   pressed state uses inset compression

### Secondary

Ruled-line button:

-   transparent
-   charcoal border
-   charcoal text
-   subtle paper fill on hover/press

### Ghost

Text-only action with subtle underline/dashed accent.

------------------------------------------------------------------------

## Inputs

Avoid clinical form controls where possible.

Use:

-   warm paper input surfaces
-   notebook-style underline
-   Newsreader italic placeholder for reflective inputs
-   forest focus line
-   no glowing focus ring

------------------------------------------------------------------------

## Checkboxes / completion

Use physical ink metaphors:

-   ink dot
-   diagonal slash
-   filled ink square
-   organic green/ochre completion

Do not use oversized generic SaaS checkmarks.

------------------------------------------------------------------------

## Cards

Cards should look like paper stock, not glossy UI panels.

Use:

-   hairline header rules
-   subtle shadows
-   restrained corner radius
-   optional tape/pin for journal/memory content

------------------------------------------------------------------------

# 8. Global Navigation

## Desktop primary navigation

Recommended primary navigation:

-   Today
-   Journey
-   Mountains
-   Me

Secondary:

-   Habits
-   To-do
-   Calendar
-   Progress
-   Achievements
-   Let Go
-   Journal
-   Settings

The exact placement can remain contextual, but the four core
destinations should remain visually primary.

## Mobile bottom navigation

Use only:

1.  Today
2.  Journey
3.  Mountains
4.  Me

Do not overload the bottom bar.

Access secondary features through contextual screens / Me.

------------------------------------------------------------------------

# 9. TODAY

## Purpose

Answer:

> **What is my next step?**

This is the most functional screen.

## Desktop

Header:

-   Good morning, Aly.
-   date
-   current day

Primary area:

### YOUR NEXT STEP

Example:

**AI Research & Paper Synthesis**

60 minutes

`[ START SESSION ]`

Then:

**Moves you toward**

🏔 Become an AI Engineer

Below:

### TODAY

List scheduled habits/tasks.

Each item can show:

-   name
-   scheduled time
-   duration target
-   current status
-   current streak
-   completion control
-   start/stop timer
-   undo when completed

Supporting information:

-   today's score
-   week range
-   level / XP
-   progress toward weekly target

Keep these secondary.

## Mobile

Make the next step dominant.

Recommended order:

1.  greeting/date
2.  next step
3.  mountain connection
4.  today's remaining actions
5.  small progress summary

------------------------------------------------------------------------

# 10. ACTIVE SESSION

When a user starts a timed habit:

Show:

-   habit name
-   elapsed timer
-   target duration
-   pause
-   complete
-   mountain connection

Example:

**AI RESEARCH**

`00:42:18`

`[ Pause ]`

`[ Complete ]`

Moves you toward:

🏔 Become an AI Engineer

Keep the screen distraction-free.

------------------------------------------------------------------------

# 11. TO-DO

To-do contains two types:

### Manual items

-   user-created task
-   unfinished items carry forward
-   show number of days pushed
-   do not award XP merely for typing/ticking arbitrary manual tasks

### Habit steps

-   substeps attached to a habit
-   example: prepare → session → send notes
-   ticking the final step completes the habit
-   un-ticking a step reopens it

UI must distinguish:

-   manual
-   habit step
-   completed
-   carried forward
-   overdue

------------------------------------------------------------------------

# 12. HABITS

## Habit list

Each habit should show:

-   name
-   active/paused
-   schedule
-   time
-   target duration
-   baseline duration
-   current streak
-   completion state
-   difficulty
-   optional notes

Actions:

-   create
-   edit
-   pause
-   resume

Never delete historical data through ordinary UI.

## Adaptive difficulty

If the engine suggests a change:

Example:

> You've completed this habit 94% of the time.
>
> Consider increasing 30 → 40 minutes.

Actions:

`[ Accept ] [ Dismiss ]`

Never apply automatically.

------------------------------------------------------------------------

# 13. HABIT DETAIL

Show:

-   habit name
-   schedule
-   target
-   baseline
-   difficulty
-   current streak
-   completion history
-   time invested
-   weekly trend
-   recent sessions
-   adaptive difficulty suggestion

Keep it readable rather than dashboard-heavy.

------------------------------------------------------------------------

# 14. MOUNTAINS

## Purpose

Answer:

> **Where am I going?**

This is one of Khatwa's signature experiences.

A Mountain is a major life transformation, not a small task.

Examples:

-   Become an AI Engineer
-   Learn German
-   Build a Strong Body
-   Build My Company

## Mountains landing

Show multiple mountains as visual landscapes.

Each mountain should show:

-   title
-   current position
-   overall progress
-   next milestone
-   target date

Do not make them generic progress cards.

------------------------------------------------------------------------

# 15. MOUNTAIN DETAIL

The mountain/landscape should dominate.

Example trail:

``` text
                         SUMMIT
                           🏁
                            ●
                           /
                      ●────
                    VLM Project
                          \
                           \
                       ●────
                  Computer Vision
                           \
                            \
                         ●
                     YOU ARE HERE
                            \
                             \
                              ●
                            START
```

Trail markers:

-   completed
-   current
-   upcoming

Supporting panel/content:

### Current step

Build VLM pipeline

### Next milestone

Deploy first multimodal system

### Target

December 2027

Additional expandable sections:

-   habits
-   sessions
-   resources
-   obstacles
-   backpack
-   tools

------------------------------------------------------------------------

# 16. MOUNTAIN PLANNING / CREATE GOAL

Goal creation is presented as **choosing a mountain**, not merely
creating a database goal.

## Step 1 --- Choose Your Mountain

Show:

**CHOOSE YOUR MOUNTAIN**

> What do you want to achieve?

Input.

Optional context:

> Tell Khatwa a little more.

Inputs:

-   goal description
-   additional context
-   target date
-   available time per week

CTA:

`[ Begin the climb → ]`

------------------------------------------------------------------------

# 17. AI GOAL PLANNER

The planning pipeline has visible stages:

1.  Understanding your destination
2.  Researching the path
3.  Designing your milestones
4.  Reviewing the route

If revision happens:

> Revising --- attempt 2 of 3

Never use only an unexplained spinner.

The interface should make the AI process understandable.

The actual planner may:

-   research current resources
-   draft sessions
-   create milestones
-   account for existing habit schedules
-   check schedule conflicts
-   check weekly time budget
-   verify resource links
-   review the generated plan
-   revise up to three times

------------------------------------------------------------------------

# 18. YOUR MOUNTAIN IS READY

Show a large mountain landscape.

Then summarize:

-   milestone count
-   habit/session count
-   resource count
-   weekly time commitment
-   target date

CTA:

`[ Review your trail → ]`

------------------------------------------------------------------------

# 19. REVIEW YOUR TRAIL

User must be able to edit before committing.

Editable:

-   milestones
-   sessions
-   dates
-   times
-   durations
-   habits
-   resources
-   order

Do not use a spreadsheet.

Keep the mountain visible as a visual anchor.

Primary:

`[ Take your first step → ]`

Secondary:

`[ Save draft ]`

------------------------------------------------------------------------

# 20. MOUNTAIN OBSTACLES

Obstacles represent things standing in the way.

Examples:

-   procrastination
-   distraction
-   lack of consistency
-   fear of starting
-   uncertainty about what to learn

They should appear symbolically in the landscape.

Do not make them enemies or game objects.

------------------------------------------------------------------------

# 21. JOURNEY

## Purpose

Answer:

> **Where have I been?**

Journey is a record of transformation.

## Desktop

Use a spatial memory wall / corkboard.

Include:

-   monthly notes
-   photographs
-   achievements
-   milestones
-   journal entries
-   quotes
-   documents
-   artifacts
-   sketches
-   reflections

Allow:

-   pan
-   zoom
-   add memory
-   add photo
-   add reflection
-   add milestone
-   open memory

Objects can have slight rotation and overlap.

The more the user uses Khatwa, the richer the board should become.

## Mobile

Do not shrink the desktop canvas.

Use a vertical memory timeline.

Each month should show:

-   month
-   title
-   one or more photos
-   short reflection
-   key moments
-   Open Month action

------------------------------------------------------------------------

# 22. MONTHLY MEMORY

A monthly journal page should show:

### What I Did

Hours / sessions / milestones.

### What I'm Proud Of

Free reflection.

### What I Learned

Free reflection.

### What Was Difficult

Free reflection.

### What's Next

Free reflection.

### Memories

Photos / artifacts.

Optional:

### What I Left Behind

Let Go summary.

Do not turn this into an analytics dashboard.

The purpose is:

> **How did I change during this month?**

------------------------------------------------------------------------

# 23. JOURNAL

## Purpose

The Journal is a private reflection space.

It is not primarily an AI feature.

Main screen:

**JOURNAL**

> What's on your mind?

`[ Write a reflection... ]`

Quick prompts:

-   How am I feeling?
-   What felt difficult today?
-   What am I proud of?
-   What is getting in my way?
-   How do I feel about my Mountain?
-   What do I need right now?

Recent entries should look like journal fragments.

Use paper, handwriting accents, dates, tags and subtle artifacts.

------------------------------------------------------------------------

# 24. DAILY REFLECTION

Keep it lightweight.

Possible fields:

### How am I feeling?

-   good
-   okay
-   low
-   stressed
-   exhausted

### What felt difficult today?

Free text.

### Did I take a step toward my Mountain?

-   Yes
-   A little
-   Not today

Do not force a long journal entry every day.

------------------------------------------------------------------------

# 25. DEEP REFLECTION

Use for consequential moments:

-   relapse
-   major breakthrough
-   feeling stuck
-   milestone
-   major emotional reaction to a goal

Possible prompts:

-   What happened?
-   What were you feeling?
-   What happened immediately before?
-   What did you need?
-   What would you like to try next time?
-   How do you feel about your Mountain?

------------------------------------------------------------------------

# 26. LET GO

## Purpose

Answer:

> **What am I carrying?**

Let Go helps users reduce behaviors they want to stop or change.

Avoid the phrase "bad habits" in the UI.

Use:

> **Let Go**

or:

> **Habits to Leave Behind**

The experience should never shame the user.

------------------------------------------------------------------------

# 27. BACKPACK

The Backpack is a persistent visual object.

It represents behaviors that make the climb harder.

Examples:

-   late-night scrolling
-   procrastination
-   excessive gaming
-   skipping workouts
-   constant notification checking
-   staying up too late

The behavior should visually exist inside the Backpack.

Do not assign arbitrary kilograms.

Use symbolic weight:

-   light
-   medium
-   heavy

based on visual treatment, not a fake numerical measurement.

The Backpack should appear alongside a Mountain where useful.

------------------------------------------------------------------------

# 28. LET GO HUB

Mobile screen:

**LET GO**

Subtitle:

> What are you ready to leave behind?

Show:

### Your Expedition Pack

Example:

-   3 items packed
-   1 ready to leave at pass

Each item:

-   name
-   symbolic weight
-   freedom rate
-   current streak
-   related Mountain

CTA:

`[ Add something to let go ]`

Also show a subtle Guide insight when one exists.

------------------------------------------------------------------------

# 29. CREATE LET-GO BEHAVIOR

Ask:

### What are you ready to leave behind?

Example:

> Late-night scrolling

Then:

### When does it usually happen?

-   morning
-   work/study
-   evening
-   before sleep
-   boredom
-   stress
-   other

### What usually triggers it?

Free text.

### What would you like to do instead?

Possible alternatives:

-   read
-   walk
-   journal
-   sleep
-   work on goal
-   custom

### Which Mountain does this help?

Example:

🏔 Become an AI Engineer

CTA:

`[ Put it in my backpack ]`

------------------------------------------------------------------------

# 30. GREEN-X CALENDAR

This is the core Let Go tracker.

Each day records whether the user successfully left the behavior behind.

Visual language:

-   green X / green mark = behavior resisted
-   today = distinct dot/current marker
-   future = neutral
-   relapse = neutral/non-punitive state

Example summary:

> **18 of 24 Days Free**

Also:

-   current streak
-   best streak
-   freedom rate

Do not make a relapse reset all progress.

The calendar represents:

> **days I chose differently.**

------------------------------------------------------------------------

# 31. DAILY LET-GO CHECK-IN

Ask:

> Did you leave this behavior behind today?

Actions:

`[ Yes ] [ No ]`

If yes:

-   record successful day
-   allow optional short note

If no:

show:

> Let's understand what happened.

Ask optionally:

### What happened before the urge?

Free text.

### What were you feeling?

-   stressed
-   bored
-   tired
-   lonely
-   overwhelmed
-   frustrated
-   other

### What did you actually need at that moment?

Free text.

Do not force this questionnaire every time.

------------------------------------------------------------------------

# 32. RELAPSE UX

If the behavior returns:

Do not show:

-   "You failed"
-   "Streak broken!"
-   aggressive red state
-   reset-to-zero messaging

Instead:

> **The habit returned today. Let's understand what happened.**

Preserve historical progress.

Then offer reflection.

------------------------------------------------------------------------

# 33. LEAVE-BEHIND CEREMONY

When the user has made meaningful progress:

Show:

> **You've carried this for a while.**

Behavior name.

Freedom/tracking history.

Then:

> **Are you ready to put some of this weight down?**

CTA:

`[ Leave it behind ]`

Animation/transition:

1.  behavior object detaches from Backpack
2.  object is placed behind on the trail/cairn
3.  Backpack visibly becomes lighter
4.  user continues toward Mountain

Final message:

> **The mountain didn't change.**
>
> **But the climb became lighter.**

Do not use confetti or game-like celebration.

------------------------------------------------------------------------

# 34. RELAPSE AFTER LEAVING BEHIND

If a behavior returns later:

Do not automatically recreate all previous "weight."

Instead:

> You noticed it.
>
> You can continue.

The previous progress remains meaningful.

------------------------------------------------------------------------

# 35. TOOLS

Tools are the positive complement to the Backpack.

### What helps me climb?

Examples:

-   morning routine
-   phone outside bedroom
-   25-minute focus sessions
-   exercise
-   reading
-   working with friends
-   evening unplug

Tools should remain lightweight.

They are not another large tracking system.

Visually:

🎒 What makes the climb harder?

🧰 What helps me climb?

------------------------------------------------------------------------

# 36. MOUNTAIN + BACKPACK INTEGRATION

Mountain detail should optionally show:

### What I'm Carrying

-   Late-night scrolling
-   Procrastination

### What Helps Me Climb

-   Morning routine
-   Deep work
-   Exercise

Then:

### Current Step

### Next Milestone

The Mountain remains the primary visual.

Backpack and Tools support it.

------------------------------------------------------------------------

# 37. AI GUIDE

The AI should NOT be a generic chatbot.

It is a quiet "Guide" that helps users notice patterns in information
they explicitly logged.

The Guide can use:

-   Let Go check-ins
-   Journal entries
-   habits
-   sessions
-   Mountain progress
-   reflections

Use wording such as:

> Your Guide noticed something.

> You've mentioned...

> There seems to be a pattern...

> This might be worth exploring...

Never present a psychological diagnosis or unsupported certainty.

Do not say:

> You relapse because...

Instead:

> You've mentioned feeling exhausted in 4 of your last 6 reflections
> where this behavior returned.

------------------------------------------------------------------------

# 38. AI PATTERN INSIGHT

Example:

### YOUR GUIDE NOTICED

You've mentioned feeling exhausted in 4 of your last 6 reflections where
late-night scrolling returned.

Your successful days were more common when your evening unplug was
logged before 10:00 PM.

Actions:

`[ Try this ]`

`[ Not now ]`

The observation must be grounded in user-provided data.

------------------------------------------------------------------------

# 39. AI + RELAPSE

After a relapse reflection, AI may summarize only what the user
described.

Example:

### WHAT YOU DESCRIBED

> You were tired after a long day, felt overwhelmed by your workload,
> and used scrolling as a way to disconnect.

Then:

### A POSSIBLE NEXT STEP

> Try creating a 10-minute transition routine before starting your
> evening.

Action:

`[ Add to my plan ]`

Do not claim to know the user's internal state beyond what they
reported.

------------------------------------------------------------------------

# 40. AI + MOUNTAIN REFLECTION

If the user writes:

> "I feel like I'm moving too slowly."

The Guide can say:

> You've mentioned this feeling several times recently.
>
> Would you like to review the pace of your trail?

Actions:

-   Review my trail
-   Keep going
-   Write more

------------------------------------------------------------------------

# 41. LET GO INSIGHTS

For a specific behavior show:

### Late-Night Scrolling

-   days tracked
-   days free
-   freedom rate
-   current streak
-   best streak

### Common Triggers

Examples:

-   stress
-   tiredness
-   boredom

### Successful Alternatives

Examples:

-   10-minute walk
-   reading
-   phone outside bedroom

### Things That Help

-   evening routine
-   phone away
-   sleep schedule

Use editorial charts sparingly.

------------------------------------------------------------------------

# 42. JOURNEY + LET GO

Monthly Journey can include:

### What I Left Behind

Late-night scrolling

18 / 24 days free

### What I Learned

> "I use my phone most when I'm overwhelmed."

This becomes a physical journal artifact on the Journey.

Journey therefore records transformation, not just achievements.

------------------------------------------------------------------------

# 43. ME

## Purpose

Answer:

> **Who am I becoming?**

Show:

-   profile
-   level
-   XP
-   longest streak
-   best week
-   personal records
-   achievements
-   Mountains climbed
-   overall improvement
-   Journal
-   Let Go
-   settings

Do not make this a gaming profile.

It should feel like a personal growth archive.

------------------------------------------------------------------------

# 44. ACHIEVEMENTS

Achievements can include:

-   first 7-day streak
-   10 hours
-   50 tasks
-   100 hours
-   perfect week
-   30-day streak
-   beat previous record
-   comeback

Personal records:

-   longest streak
-   most hours in a week
-   most points in a week
-   most productive day

Use stamps and physical artifacts rather than shiny gaming badges.

------------------------------------------------------------------------

# 45. CALENDAR

## Week view

Show:

-   Saturday → Friday
-   time grid
-   each habit at its actual time
-   duration
-   completion state

Click/tap a block to:

-   complete
-   undo

This works even for past days.

## Month view

Show:

-   month grid
-   completed
-   partial
-   missed
-   upcoming

Use subtle dots/status markers.

Do not force the corkboard metaphor into Calendar.

------------------------------------------------------------------------

# 46. PROGRESS

Show eight-week trends:

-   hours per week
-   completion rate
-   points per week
-   average difficulty

Weekly review includes:

-   total time
-   previous week comparison
-   improvement percentage
-   tasks completed
-   consistency
-   XP
-   best habit
-   weakest habit
-   written analysis
-   one concrete recommendation

Charts should be simple and editorial.

------------------------------------------------------------------------

# 47. PERFORMANCE

Current week:

-   weekly points target
-   points earned vs target
-   consecutive weeks hitting target
-   recent week strip
-   current week marked "in progress"
-   day-by-day points
-   change vs previous scheduled day
-   best day
-   weakest day
-   habit ranking by completion rate
-   trend vs previous week
-   monthly heatmap

This can remain more data-oriented than Journey/Mountain.

------------------------------------------------------------------------

# 48. SETTINGS

Settings should be conventional and highly usable.

Sections:

### Profile

-   name
-   profile data

### Appearance

-   light
-   dark
-   system
-   reduced motion

### Notifications

-   habit starting soon
-   completion
-   streak alive
-   weekly review ready
-   channel preferences

### Google

-   connect/disconnect
-   account
-   sync interval
-   task sync
-   reminder calendar

### AI Planner

-   provider
-   API key
-   model
-   connection state

Supported providers include:

-   Anthropic / Claude
-   Groq

### Scoring & Progression

Expose configurable scoring/progression values.

### Data

-   recompute statistics
-   data/sync information

Desktop-specific:

-   start with Windows
-   minimize to tray

------------------------------------------------------------------------

# 49. EMPTY STATES

Use Khatwa-specific copy.

## No Mountains

> Every journey begins with a step.

`[ Choose your first mountain ]`

## No Memories

> Your wall is waiting for its first memory.

`[ Add a memory ]`

## No Habits

> Your first step starts here.

`[ Create a habit ]`

## No Achievements

> Keep taking steps. Your first one is already on its way.

## No Let-Go Behaviors

> Some things are easier to carry once you decide to put them down.

`[ Add something to let go ]`

## No Journal Entries

> What's on your mind?

`[ Write a reflection ]`

------------------------------------------------------------------------

# 50. SYSTEM STATES

Every screen must have:

-   loading
-   empty
-   success
-   error
-   offline
-   disabled
-   saving
-   unsaved changes
-   confirmation
-   undo where appropriate

For AI:

-   researching
-   drafting
-   reviewing
-   revising
-   completed
-   failed
-   partial/concerns remain

For sync:

-   connected
-   syncing
-   synced
-   offline
-   sync error

------------------------------------------------------------------------

# 51. OFFLINE-FIRST UI

The application should remain useful offline.

Show a subtle status indicator rather than blocking the app.

Example:

> Not connected\
> Working offline\
> Everything still tracked

When connectivity returns, sync status should update.

Do not show blocking error screens merely because Google is unavailable.

------------------------------------------------------------------------

# 52. GOOGLE INTEGRATION UI

Google integration is optional.

The app can:

-   write each day's habits to Google Tasks
-   read completion state back
-   sync completion in both directions
-   create timed reminder events in its own write-only calendar

Important UI concepts:

-   Connected / Not connected
-   Last sync
-   Syncing
-   Sync error
-   Google Tasks completion can change local completion state
-   App-owned reminder calendar

Do not imply that arbitrary Google Calendar events are tracked as
completed habits.

------------------------------------------------------------------------

# 53. NOTIFICATION UI

Notification types:

1.  habit starts in N minutes
2.  completion
3.  streak alive
4.  weekly review ready

Channels:

-   desktop toast
-   mirrored calendar reminder
-   push relay

Settings should allow enabling/disabling each.

------------------------------------------------------------------------

# 54. CORE DOMAIN UI DATA

The frontend should expect concepts corresponding to:

## User

-   id
-   name
-   level
-   XP
-   settings
-   integrations

## Habit

-   id
-   name
-   schedule
-   time
-   target minutes
-   baseline minutes
-   difficulty
-   reminder lead time
-   notes
-   paused/active
-   mountain association
-   optional tool association

## Habit occurrence

-   date
-   scheduled
-   completion state
-   logged minutes
-   completion source
-   score
-   XP
-   justified skip state

Completion sources:

-   timer
-   manual
-   assumed / external sync

The UI must visibly distinguish assumed time when used in analytics.

## Goal / Mountain

-   id
-   title
-   description/context
-   target date
-   weekly time budget
-   status
-   current position
-   milestones
-   sessions
-   mind map
-   resources
-   obstacles
-   backpack items
-   tools

## Milestone

-   id
-   title
-   date
-   completed
-   order

## Journal entry

-   id
-   date
-   title
-   body
-   mood
-   prompts answered
-   tags
-   mountain association
-   let-go association
-   attachments

## Let-Go behavior

-   id
-   title
-   trigger contexts
-   trigger notes
-   replacement behavior
-   associated mountain
-   status
-   tracking start date
-   freedom calendar
-   current streak
-   best streak
-   freedom rate
-   insights
-   backpack weight/state

## Daily Let-Go check-in

-   date
-   resisted / behavior occurred
-   trigger
-   feeling
-   need
-   free reflection
-   successful alternative

## Tool

-   id
-   title
-   description
-   related mountain
-   optional schedule
-   optional habit association

## AI insight

-   type
-   evidence/reference
-   generated observation
-   confidence/context
-   suggested action
-   dismissed/applied state

Do not display unsupported AI conclusions.

------------------------------------------------------------------------

# 55. Important Behavioral Rules

## Completion

-   completing a habit should update derived statistics
-   undoing completion should remove the derived credit
-   no manual XP increment UI
-   all metrics should be derived from source activity

## Adaptive difficulty

-   suggestion only
-   never automatic
-   user accepts or dismisses

## Goal

A goal/Mountain is a front door to ordinary habits and to-dos.

Sessions become habits.

Milestones become dated to-dos.

Goal completion should therefore update normal scheduling/progress
views.

## Let Go

-   one difficult day does not erase historical progress
-   freedom rate remains meaningful
-   relapse should trigger optional reflection
-   "leave behind" is symbolic and should not imply permanent immunity
-   user can continue tracking after leaving something behind

## Journal

-   user owns the content
-   AI can analyze only available/logged information
-   AI should not diagnose
-   AI should phrase patterns as observations or possibilities

------------------------------------------------------------------------

# 56. Responsive Behavior

## Desktop

Prioritize:

-   spatial Mountain
-   spatial Journey
-   side panels
-   large visual compositions
-   open whitespace

## Mobile

Prioritize:

-   vertical flow
-   bottom sheets
-   focused actions
-   large touch targets
-   progressive disclosure

Specific transformations:

  -----------------------------------------------------------------------
  Desktop                             Mobile
  ----------------------------------- -----------------------------------
  Journey corkboard                   Vertical memory timeline

  Large Mountain landscape            Scrollable vertical trail

  Side panel                          Bottom sheet / expandable section

  Multi-column journal                Single-column folio

  Backpack + mountain composition     Mountain section + Backpack section

  Goal review split view              Accordion / stacked sections
  -----------------------------------------------------------------------

------------------------------------------------------------------------

# 57. Animation

Animation should be calm and physical.

Good:

-   paper sliding
-   subtle page transitions
-   ink appearing
-   trail marker movement
-   Backpack item removal
-   soft bottom-sheet movement
-   gentle fade

Avoid:

-   confetti
-   explosions
-   neon effects
-   aggressive scale animations
-   gamified reward explosions

The "Leave Behind" ceremony can have a meaningful physical transition:

1.  item detaches
2.  item moves to cairn/trail
3.  Backpack lightens
4.  message appears

Respect reduced-motion settings.

------------------------------------------------------------------------

# 58. Accessibility

Implement:

-   keyboard navigation on desktop
-   visible focus state
-   semantic buttons/inputs
-   sufficient text contrast
-   screen-reader labels
-   large mobile touch targets
-   reduced-motion mode
-   no information conveyed by color alone
-   calendar status must have text/accessible labels
-   icon-only buttons need accessible names

------------------------------------------------------------------------

# 59. Error / Safety Language

Use neutral language.

Prefer:

> The habit returned today.

Not:

> You failed.

Prefer:

> Let's understand what happened.

Not:

> Your streak is broken.

Prefer:

> We noticed a possible pattern.

Not:

> We know why you did this.

The product should encourage agency and reflection.

------------------------------------------------------------------------

# 60. Final Information Architecture

``` text
KHATWA
│
├── TODAY
│   ├── Next Step
│   ├── Active Session
│   ├── Today's Habits
│   └── Today's To-dos
│
├── JOURNEY
│   ├── Memory Wall / Timeline
│   ├── Monthly Memory
│   ├── Add Memory
│   └── Journey Artifacts
│
├── MOUNTAINS
│   ├── Mountain List
│   ├── Mountain Detail
│   ├── Trail
│   ├── Milestones
│   ├── Obstacles
│   ├── Backpack
│   └── Tools
│
├── ME
│   ├── Identity / Progress
│   ├── Habits
│   ├── To-do
│   ├── Calendar
│   ├── Progress
│   ├── Performance
│   ├── Achievements
│   ├── Journal
│   ├── Let Go
│   └── Settings
│
└── GOAL CREATION
    ├── Choose Your Mountain
    ├── Building Your Trail
    ├── Your Mountain Is Ready
    └── Review Your Trail
```

------------------------------------------------------------------------

# 61. Core Product Loop

The UI should make this loop visible:

``` text
                 🏔 MOUNTAIN
                 Where I'm going
                       │
                       ▼
                    👣 STEP
                  What I do
                       │
          ┌────────────┴────────────┐
          ▼                         ▼
       🎒 BACKPACK                🧰 TOOLS
     What I carry              What helps
          │                         │
          └────────────┬────────────┘
                       ▼
                    📖 JOURNAL
                 What I learn
                       │
                       ▼
                    🤖 GUIDE
             Patterns I may notice
                       │
                       ▼
                 ADJUST THE PATH
                       │
                       └──────────→ 🏔
```

Journey surrounds this entire loop by recording how the user changes
over time.

------------------------------------------------------------------------

# 62. Final UX Principles

1.  **Next step over dashboard.**
2.  **Destination over arbitrary goals.**
3.  **Reflection over punishment.**
4.  **Progress over streak obsession.**
5.  **User agency over AI authority.**
6.  **Physical metaphor where it adds meaning.**
7.  **Functional simplicity where metaphor would hurt usability.**
8.  **AI should explain useful observations, not pretend to understand
    the user.**
9.  **A relapse does not erase progress.**
10. **The Journey should become richer as the user lives their life.**

The final emotional message is:

> **I know where I'm going.**
>
> **I can see what I'm carrying.**
>
> **I can understand why I'm carrying it.**
>
> **I can choose what to put down.**
>
> **I know what helps me climb.**
>
> **And I can keep taking the next step.**
