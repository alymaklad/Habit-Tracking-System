# Khatwa accounts (Neon Auth)

Khatwa accounts run on **Neon Auth**, Neon's managed version of Better Auth. People can
create an account with email and password, or sign in with Google.

## What an account does

- Each account owns its own data: a Postgres schema of its own (`u_<id>`), created the
  first time it signs in. Two people never see each other's habits.
- The site opens on a welcome screen until someone signs in.
- A guest can **try the planner first**. Saving the mountain they drafted asks them to
  create an account (or sign in), then saves it. Guests run against an empty, read-only
  schema and get a few AI drafts a day per IP (`GUEST_AI_PER_DAY`).
- Settings → **Your account** shows who is signed in, and signs out.

## How a session works

The browser never talks to Neon Auth directly — its cookies would be third-party cookies
on Khatwa's domain, which browsers increasingly drop. Instead:

1. The browser posts the email and password to `/api/rpc/account:signIn`.
2. The server calls Neon Auth and receives Neon's session cookie.
3. The server seals that cookie (AES-256-GCM, `APP_SECRET`) into its own httpOnly,
   `SameSite=Lax` cookie, `__Host-khatwa_session`.
4. Every request opens the sealed cookie to learn who is asking. Every 15 minutes the
   server re-checks it with Neon, so signing out elsewhere or a revoked session takes
   effect quickly.

### Google sign-in

Neon's own redirect flow, with the server in the middle:

1. `/api/auth/google/start` asks Neon to begin Google sign-in, with
   `/api/auth/google/done` as the place to come back to. Neon sets a "session challenge"
   cookie in that response; the server keeps it, sealed, in a short-lived cookie.
2. Neon sends the browser back with a one-time `neon_auth_session_verifier`. The server
   exchanges it for the session together with the challenge cookie, so a verifier is no
   use to anyone but the browser that started the flow.

## Set up

1. In the Neon console, create a project, open **Auth**, enable it, and copy the
   **Auth URL** into `NEON_AUTH_URL`.
2. Under **Trusted domains**, add every origin the site is served from: the production
   URL, and `http://localhost:5173` for development (Neon trusts localhost by default).
3. **Before launch:** give Neon a Google client of your own so the consent screen shows
   Khatwa's name rather than Neon's. In Google Cloud create an OAuth client of type
   **Web application**, add the callback URL Neon shows as an authorised redirect URI,
   then in Neon: **Settings → Auth → OAuth providers → Google → Configure**.

For development without Neon Auth, run `node --import tsx scripts/dev.ts --dev-user`:
the API then treats every request as one local user. That switch is ignored on Vercel.
