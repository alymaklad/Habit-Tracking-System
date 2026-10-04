import { z } from 'zod'
import {
  AiError,
  EXCERPT_CHARS,
  relevancePrompt,
  type AiClient,
  type FetchedPage,
  type Prompt
} from './anthropicClient'
import {
  CritiqueSchema,
  GoalPlanSchema,
  RelevanceSchema,
  type Critique,
  type RawGoalPlan
} from './goalPlanSchema'

const BASE = 'https://api.groq.com/openai/v1'

/** Groq's compound system runs web search server-side, so research works the same way. */
export const GROQ_RESEARCH_MODEL = 'groq/compound'
/** Single-tool-call sibling of compound — lighter, and a second chance when compound refuses. */
export const GROQ_RESEARCH_FALLBACK_MODEL = 'groq/compound-mini'
/** Supports strict JSON-schema output, which the finalize and critique steps rely on. */
export const GROQ_DEFAULT_MODEL = 'openai/gpt-oss-20b'
/**
 * Plan models that support that JSON-schema output. Groq counts rate limits per model, so
 * when one is busy the next is a legitimate second chance on the same key.
 */
export const GROQ_PLAN_MODELS = ['openai/gpt-oss-20b', 'openai/gpt-oss-120b']

/**
 * Groq's free tier caps tokens per request and per minute far below Anthropic's, and a
 * request that would exceed the per-request cap is refused outright (413). Output caps
 * are kept modest so prompt + output stays under it; a 429 is retried after the wait
 * the server asks for.
 */
const MAX_OUTPUT = { research: 1500, plan: 3000, critique: 800, relevance: 400 }
/** Below this the output cap is too small to hold a plan; better to say so than to truncate. */
const MIN_OUTPUT = 700
const MAX_RATE_LIMIT_RETRIES = 3
const MAX_WAIT_MS = 25_000

type FetchLike = typeof fetch
type SleepLike = (ms: number) => Promise<void>

const sleep: SleepLike = (ms) => new Promise((r) => setTimeout(r, ms))

interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

interface ChatResponse {
  choices?: { message?: { content?: string | null }; finish_reason?: string }[]
  error?: { message?: string }
}

/** Strip what Groq's strict mode does not want to see; zod 4 already emits `required` and `additionalProperties: false`. */
export function toStrictSchema(schema: z.ZodType): Record<string, unknown> {
  const json = z.toJSONSchema(schema) as Record<string, unknown>
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return
    const obj = node as Record<string, unknown>
    delete obj.$schema
    if (obj.type === 'integer' || obj.type === 'number') {
      delete obj.minimum
      delete obj.maximum
    }
    for (const v of Object.values(obj)) {
      if (Array.isArray(v)) v.forEach(walk)
      else walk(v)
    }
  }
  walk(json)
  return json
}

function extractJson(text: string): unknown {
  const trimmed = text.trim()
  try {
    return JSON.parse(trimmed)
  } catch {
    // Some models wrap JSON in a code fence even when asked not to.
    const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(trimmed)
    if (fenced?.[1]) return JSON.parse(fenced[1])
    const start = trimmed.indexOf('{')
    const end = trimmed.lastIndexOf('}')
    if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1))
    throw new AiError('The model did not return JSON.', 'malformed')
  }
}

function titleOf(html: string): string | null {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)
  return m?.[1]?.replace(/\s+/g, ' ').trim() || null
}

