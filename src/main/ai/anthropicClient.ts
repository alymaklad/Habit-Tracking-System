import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import {
  CritiqueSchema,
  GoalPlanSchema,
  RelevanceSchema,
  type Critique,
  type RawGoalPlan
} from './goalPlanSchema'

export interface Prompt {
  system: string
  user: string
}

export interface FetchedPage {
  ok: boolean
  title: string | null
  /** The start of the page's text, enough to judge what it is about. */
  excerpt: string
  error: string | null
}

export interface PageToJudge {
  url: string
  title: string | null
  excerpt: string
}

/** How much of a page is worth sending to the model to decide what it is about. */
export const EXCERPT_CHARS = 700

/**
 * The only code in `ai/` that touches the network. One shape of call per role:
 *
 *  - `research`        — free-form, with the server-side web search tool. Returns text.
 *  - `finalize`        — no tools, structured output locked to `GoalPlanSchema`.
 *  - `critique`        — no tools, structured output locked to `CritiqueSchema`.
 *  - `fetchPage`       — the Intervenor's own fetch of one URL. No judgement, just the page.
 *  - `judgeRelevance`  — one call deciding which of the fetched pages are on topic.
 *
 * Fetching and judging are separate so that a plan with six links costs one judgement
 * call, not six — providers with tight per-minute limits (Groq's free tier) fall over
 * otherwise. Web search and web fetch run on Anthropic's side, so a search cannot be
 * intercepted mid-call; that is why the loop intervenes between phases rather than
 * between tool calls.
 */
export interface AiClient {
  research(prompt: Prompt): Promise<string>
  finalize(prompt: Prompt): Promise<RawGoalPlan>
  critique(prompt: Prompt): Promise<Critique>
  fetchPage(url: string): Promise<FetchedPage>
  judgeRelevance(pages: PageToJudge[], topic: string): Promise<boolean[]>
  /** Told how long the client is about to wait out a rate limit, so the wizard can count down. */
  setWaitListener?(listener: ((ms: number) => void) | null): void
}

export function relevancePrompt(pages: PageToJudge[], topic: string): Prompt {
  return {
    system:
      'You check whether web pages are genuinely about a topic. For each page you are given its URL, ' +
      'title and the start of its text. Return one verdict per URL, in the same order, with ' +
      '`relevant: true` only if the page is actually about the topic — a parked domain, an error page, ' +
      'a login wall or an unrelated article is `false`.',
    user: [
      `Topic: ${topic}`,
      '',
      ...pages.map(
        (p, i) => `${i + 1}. URL: ${p.url}\n   Title: ${p.title ?? '(none)'}\n   Text: ${p.excerpt.slice(0, EXCERPT_CHARS)}`
      )
    ].join('\n')
  }
}

export class AiError extends Error {
  constructor(
    message: string,
    readonly kind: 'auth' | 'rate_limit' | 'refusal' | 'network' | 'malformed' | 'other'
  ) {
    super(message)
    this.name = 'AiError'
  }
}

export const DEFAULT_MODEL = 'claude-opus-5'

const MAX_SEARCH_USES = 6
/** Server-side tool loops resume on `pause_turn`; cap how many times we let that happen. */
const MAX_CONTINUATIONS = 4

function translate(err: unknown): AiError {
  if (err instanceof AiError) return err
  if (err instanceof Anthropic.AuthenticationError) {
    return new AiError('The AI provider rejected the API key. Check it in Settings.', 'auth')
  }
  if (err instanceof Anthropic.RateLimitError) {
    return new AiError('The AI provider is rate-limiting requests. Try again in a minute.', 'rate_limit')
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return new AiError('Could not reach the AI provider. Check the connection.', 'network')
  }
  if (err instanceof Anthropic.APIError) {
    return new AiError(`AI provider error ${err.status}: ${err.message}`, 'other')
  }
  return new AiError(err instanceof Error ? err.message : String(err), 'other')
}

