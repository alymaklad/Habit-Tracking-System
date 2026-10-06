# Deploying Khatwa (Vercel + Neon)

Khatwa runs as one Vercel project: the React app as static files, and every `/api/*`
route served by a single Node function. Data lives in Neon Postgres.

```
browser ──► Vercel CDN ── static app (.vercel/output/static)
        └─► /api/*  ───── api function (fra1) ──► Neon Postgres (eu-central-1)
                                              ├─► Neon Auth   (accounts)
                                              ├─► Vercel Blob (journal files, private)
                                              └─► Google Tasks / Calendar
```

## How it fits together

- **Build.** `npm run build` writes Vercel's Build Output API format itself — Vite for
  the app, esbuild for the function — so there is nothing for Vercel to guess.
  `vercel.json` only tells Vercel to run it.
- **One schema per account.** Each signed-in account gets its own Postgres schema
  (`u_<id>`), created and migrated on first use. A request sets `search_path` on its own
  connection, so no query can read another account's rows. `public.khatwa_account` lists
  accounts for the cron. This needs the **direct (unpooled)** connection string.
- **Sessions.** Neon Auth handles sign-in; the server keeps Neon's session cookie sealed
  inside its own httpOnly cookie and re-checks it every 15 minutes.
- **Background work.** There is no long-running process. The open tab sends a heartbeat
  every minute (due reminders, sync when the interval has passed). A Vercel Cron job
  runs the same sweep for every account once a day.
- **Secrets at rest.** Google refresh tokens and pasted AI keys are sealed with
  AES-256-GCM using `APP_SECRET`.

## One-time setup

### 1. Neon

1. In the Neon console, open the project, then **Connection details**. Turn **off**
   "Connection pooling" and copy the connection string. That is `DATABASE_URL`.
2. **Auth → Configuration**: copy the **Auth URL** (`NEON_AUTH_URL`). Under **Trusted
   domains**, add the site's URL, e.g. `https://khatwa.vercel.app`. Without it, sign-in
   fails with "The account service refused this site".
3. For Google sign-in on the welcome screen, give Neon Auth a Google OAuth client of type
   **Web application** with the callback URL Neon shows (Settings → Auth → OAuth providers
   → Google). This client is separate from the Tasks/Calendar one below.

### 2. Vercel environment variables

Project → Settings → Environment Variables (Production and Preview):

| Variable | Value |
|---|---|
| `DATABASE_URL` | Neon direct connection string |
| `NEON_AUTH_URL` | Neon Auth URL |
| `APP_SECRET` | `openssl rand -base64 48` — keep it; changing it signs everyone out and unlinks Google |
| `CRON_SECRET` | `openssl rand -hex 32` |
| `APP_URL` | `https://<your domain>` |
| `BLOB_READ_WRITE_TOKEN` | set automatically by connecting a Blob store (next step) |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | optional — see [GOOGLE_SETUP.md](GOOGLE_SETUP.md) |
| `ANTHROPIC_API_KEY` / `GROQ_API_KEY` | optional server-wide AI key; users can paste their own instead |

### 3. Blob storage for journal files

**Storage → Create → Blob** (private), then connect it to the project. Without it,
attachments cannot be stored on Vercel.

### 4. Deploy

Pushing to the connected GitHub branch deploys. Or from a terminal:

```bash
npx vercel deploy --prod
```

Check `https://<your domain>/api/health` and you should see `{"ok":true,…}`.

## Moving your Windows data in

Sign in to the web app once (that creates your account), then on the PC that has the
desktop app:

```bash
npm run import:desktop -- --email you@example.com
```

with `DATABASE_URL`, `APP_SECRET` and `BLOB_READ_WRITE_TOKEN` in `.env.local`. Add `--local`
first for a dry run into the dev database. Everything comes across except the Google link
(link it again in Settings) and pasted AI keys.

## Plans and limits

- **Cron.** Hobby allows one run a day (`0 5 * * *`, UTC). On Pro, build with
  `CRON_SCHEDULE="*/15 * * * *"` so reminders reach phones (via the push relay) and Google
  syncs even when no tab is open.
- **Function time.** AI planning can take a minute or two; the function allows 300 s.
- **AI spend.** On the server's own key, each account gets `AI_DAILY_LIMIT` plans a day
  (default 30) and guests `GUEST_AI_PER_DAY` per IP (default 3). Accounts with their own
  key are not limited.
- **Region.** The function runs in `fra1`, next to the Neon database in `eu-central-1`.
  If the database moves, build with `FUNCTION_REGION=<region>`.

## Local development

```bash
npm install
npm run dev
```

Opens http://localhost:5173. With no `DATABASE_URL`, data goes to a local Postgres
(PGlite) under `.data/`. With no `NEON_AUTH_URL`, start with `node --import tsx
scripts/dev.ts --dev-user` to skip accounts.
