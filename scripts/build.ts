/**
 * Builds the whole deployment in Vercel's Build Output API format:
 *
 *   .vercel/output/static/          the React app (Vite)
 *   .vercel/output/functions/api.func/   the API, one bundled Node function (esbuild)
 *   .vercel/output/config.json      routes, security headers, the daily cron
 *
 * Bundling the server ourselves means path aliases, ESM/CJS mixes and tree-shaking are
 * settled here, not by guesswork in the platform's builder.
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { build as viteBuild } from 'vite'
import { build as esbuild } from 'esbuild'

const root = resolve(import.meta.dirname, '..')
const out = resolve(root, '.vercel/output')
const fn = resolve(out, 'functions/api.func')

/** Frankfurt, next to the Neon database (eu-central-1). Override with FUNCTION_REGION. */
const REGION = process.env.FUNCTION_REGION || 'fra1'

rmSync(out, { recursive: true, force: true })

// 1. The browser app.
await viteBuild({ configFile: resolve(root, 'vite.config.ts'), logLevel: 'warn' })

// 2. The API function.
mkdirSync(fn, { recursive: true })
const result = await esbuild({
  entryPoints: [resolve(root, 'src/server/vercel.ts')],
  outfile: resolve(fn, 'index.js'),
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  sourcemap: 'linked',
  minify: false,
  tsconfig: resolve(root, 'tsconfig.node.json'),
  // `ws` probes for these optional native speed-ups and works without them.
  external: ['bufferutil', 'utf-8-validate'],
  logLevel: 'warning',
  metafile: true
})
writeFileSync(resolve(fn, 'package.json'), JSON.stringify({ type: 'commonjs' }))
writeFileSync(
  resolve(fn, '.vc-config.json'),
  JSON.stringify(
    {
      runtime: 'nodejs22.x',
      handler: 'index.js',
      launcherType: 'Nodejs',
      shouldAddHelpers: false,
      supportsResponseStreaming: true,
      // AI planning can take a minute or two; Hobby allows up to 300 s.
      maxDuration: 300,
      regions: [REGION]
    },
    null,
    2
  )
)

// 3. Routing, headers and the cron.
const security = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'x-frame-options': 'DENY',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
  'strict-transport-security': 'max-age=63072000; includeSubDomains'
}
writeFileSync(
  resolve(out, 'config.json'),
  JSON.stringify(
    {
      version: 3,
      routes: [
        { src: '/(.*)', headers: security, continue: true },
        { src: '/assets/(.*)', headers: { 'cache-control': 'public, max-age=31536000, immutable' }, continue: true },
        { src: '^/api(?:/.*)?$', dest: '/api' },
        { handle: 'filesystem' },
        // A single-page app: every other path is the app itself.
        { src: '/(.*)', dest: '/index.html' }
      ],
      // Hobby allows one run a day; on Pro, `*/15 * * * *` makes reminders reach phones on time.
      crons: [{ path: '/api/cron/daily', schedule: process.env.CRON_SCHEDULE || '0 5 * * *' }]
    },
    null,
    2
  )
)

const kb = Math.round(Object.values(result.metafile.outputs).reduce((s, o) => s + o.bytes, 0) / 1024)
console.log(`Built .vercel/output — static app + api function (${kb} KB, region ${REGION})`)