export function anthropicClient(opts: { apiKey: string; model?: string }): AiClient {
  const client = new Anthropic({ apiKey: opts.apiKey })
  const model = opts.model ?? DEFAULT_MODEL

  function textOf(content: Anthropic.ContentBlock[]): string {
    return content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
  }

  return {
    async research(prompt) {
      try {
        const messages: Anthropic.MessageParam[] = [{ role: 'user', content: prompt.user }]
        const transcript: string[] = []

        for (let round = 0; ; round++) {
          const res = await client.messages.create({
            model,
            max_tokens: 16000,
            system: prompt.system,
            tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: MAX_SEARCH_USES }],
            messages
          })

          if (res.stop_reason === 'refusal') {
            throw new AiError('The AI provider declined to research this goal.', 'refusal')
          }

          transcript.push(textOf(res.content))

          if (res.stop_reason === 'pause_turn' && round < MAX_CONTINUATIONS) {
            // Server-side search hit its iteration limit; resend to let it resume.
            messages.push({ role: 'assistant', content: res.content })
            continue
          }
          break
        }

        const findings = transcript.filter(Boolean).join('\n\n')
        if (!findings.trim()) throw new AiError('The research step returned no findings.', 'malformed')
        return findings
      } catch (err) {
        throw translate(err)
      }
    },

    async finalize(prompt) {
      try {
        const res = await client.messages.parse({
          model,
          max_tokens: 16000,
          system: prompt.system,
          messages: [{ role: 'user', content: prompt.user }],
          output_config: { format: zodOutputFormat(GoalPlanSchema) }
        })
        if (res.stop_reason === 'refusal') {
          throw new AiError('The AI provider declined to draft this plan.', 'refusal')
        }
        if (res.stop_reason === 'max_tokens') {
          throw new AiError('The drafted plan was cut off before it finished.', 'malformed')
        }
        if (!res.parsed_output) {
          throw new AiError('The drafted plan did not match the expected shape.', 'malformed')
        }
        return res.parsed_output
      } catch (err) {
        throw translate(err)
      }
    },

    async critique(prompt) {
      try {
        const res = await client.messages.parse({
          model,
          max_tokens: 4000,
          system: prompt.system,
          messages: [{ role: 'user', content: prompt.user }],
          output_config: { format: zodOutputFormat(CritiqueSchema) }
        })
        if (!res.parsed_output) {
          throw new AiError('The review step did not return a verdict.', 'malformed')
        }
        return res.parsed_output
      } catch (err) {
        throw translate(err)
      }
    },

    async fetchPage(url) {
      try {
        // web_fetch only follows URLs already present in the conversation, so the URL
        // has to be spelled out in the user turn. The model's own words are not needed —
        // the page comes back as a document block, which is read directly.
        const res = await client.messages.create({
          model,
          max_tokens: 200,
          system: 'Fetch the URL with the web_fetch tool, then reply with the single word "done".',
          tools: [{ type: 'web_fetch_20260209', name: 'web_fetch', max_uses: 1, max_content_tokens: 2000 }],
          messages: [{ role: 'user', content: `URL: ${url}` }]
        })

        const result = res.content.find(
          (b): b is Anthropic.WebFetchToolResultBlock => b.type === 'web_fetch_tool_result'
        )
        if (!result) return { ok: false, title: null, excerpt: '', error: 'not_fetched' }
        if (result.content.type === 'web_fetch_tool_result_error') {
          return { ok: false, title: null, excerpt: '', error: result.content.error_code }
        }
        const doc = result.content.content
        const excerpt = doc.source.type === 'text' ? doc.source.data.slice(0, EXCERPT_CHARS) : ''
        return { ok: true, title: doc.title, excerpt, error: null }
      } catch (err) {
        const e = translate(err)
        // A verification failure must never sink the whole plan; report and move on.
        if (e.kind === 'auth' || e.kind === 'rate_limit') throw e
        return { ok: false, title: null, excerpt: '', error: e.message }
      }
    },

    async judgeRelevance(pages, topic) {
      if (pages.length === 0) return []
      try {
        const prompt = relevancePrompt(pages, topic)
        const res = await client.messages.parse({
          model,
          max_tokens: 1000,
          system: prompt.system,
          messages: [{ role: 'user', content: prompt.user }],
          output_config: { format: zodOutputFormat(RelevanceSchema) }
        })
        const byUrl = new Map(res.parsed_output?.verdicts.map((v) => [v.url, v.relevant]) ?? [])
        return pages.map((p) => byUrl.get(p.url) ?? true)
      } catch (err) {
        const e = translate(err)
        if (e.kind === 'auth' || e.kind === 'rate_limit') throw e
        // Only the judgement failed; the pages exist. Do not punish the links for it.
        return pages.map(() => true)
      }
    }
  }
}
