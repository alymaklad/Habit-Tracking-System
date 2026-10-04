# Khatwa accounts (Neon Auth)

Khatwa accounts run on **Neon Auth**, Neon's managed version of Better Auth. People can
create an account with email and password, or sign in with Google.

A build with no Neon Auth URL has no accounts: it opens straight into the app, exactly as
before. That keeps development builds simple.

## What an account does today

- The app opens on a welcome screen until someone signs in.
- A guest can **try the planner first**. Saving the mountain they drafted asks them to
  create an account (or sign in), then saves it.
- Settings → **Your account** shows who is signed in, and signs out.

Habit data still lives on this computer. Accounts become the owner of that data when it
moves to the hosted Neon database — until then, two people signing in on one computer see
the same habits.

## Set up

### 1. Create the Neon project and turn on Auth

In the Neon console, create a project, open **Auth**, and enable it. Copy the **Auth URL**
it shows.

### 2. Build it into the app

In `.env` (git-ignored — copy `.env.example`):

```
MAIN_VITE_NEON_AUTH_URL=<the Auth URL>
```

and rebuild. The app finds the endpoints itself, whether they sit directly under that URL
or under `/auth`. For a quick try without rebuilding, run the app with `NEON_AUTH_URL` set
in the environment instead.

### 3. Google sign-in

The app signs people in with Google through their **system browser**, the same way it
links Google Calendar, and hands Neon Auth the resulting Google **ID token**, which Neon
verifies with Google. An ID token names the Google client it was issued to, so **Neon
Auth's Google provider must use the app's own Desktop client** — the same client ID and
secret as in `MAIN_VITE_GOOGLE_CLIENT_ID` / `MAIN_VITE_GOOGLE_CLIENT_SECRET`:

```
neonctl neon-auth oauth-provider add --provider-id google \
  --oauth-client-id <Desktop client ID> --oauth-client-secret <Desktop client secret>
```

(or Neon console → Auth → OAuth providers → Google → custom credentials).

> Neon's own guide describes a *Web application* client, because it assumes a website
> redirecting back to itself. Khatwa never uses that redirect; it only sends ID tokens.
> This path is not described in Neon's docs, so test it on a non-production branch first.

In Google Cloud, the consent screen needs the `openid`, `email` and `profile` scopes —
they are non-sensitive, so they add no verification work.

### 4. Before real users arrive

- **Email verification** — off by default in Neon Auth, and without it anyone can sign up
  with any address. Turn it on and set up an email provider.
- **Trusted domains** — if sign-in fails with "The account service refused this app",
  Neon is checking the request's origin. Add a domain you own (for example
  `https://app.khatwa.com`) to Neon Auth's trusted domains and build it in:
  `MAIN_VITE_NEON_AUTH_ORIGIN=https://app.khatwa.com`.

## How it works

The account service runs in the main process, never in the window, and calls Neon Auth's
REST API directly: `sign-up/email`, `sign-in/email`, `sign-in/social` (with the Google ID
token), `get-session` and `sign-out`. Better Auth keeps sessions in a cookie; the app keeps
that cookie itself, **encrypted with Windows DPAPI**, and the window only ever learns who is
signed in. Offline, the last signed-in user stays signed in.

Code: `src/main/account/accountService.ts` (the client), `sessionVault.ts` (encrypted
storage), `src/renderer/khatwa/account.tsx` (welcome screen, form, dialog).
