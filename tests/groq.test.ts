import { describe, expect, it } from 'vitest'
import { AiError } from '@main/ai/anthropicClient'
import { GoalPlanSchema } from '@main/ai/goalPlanSchema'
import {
  GROQ_DEFAULT_MODEL,
  GROQ_RESEARCH_FALLBACK_MODEL,
  GROQ_RESEARCH_MODEL,
  groqClient,
  toStrictSchema
} from '@main/ai/groqClient'
import { samplePlan } from './fakeAi'

type Call = { url: string; body: Record<string, unknown> | null; headers: Record<string, string> }

/** A scripted `fetch`: each queued responder answers the next request, in order. */
function fakeFetch(responders: ((call: Call) => Response)[]) {
  const calls: Call[] = []
  const impl = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    const headers = Object.fromEntries(
      Object.entries((init?.headers as Record<string, string>) ?? {}).map(([k, v]) => [k.toLowerCase(), v])
    )
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null
    const call = { url, body, headers }
    calls.push(call)
    const next = responders.shift()
    if (!next) throw new Error(`unexpected request #${calls.length} to ${url}`)
    return next(call)
  }
  return { impl: impl as unknown as typeof fetch, calls }
}

const json = (status: number, data: unknown): Response =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } })

const chat = (content: string, finish = 'stop'): Response =>
  json(200, { choices: [{ message: { content }, finish_reason: finish }] })

const prompt = { system: 'sys', user: 'usr' }

describe('toStrictSchema', () => {
  it('produces a schema Groq strict mode accepts: every object closed and fully required', () => {
    const s = toStrictSchema(GoalPlanSchema) as {
      additionalProperties: boolean
      required: string[]
      properties: Record<string, { items?: { additionalProperties?: boolean; required?: string[] } }>
      $schema?: string
    }
    expect(s.$schema).toBeUndefined()
    expect(s.additionalProperties).toBe(false)
    expect(s.required).toEqual(['summary', 'sessions', 'milestones', 'mindMap', 'resources'])
    expect(s.properties.sessions!.items!.additionalProperties).toBe(false)
    expect(s.properties.sessions!.items!.required).toContain('rationale')
    expect(JSON.stringify(s)).not.toContain('9007199254740991')
  })
})

