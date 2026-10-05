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

Khatwa uses Neon's own Google sign-in, with the **system browser** in the role of a web
page:

1. the app listens on a `http://localhost:<port>` address (Neon trusts any localhost
   address out of the box);
2. it asks Neon to start Google sign-in with that address as the place to come back to,
   and opens Neon's link in the browser;
3. Neon sends the browser back with a one-time `neon_auth_session_verifier`, and the app
   exchanges it for the session — together with the "session challenge" cookie Neon set in
   step 2, so a verifier is no use to anyone but the app that asked for it.

**Development:** nothing to configure. Neon signs people in with its own shared Google
client.

**Before launch:** give Neon a Google client of your own, so the consent screen shows
Khatwa's name rather than Neon's. In Google Cloud create an OAuth client of type
**Web application** (not Desktop — Google only lets a Desktop client return to loopback
addresses), add the callback URL Neon shows as an authorised redirect URI, then in Neon:
**Settings → Auth → OAuth providers → Google → ⋯ → Configure** and enter that Web client's
ID and secret.

The **Desktop** client in `.env` is a different thing: it is only for linking Google
Calendar, and must not be entered in Neon.

### 4. Before real users arrive

- **Email verification** — off by default in Neon Auth, and without it anyone can sign up
  with any address. Turn it on and set up an email provider.
- **Trusted domains** — the app identifies itself as `http://localhost`, which Neon
  trusts by default. If you ever remove that, add a domain you own (for example
  `https://app.khatwa.com`) to Neon Auth's trusted domains and build it in:
  `MAIN_VITE_NEON_AUTH_ORIGIN=https://app.khatwa.com`.

## How it works

The account service runs in the main process, never in the window, and calls Neon Auth's
REST API directly: `sign-up/email`, `sign-in/email`, `sign-in/social` (to start Google
sign-in), `get-session` (also exchanging Google's verifier) and `sign-out`. Better Auth keeps sessions in a cookie; the app keeps
that cookie itself, **encrypted with Windows DPAPI**, and the window only ever learns who is
signed in. Offline, the last signed-in user stays signed in.

Code: `src/main/account/accountService.ts` (the client), `sessionVault.ts` (encrypted
storage), `src/renderer/khatwa/account.tsx` (welcome screen, form, dialog).
