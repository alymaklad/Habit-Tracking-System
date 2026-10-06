import type { AiProvider } from '@shared/types'
import { anthropicClient, DEFAULT_MODEL as ANTHROPIC_DEFAULT_MODEL, type AiClient } from './anthropicClient'
import { GROQ_DEFAULT_MODEL, GROQ_PLAN_MODELS, groqClient } from './groqClient'

export interface ProviderInfo {
  id: AiProvider
  label: string
  defaultModel: string
  keyPlaceholder: string
  /** Shown under the model field in Settings. */
  note: string
  create(apiKey: string, model: string): AiClient
}

/**
 * Every provider the planner can run on. Adding one is a new adapter that satisfies
 * `AiClient` plus an entry here; nothing in the loop, the service or the wizard changes.
 */
export const PROVIDERS: Record<AiProvider, ProviderInfo> = {
  anthropic: {
    id: 'anthropic',
    label: 'Anthropic (Claude)',
    defaultModel: ANTHROPIC_DEFAULT_MODEL,
    keyPlaceholder: 'sk-ant-…',
    note: 'Uses Claude with built-in web search and link verification.',
    create: (apiKey, model) => anthropicClient({ apiKey, model })
  },
  groq: {
    id: 'groq',
    label: 'Groq',
    defaultModel: GROQ_DEFAULT_MODEL,
    keyPlaceholder: 'gsk_…',
    note: 'Research runs on groq/compound (built-in search); this model drafts and reviews the plan. It needs JSON-schema support — openai/gpt-oss-20b or openai/gpt-oss-120b; if the chosen one is rate-limited, the other takes over.',
    create: (apiKey, model) => groqClient({ apiKey, model, fallbackModels: GROQ_PLAN_MODELS })
  }
}

export const PROVIDER_IDS = Object.keys(PROVIDERS) as AiProvider[]

export function isProvider(value: unknown): value is AiProvider {
  return typeof value === 'string' && value in PROVIDERS
}
