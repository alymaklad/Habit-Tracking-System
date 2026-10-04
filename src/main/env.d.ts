/// <reference types="electron-vite/node" />

interface ImportMetaEnv {
  /** The app's Google OAuth "Desktop app" client, built into the release from `.env`. */
  readonly MAIN_VITE_GOOGLE_CLIENT_ID?: string
  readonly MAIN_VITE_GOOGLE_CLIENT_SECRET?: string
  /** Neon Auth URL (Neon console → Auth). Without it the app runs with no accounts. */
  readonly MAIN_VITE_NEON_AUTH_URL?: string
  /** Origin header for Neon Auth requests; must be one of its trusted domains. */
  readonly MAIN_VITE_NEON_AUTH_ORIGIN?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
