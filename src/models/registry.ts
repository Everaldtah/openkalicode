/**
 * OpenKaliClaude — Model Registry
 *
 * Catalogs models from every supported provider and probes local runtimes
 * (LM Studio, Ollama) for whatever the user actually has loaded.
 *
 * The `/models` command in the REPL uses this to populate its scrollable
 * picker; `auto-detect local` uses `probeLocal()` on startup to find a
 * running LM Studio / Ollama instance without the user having to configure
 * anything.
 */

import type { LocalProvider } from '../agent/local.js'

export type ProviderKind = 'anthropic' | LocalProvider | 'openai'

export interface ModelEntry {
  provider: ProviderKind
  model: string
  label: string          // shown in the picker
  baseUrl?: string       // only for local/openai-compatible
  loaded?: boolean       // for LM Studio: true if currently loaded in memory
  offline?: boolean      // local provider was probed but not reachable
}

// ─── static catalogs ────────────────────────────────────────────────────────

const ANTHROPIC_MODELS: ModelEntry[] = [
  { provider: 'anthropic', model: 'claude-opus-4-6',     label: 'Claude Opus 4.6  (flagship)' },
  { provider: 'anthropic', model: 'claude-sonnet-4-6',   label: 'Claude Sonnet 4.6 (default)' },
  { provider: 'anthropic', model: 'claude-haiku-4-5',    label: 'Claude Haiku 4.5  (fast/cheap)' },
  { provider: 'anthropic', model: 'claude-opus-4-5',     label: 'Claude Opus 4.5' },
  { provider: 'anthropic', model: 'claude-sonnet-4-5',   label: 'Claude Sonnet 4.5' }
]

const OPENAI_MODELS: ModelEntry[] = [
  { provider: 'openai', model: 'gpt-4o',          label: 'OpenAI GPT-4o',            baseUrl: 'https://api.openai.com/v1' },
  { provider: 'openai', model: 'gpt-4o-mini',     label: 'OpenAI GPT-4o mini',       baseUrl: 'https://api.openai.com/v1' },
  { provider: 'openai', model: 'o1',              label: 'OpenAI o1 (reasoning)',    baseUrl: 'https://api.openai.com/v1' },
  { provider: 'openai', model: 'o1-mini',         label: 'OpenAI o1-mini',           baseUrl: 'https://api.openai.com/v1' }
]

export const LMSTUDIO_URL = 'http://localhost:1234/v1'
export const OLLAMA_URL   = 'http://localhost:11434'

// ─── probes ─────────────────────────────────────────────────────────────────

async function fetchJSON(url: string, timeoutMs = 800): Promise<unknown | null> {
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), timeoutMs)
    const res = await fetch(url, { signal: ctrl.signal })
    clearTimeout(t)
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

/** Probe LM Studio's OpenAI-compatible /v1/models endpoint. */
export async function probeLMStudio(baseUrl = LMSTUDIO_URL): Promise<ModelEntry[]> {
  const data = await fetchJSON(`${baseUrl}/models`) as { data?: Array<{ id: string; state?: string }> } | null
  if (!data || !Array.isArray(data.data)) {
    return [{ provider: 'lmstudio', model: '(not running)', label: 'LM Studio — offline', baseUrl, offline: true }]
  }
  if (data.data.length === 0) {
    return [{ provider: 'lmstudio', model: '(no models loaded)', label: 'LM Studio — no model loaded', baseUrl, offline: true }]
  }
  return data.data.map(m => ({
    provider: 'lmstudio' as const,
    model: m.id,
    label: `LM Studio · ${m.id}${m.state === 'loaded' ? '  ●' : ''}`,
    baseUrl,
    loaded: m.state === 'loaded'
  }))
}

/** Probe Ollama's /api/tags for installed models. */
export async function probeOllama(baseUrl = OLLAMA_URL): Promise<ModelEntry[]> {
  const data = await fetchJSON(`${baseUrl}/api/tags`) as { models?: Array<{ name: string }> } | null
  if (!data || !Array.isArray(data.models)) {
    return [{ provider: 'ollama', model: '(not running)', label: 'Ollama — offline', baseUrl: `${baseUrl}/v1`, offline: true }]
  }
  if (data.models.length === 0) {
    return [{ provider: 'ollama', model: '(no models installed)', label: 'Ollama — no models', baseUrl: `${baseUrl}/v1`, offline: true }]
  }
  return data.models.map(m => ({
    provider: 'ollama' as const,
    model: m.name,
    label: `Ollama · ${m.name}`,
    baseUrl: `${baseUrl}/v1`
  }))
}

/**
 * Build a full catalog for the picker: Anthropic + OpenAI + live-probed
 * LM Studio and Ollama entries. Probes run in parallel and are tolerant of
 * failures — offline providers still appear in the list so the user can see
 * what's available (and see why it isn't).
 */
export async function buildCatalog(): Promise<ModelEntry[]> {
  const [lm, ol] = await Promise.all([probeLMStudio(), probeOllama()])
  return [...ANTHROPIC_MODELS, ...OPENAI_MODELS, ...lm, ...ol]
}

/**
 * Auto-detect a running local model. Used when the user selects "local" mode
 * implicitly (e.g. no Anthropic credentials available, or explicit
 * --provider=local). LM Studio takes priority because it's explicit about
 * which model is *loaded* in memory vs. just installed.
 */
export async function autoDetectLocal(): Promise<ModelEntry | null> {
  const lm = await probeLMStudio()
  const loaded = lm.find(m => m.loaded)
  if (loaded) return loaded
  const anyLm = lm.find(m => !m.offline)
  if (anyLm) return anyLm
  const ol = await probeOllama()
  const anyOl = ol.find(m => !m.offline)
  return anyOl || null
}