function textOf(html: string): string {
  return html
    .replace(/<head[\s\S]*?<\/head>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Groq behind the same port as Anthropic. Two differences are absorbed here so the loop
 * never sees them:
 *  - research uses the compound system (server-side search) regardless of the plan model;
 *  - there is no web-fetch tool, so link verification is a plain HTTP GET followed by a
 *    one-line relevance judgement from the plan model.
 */
export function groqClient(opts: {
  apiKey: string
  model?: string
  /** Tried in order when the plan model is rate-limited. */
  fallbackModels?: string[]
  researchModel?: string
  fetchImpl?: FetchLike
  sleepImpl?: SleepLike
}): AiClient {
  const model = opts.model ?? GROQ_DEFAULT_MODEL
  const planModels = [...new Set([model, ...(opts.fallbackModels ?? [])])]
  /** Models that answered 429 during this client's life; skipped from then on. */
  const limited = new Set<string>()
  /** The plan model currently in use: the chosen one until it is rate-limited. */
  const active = (): string => planModels.find((m) => !limited.has(m)) ?? model
  const researchModel = opts.researchModel ?? GROQ_RESEARCH_MODEL
  const doFetch: FetchLike = opts.fetchImpl ?? fetch
  const sleepFor: SleepLike = opts.sleepImpl ?? sleep
  let onWait: ((ms: number) => void) | null = null
  const wait: SleepLike = (ms) => {
    onWait?.(ms)
    return sleepFor(ms)
  }

  /**
   * gpt-oss models reason before answering and the reasoning spends the same output
   * budget as the answer; at medium effort a 1500-token cap can be gone before a word of
   * output. Keep reasoning light — the Reflexion loop supplies the second thoughts.
   */
  function reasoningParams(forModel: string): Record<string, unknown> {
    return /gpt-oss/i.test(forModel) ? { reasoning_effort: 'low', include_reasoning: false } : {}
  }

  async function chat(
    request: Record<string, unknown>,
    opts2: { allowTruncated?: boolean; failFast?: boolean } = {}
  ): Promise<string> {
    let body = { ...reasoningParams(String(request.model)), ...request }
    let shrunk = false
    for (let attempt = 0; ; attempt++) {
      let res: Response
      try {
        res = await doFetch(`${BASE}/chat/completions`, {
          method: 'POST',
          headers: { authorization: `Bearer ${opts.apiKey}`, 'content-type': 'application/json' },
          body: JSON.stringify(body)
        })
      } catch {
        throw new AiError('Could not reach Groq. Check the connection.', 'network')
      }

      if (res.status === 401 || res.status === 403) {
        throw new AiError('Groq rejected the API key. Check it in Settings.', 'auth')
      }

      if (res.status === 429 || res.status >= 500) {
        // Groq says how long to wait; honour it up to a point, then give up cleanly.
        const retryAfter = Number(res.headers.get('retry-after'))
        const ms = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 2 ** attempt * 1500
        // With another model to fall back on, moving on beats waiting out this one.
        if (!(res.status === 429 && opts2.failFast) && attempt < MAX_RATE_LIMIT_RETRIES && ms <= MAX_WAIT_MS) {
          await wait(ms)
          continue
        }
        if (res.status === 429) {
          throw new AiError(
            'Groq is rate-limiting requests. Free-tier limits are per minute — wait a minute and try again, or pick a smaller model.',
            'rate_limit'
          )
        }
      }

      if (res.status === 413) {
        // Groq refuses up front when prompt + max_tokens would exceed the per-minute
        // allowance for this model on the account's tier, and says by how much:
        //   "... tokens per minute (TPM): Limit 6000, Requested 7415 ..."
        // The prompt size is what we sent minus the output cap, so the cap can be cut to
        // whatever room is left and the same request retried once.
        const data = (await res.json().catch(() => ({}))) as ChatResponse
        const message = data.error?.message ?? (await res.text().catch(() => '')) ?? ''
        const m = /Limit\s+(\d+)[^\d]+Requested\s+(\d+)/i.exec(message)
        const cap = typeof body.max_tokens === 'number' ? body.max_tokens : null
        if (m && cap !== null && !shrunk) {
          const limit = Number(m[1])
          const requested = Number(m[2])
          const promptTokens = requested - cap
          const room = limit - promptTokens - 100
          if (room >= MIN_OUTPUT) {
            shrunk = true
            body = { ...body, max_tokens: room }
            continue
          }
          throw new AiError(
            `Groq allows about ${limit} tokens per request for this model on your plan, but the prompt alone is ~${promptTokens}. ` +
              'Shorten the goal description, or pick a model with a larger limit.',
            'other'
          )
        }
        throw new AiError(
          `Groq refused the request as too large for this model or plan${message ? ` (${message.slice(0, 200)})` : ''}. ` +
            'Shorten the goal description, or pick a model with a larger request limit.',
          'other'
        )
      }

      const data = (await res.json().catch(() => ({}))) as ChatResponse
      if (!res.ok) {
        const detail = data.error?.message ?? `HTTP ${res.status}`
        const e = new AiError(`Groq error: ${detail}`, 'other')
        ;(e as AiError & { status?: number }).status = res.status
        throw e
      }

      const choice = data.choices?.[0]
      const content = choice?.message?.content
      if (choice?.finish_reason === 'length' && !(opts2.allowTruncated && content)) {
        throw new AiError('The response was cut off before it finished.', 'malformed')
      }
      if (!content) throw new AiError('Groq returned an empty response.', 'malformed')
      return content
    }
  }

  /**
   * Strict JSON-schema output first; if the chosen model does not support it Groq answers
   * 400, so fall back to JSON-object mode with the schema spelled out in the prompt. The
   * zod parse afterwards is what actually guarantees the shape either way.
   */
  async function structured<T>(prompt: Prompt, schema: z.ZodType<T>, name: string, maxTokens: number): Promise<T> {
    const tried: string[] = []
    for (;;) {
      const current = active()
      const last = planModels.every((m) => m === current || limited.has(m))
      tried.push(current)
      try {
        return await structuredOn(current, prompt, schema, name, maxTokens, !last)
      } catch (err) {
        if (!(err instanceof AiError) || err.kind !== 'rate_limit' || last) {
          if (err instanceof AiError && err.kind === 'rate_limit' && tried.length > 1) {
            throw new AiError(
              `Groq is rate-limiting every model tried (${tried.join(', ')}). Free-tier limits reset each minute — wait a minute and try again.`,
              'rate_limit'
            )
          }
          throw err
        }
        limited.add(current)
      }
    }
  }

  async function structuredOn<T>(
    model: string,
    prompt: Prompt,
    schema: z.ZodType<T>,
    name: string,
    maxTokens: number,
    failFast: boolean
  ): Promise<T> {
    const jsonSchema = toStrictSchema(schema)
    const messages: ChatMessage[] = [
      { role: 'system', content: prompt.system },
      { role: 'user', content: prompt.user }
    ]

    let text: string
    try {
      text = await chat({
        model,
        messages,
        max_tokens: maxTokens,
        temperature: 0.4,
        response_format: { type: 'json_schema', json_schema: { name, strict: true, schema: jsonSchema } }
      }, { failFast })
    } catch (err) {
      const status = (err as { status?: number }).status
      if (!(err instanceof AiError) || err.kind !== 'other' || status !== 400) throw err
      text = await chat({
        model,
        messages: [
          {
            role: 'system',
            content: `${prompt.system}\n\nRespond with a single JSON object matching this JSON Schema and nothing else:\n${JSON.stringify(jsonSchema)}`
          },
          { role: 'user', content: prompt.user }
        ],
        max_tokens: maxTokens,
        temperature: 0.4,
        response_format: { type: 'json_object' }
      }, { failFast })
    }

    const parsed = schema.safeParse(extractJson(text))
    if (!parsed.success) {
      throw new AiError(`The model's JSON did not match the expected shape: ${parsed.error.issues[0]?.message ?? ''}`, 'malformed')
    }
    return parsed.data
  }

  return {
    setWaitListener(listener) {
      onWait = listener
    },

    /**
     * Research tries the compound system first (it has web search), then its lighter
     * sibling, then the plan model with no search at all. Groq's compound tier refuses
     * some requests with a bare 413 that its docs do not explain; a draft built on the
     * model's own knowledge is far better than no draft, and any link it produces from
     * memory still has to survive the Intervenor's fetch before the user sees it.
     */
    async research(prompt) {
      const model = active()
      const candidates = [...new Set([researchModel, GROQ_RESEARCH_FALLBACK_MODEL, model])]
      const failures: string[] = []
      let lastKind: AiError['kind'] = 'other'

      for (const candidate of candidates) {
        const searchless = candidate === model
        const system = searchless
          ? `${prompt.system}\n\nYou do not have web access for this request. Draw on what you know, ` +
            'and do not give any URLs: name each resource precisely enough that it can be searched for.'
          : prompt.system
        try {
          // Findings are free text, so a summary cut short by the output cap is still
          // useful — unlike a JSON draft, which has to be whole.
          const text = await chat(
            {
              model: candidate,
              messages: [
                { role: 'system', content: system },
                { role: 'user', content: prompt.user }
              ],
              max_tokens: MAX_OUTPUT.research
            },
            { allowTruncated: true }
          )
          if (!text.trim()) throw new AiError('The research step returned no findings.', 'malformed')
          return searchless
            ? `(Researched without web search — no links available.)\n\n${text}`
            : text
        } catch (err) {
          const e = err instanceof AiError ? err : new AiError(String(err), 'other')
          if (e.kind === 'auth' || e.kind === 'rate_limit') throw e
          failures.push(`${candidate}: ${e.message}`)
          lastKind = e.kind
        }
      }
      throw new AiError(`Research failed on every Groq model tried — ${failures.join(' · ')}`, lastKind)
    },

    finalize(prompt): Promise<RawGoalPlan> {
      return structured(prompt, GoalPlanSchema, 'goal_plan', MAX_OUTPUT.plan)
    },

    critique(prompt): Promise<Critique> {
      return structured(prompt, CritiqueSchema, 'critique', MAX_OUTPUT.critique)
    },

    /** No fetch tool on Groq: a plain GET, with the title and opening text pulled out. */
    async fetchPage(url): Promise<FetchedPage> {
      try {
        const res = await doFetch(url, {
          method: 'GET',
          redirect: 'follow',
          headers: { 'user-agent': 'Khatwa/1.0 (link check)', accept: 'text/html,*/*;q=0.5' },
          signal: AbortSignal.timeout(10_000)
        })
        if (!res.ok) return { ok: false, title: null, excerpt: '', error: `http_${res.status}` }
        const type = res.headers.get('content-type') ?? ''
        if (!/html|text|xml/i.test(type)) {
          // A PDF or similar: it exists, and that is all a link check can say.
          return { ok: true, title: null, excerpt: '(non-HTML document)', error: null }
        }
        const html = (await res.text()).slice(0, 200_000)
        return { ok: true, title: titleOf(html), excerpt: textOf(html).slice(0, EXCERPT_CHARS), error: null }
      } catch (err) {
        return {
          ok: false,
          title: null,
          excerpt: '',
          error: err instanceof Error && err.name === 'TimeoutError' ? 'timeout' : 'url_not_accessible'
        }
      }
    },

    async judgeRelevance(pages, topic) {
      if (pages.length === 0) return []
      try {
        const verdict = await structured(relevancePrompt(pages, topic), RelevanceSchema, 'relevance', MAX_OUTPUT.relevance)
        const byUrl = new Map(verdict.verdicts.map((v) => [v.url, v.relevant]))
        return pages.map((p) => byUrl.get(p.url) ?? true)
      } catch (err) {
        const e = err instanceof AiError ? err : new AiError(String(err), 'other')
        if (e.kind === 'auth' || e.kind === 'rate_limit') throw e
        // Only the judgement failed; the pages exist. Do not punish the links for it.
        return pages.map(() => true)
      }
    }
  }
}