describe('groqClient', () => {
  it('sends research to the compound system and the plan to the chosen model', async () => {
    const f = fakeFetch([() => chat('some findings'), () => chat(JSON.stringify(samplePlan()))])
    const ai = groqClient({ apiKey: 'gsk_test', fetchImpl: f.impl })

    expect(await ai.research(prompt)).toBe('some findings')
    expect(f.calls[0]!.body!.model).toBe(GROQ_RESEARCH_MODEL)
    expect(f.calls[0]!.headers.authorization).toBe('Bearer gsk_test')

    const plan = await ai.finalize(prompt)
    expect(plan.sessions).toHaveLength(2)
    const body = f.calls[1]!.body as { model: string; response_format: { type: string; json_schema: { strict: boolean; name: string } } }
    expect(body.model).toBe(GROQ_DEFAULT_MODEL)
    expect(body.response_format.type).toBe('json_schema')
    expect(body.response_format.json_schema.strict).toBe(true)
    expect(body.response_format.json_schema.name).toBe('goal_plan')
  })

  it('falls back to JSON-object mode when the model rejects json_schema', async () => {
    const f = fakeFetch([
      () => json(400, { error: { message: 'response_format json_schema is not supported for this model' } }),
      () => chat('```json\n' + JSON.stringify(samplePlan()) + '\n```')
    ])
    const ai = groqClient({ apiKey: 'k', model: 'llama-3.3-70b-versatile', fetchImpl: f.impl })
    const plan = await ai.finalize(prompt)
    expect(plan.summary).toBe(samplePlan().summary)
    const second = f.calls[1]!.body as { response_format: { type: string }; messages: { content: string }[] }
    expect(second.response_format.type).toBe('json_object')
    expect(second.messages[0]!.content).toContain('"additionalProperties":false')
  })

  it('still validates the fallback output against the schema', async () => {
    const f = fakeFetch([() => json(400, { error: { message: 'nope' } }), () => chat('{"summary": "only this"}')])
    const ai = groqClient({ apiKey: 'k', fetchImpl: f.impl })
    await expect(ai.finalize(prompt)).rejects.toThrow(/did not match the expected shape/)
  })

  it('parses a critique', async () => {
    const f = fakeFetch([() => chat('{"verdict":"fail","feedback":["Too ambitious."]}')])
    const ai = groqClient({ apiKey: 'k', fetchImpl: f.impl })
    expect(await ai.critique(prompt)).toEqual({ verdict: 'fail', feedback: ['Too ambitious.'] })
  })

  it('translates auth, rate-limit and truncation into the shared error kinds', async () => {
    const auth = groqClient({ apiKey: 'bad', fetchImpl: fakeFetch([() => json(401, {})]).impl })
    await expect(auth.research(prompt)).rejects.toMatchObject({ kind: 'auth' })

    const limited = groqClient({
      apiKey: 'k',
      fetchImpl: fakeFetch([() => json(429, {}), () => json(429, {}), () => json(429, {}), () => json(429, {})]).impl,
      sleepImpl: async () => undefined
    })
    await expect(limited.research(prompt)).rejects.toMatchObject({ kind: 'rate_limit' })

    const cut = groqClient({ apiKey: 'k', fetchImpl: fakeFetch([() => chat('partial', 'length')]).impl })
    await expect(cut.critique(prompt)).rejects.toBeInstanceOf(AiError)
    await expect(
      groqClient({ apiKey: 'k', fetchImpl: fakeFetch([() => chat('partial', 'length')]).impl }).critique(prompt)
    ).rejects.toMatchObject({ kind: 'malformed' })
  })

  describe('research fallback chain', () => {
    const entityTooLarge = () => new Response('Request Entity Too Large', { status: 413 })

    it('falls back to compound-mini when compound refuses with a bare 413', async () => {
      const f = fakeFetch([entityTooLarge, () => chat('findings from mini')])
      const ai = groqClient({ apiKey: 'k', fetchImpl: f.impl })
      expect(await ai.research(prompt)).toBe('findings from mini')
      expect(f.calls.map((c) => c.body!.model)).toEqual([GROQ_RESEARCH_MODEL, GROQ_RESEARCH_FALLBACK_MODEL])
    })

    it('falls back to the plan model without search when both compound systems refuse, and says so', async () => {
      const f = fakeFetch([entityTooLarge, entityTooLarge, () => chat('what I know')])
      const ai = groqClient({ apiKey: 'k', fetchImpl: f.impl })
      const findings = await ai.research(prompt)
      expect(findings).toMatch(/^\(Researched without web search/)
      expect(findings).toContain('what I know')
      expect(f.calls.map((c) => c.body!.model)).toEqual([GROQ_RESEARCH_MODEL, GROQ_RESEARCH_FALLBACK_MODEL, GROQ_DEFAULT_MODEL])
      const system = (f.calls[2]!.body as { messages: { content: string }[] }).messages[0]!.content
      expect(system).toContain('do not have web access')
    })

    it('reports what every model said when all of them fail, not just the last', async () => {
      const f = fakeFetch([entityTooLarge, entityTooLarge, () => chat('', 'length')])
      const ai = groqClient({ apiKey: 'k', fetchImpl: f.impl })
      await expect(ai.research(prompt)).rejects.toThrow(
        /groq\/compound: .*too large.* · groq\/compound-mini: .*too large.* · openai\/gpt-oss-120b: .*(cut off|empty)/
      )
    })

    it('keeps research findings that were cut short by the output cap', async () => {
      const f = fakeFetch([() => chat('partial but useful findings', 'length')])
      const ai = groqClient({ apiKey: 'k', fetchImpl: f.impl })
      expect(await ai.research(prompt)).toBe('partial but useful findings')
    })

    it('asks gpt-oss models for light reasoning so the answer fits the cap, and leaves others alone', async () => {
      const f = fakeFetch([entityTooLarge, entityTooLarge, () => chat('ok')])
      await groqClient({ apiKey: 'k', fetchImpl: f.impl }).research(prompt)
      expect(f.calls[0]!.body!.reasoning_effort).toBeUndefined() // groq/compound
      expect(f.calls[2]!.body).toMatchObject({ model: GROQ_DEFAULT_MODEL, reasoning_effort: 'low', include_reasoning: false })

      const g = fakeFetch([() => chat('{"verdict":"pass","feedback":[]}')])
      await groqClient({ apiKey: 'k', model: 'qwen/qwen3.8-27b', fetchImpl: g.impl }).critique(prompt)
      expect(g.calls[0]!.body!.reasoning_effort).toBeUndefined()
    })

    it('does not fall through on an auth failure', async () => {
      const f = fakeFetch([() => json(401, {})])
      const ai = groqClient({ apiKey: 'bad', fetchImpl: f.impl })
      await expect(ai.research(prompt)).rejects.toMatchObject({ kind: 'auth' })
      expect(f.calls).toHaveLength(1)
    })
  })

  describe('rate limits and request size', () => {
    it('waits the time Groq asks for on 429 and then retries', async () => {
      const waits: number[] = []
      const f = fakeFetch([
        () => new Response('{}', { status: 429, headers: { 'retry-after': '3' } }),
        () => chat('findings')
      ])
      const ai = groqClient({ apiKey: 'k', fetchImpl: f.impl, sleepImpl: async (ms) => void waits.push(ms) })
      expect(await ai.research(prompt)).toBe('findings')
      expect(waits).toEqual([3000])
      expect(f.calls).toHaveLength(2)
    })

    it('gives up with a clear rate-limit error once the retries are spent', async () => {
      const f = fakeFetch([
        () => new Response('{}', { status: 429, headers: { 'retry-after': '1' } }),
        () => new Response('{}', { status: 429, headers: { 'retry-after': '1' } }),
        () => new Response('{}', { status: 429, headers: { 'retry-after': '1' } }),
        () => new Response('{}', { status: 429, headers: { 'retry-after': '1' } })
      ])
      const ai = groqClient({ apiKey: 'k', fetchImpl: f.impl, sleepImpl: async () => undefined })
      await expect(ai.research(prompt)).rejects.toMatchObject({ kind: 'rate_limit' })
      expect(f.calls).toHaveLength(4)
    })

    it('does not wait longer than the cap, even if asked to', async () => {
      const waits: number[] = []
      const f = fakeFetch([() => new Response('{}', { status: 429, headers: { 'retry-after': '120' } })])
      const ai = groqClient({ apiKey: 'k', fetchImpl: f.impl, sleepImpl: async (ms) => void waits.push(ms) })
      await expect(ai.research(prompt)).rejects.toMatchObject({ kind: 'rate_limit' })
      expect(waits).toEqual([])
    })

    it('explains a 413 instead of echoing "Request Entity Too Large"', async () => {
      const f = fakeFetch([() => new Response('Request Entity Too Large', { status: 413 })])
      const ai = groqClient({ apiKey: 'k', fetchImpl: f.impl })
      await expect(ai.finalize(prompt)).rejects.toThrow(/too large for this model or plan/)
    })

    it('reads the limit Groq reports on 413, shrinks the output cap to fit, and retries once', async () => {
      const tooLarge = () =>
        json(413, {
          error: {
            message:
              'Request too large for model `openai/gpt-oss-120b` in organization `org_x` service tier `on_demand` on tokens per minute (TPM): Limit 8000, Requested 9200, please reduce your message size and try again.',
            type: 'tokens',
            code: 'rate_limit_exceeded'
          }
        })
      const f = fakeFetch([tooLarge, () => chat(JSON.stringify(samplePlan()))])
      const ai = groqClient({ apiKey: 'k', fetchImpl: f.impl })
      const plan = await ai.finalize(prompt)
      expect(plan.sessions).toHaveLength(2)
      const first = f.calls[0]!.body!.max_tokens as number // 3000
      const second = f.calls[1]!.body!.max_tokens as number
      // prompt = 9200 − 3000 = 6200; room = 8000 − 6200 − 100 = 1700
      expect(first).toBe(3000)
      expect(second).toBe(1700)
    })

    it('gives a precise message when even the prompt alone is over the limit', async () => {
      const f = fakeFetch([
        () =>
          json(413, {
            error: { message: 'Request too large ... tokens per minute (TPM): Limit 6000, Requested 9200, please reduce' }
          })
      ])
      const ai = groqClient({ apiKey: 'k', fetchImpl: f.impl })
      // prompt = 9200 − 3000 = 6200 > 6000: no cap can make this fit
      await expect(ai.finalize(prompt)).rejects.toThrow(/about 6000 tokens per request .* prompt alone is ~6200/)
      expect(f.calls).toHaveLength(1)
    })

    it('only shrinks once — a second 413 is reported, not looped on', async () => {
      const tooLarge = () =>
        json(413, { error: { message: 'tokens per minute (TPM): Limit 8000, Requested 9200, please reduce' } })
      const f = fakeFetch([tooLarge, tooLarge])
      const ai = groqClient({ apiKey: 'k', fetchImpl: f.impl })
      await expect(ai.finalize(prompt)).rejects.toThrow(/too large/)
      expect(f.calls).toHaveLength(2)
    })

    it('keeps output caps small enough for a free-tier request', async () => {
      const f = fakeFetch([() => chat('r'), () => chat(JSON.stringify(samplePlan())), () => chat('{"verdict":"pass","feedback":[]}')])
      const ai = groqClient({ apiKey: 'k', fetchImpl: f.impl })
      await ai.research(prompt)
      await ai.finalize(prompt)
      await ai.critique(prompt)
      const caps = f.calls.map((c) => c.body!.max_tokens as number)
      expect(Math.max(...caps)).toBeLessThanOrEqual(3000)
    })
  })

  describe('fetchPage', () => {
    it('fetches the page itself and returns its title and opening text, with no model call', async () => {
      const f = fakeFetch([
        () =>
          new Response('<html><head><title>Language Transfer — Spanish</title></head><body>Free audio course</body></html>', {
            status: 200,
            headers: { 'content-type': 'text/html' }
          })
      ])
      const ai = groqClient({ apiKey: 'k', fetchImpl: f.impl })
      const page = await ai.fetchPage('https://www.languagetransfer.org/')
      expect(page).toMatchObject({ ok: true, title: 'Language Transfer — Spanish', excerpt: 'Free audio course' })
      expect(f.calls).toHaveLength(1)
      expect(f.calls[0]!.url).toBe('https://www.languagetransfer.org/')
    })

    it('reports a dead link', async () => {
      const f = fakeFetch([() => new Response('gone', { status: 404 })])
      const ai = groqClient({ apiKey: 'k', fetchImpl: f.impl })
      expect(await ai.fetchPage('https://example.com/missing')).toMatchObject({ ok: false, error: 'http_404' })
    })

    it('treats a network failure as unreachable, never as a crash', async () => {
      const ai = groqClient({
        apiKey: 'k',
        fetchImpl: (async () => {
          throw new TypeError('fetch failed')
        }) as unknown as typeof fetch
      })
      expect(await ai.fetchPage('https://example.com/')).toMatchObject({ ok: false, error: 'url_not_accessible' })
    })
  })

  describe('judgeRelevance', () => {
    const pages = [
      { url: 'https://a.example/', title: 'A', excerpt: 'about spanish' },
      { url: 'https://b.example/', title: 'B', excerpt: 'parked domain' }
    ]

    it('judges all pages in one structured call, keyed by URL', async () => {
      const f = fakeFetch([
        () => chat(JSON.stringify({ verdicts: [{ url: 'https://b.example/', relevant: false }, { url: 'https://a.example/', relevant: true }] }))
      ])
      const ai = groqClient({ apiKey: 'k', fetchImpl: f.impl })
      expect(await ai.judgeRelevance(pages, 'Learn Spanish')).toEqual([true, false])
      expect(f.calls).toHaveLength(1)
      const body = f.calls[0]!.body as { response_format: { json_schema: { name: string } }; messages: { content: string }[] }
      expect(body.response_format.json_schema.name).toBe('relevance')
      expect(body.messages[1]!.content).toContain('https://b.example/')
    })

    it('keeps every link when the judgement itself fails', async () => {
      const f = fakeFetch([() => json(500, { error: { message: 'boom' } }), () => json(500, {}), () => json(500, {}), () => json(500, {})])
      const ai = groqClient({ apiKey: 'k', fetchImpl: f.impl, sleepImpl: async () => undefined })
      expect(await ai.judgeRelevance(pages, 'x')).toEqual([true, true])
    })

    it('makes no call for an empty list', async () => {
      const f = fakeFetch([])
      const ai = groqClient({ apiKey: 'k', fetchImpl: f.impl })
      expect(await ai.judgeRelevance([], 'x')).toEqual([])
      expect(f.calls).toHaveLength(0)
    })
  })
})
