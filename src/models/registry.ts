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
  toolCapable?: boolean  // for LM Studio: model advertises tool_use capability
  offline?: boolean      // local provider was probed but not reachable
}

// ─── static catalogs ────────────────────────────────────────────────────────

// Ordered most-capable → legacy. The picker highlights the first selectable
// entry, so Claude Fable 5.1 (Anthropic's most capable widely released model)
// is the default highlight. IDs are the exact API strings the Claude Code
// subscription accepts — do not append date suffixes except where the model
// only ships as a dated ID (Haiku 4.5).
const ANTHROPIC_MODELS: ModelEntry[] = [
  { provider: 'anthropic', model: 'claude-fable-5-1',           label: 'Claude Fable 5.1  (flagship · most capable)' },
  { provider: 'anthropic', model: 'claude-opus-5',             label: 'Claude Opus 5     (agentic flagship)' },
  { provider: 'anthropic', model: 'claude-sonnet-5',          label: 'Claude Sonnet 5   (balanced · default)' },
  { provider: 'anthropic', model: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5  (fast/cheap)' },
  { provider: 'anthropic', model: 'claude-opus-4-8',           label: 'Claude Opus 4.8   (legacy)' },
  { provider: 'anthropic', model: 'claude-opus-4-6',           label: 'Claude Opus 4.6   (legacy)' },
  { provider: 'anthropic', model: 'claude-sonnet-4-6',         label: 'Claude Sonnet 4.6 (legacy)' },
  { provider: 'anthropic', model: 'claude-sonnet-4-5',         label: 'Claude Sonnet 4.5 (legacy)' }
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

/**
 * Probe LM Studio for available models.
 *
 * The OpenAI-compatible `/v1/models` endpoint does NOT report which model is
 * currently loaded into memory or whether it can call tools — every entry
 * looks identical. LM Studio's native REST API (`/api/v0/models`) does report
 * both (`state: "loaded" | "not-loaded"` and a `capabilities` array that
 * includes `"tool_use"`), so we prefer it and fall back to `/v1/models` only
 * if the native API is unavailable (older LM Studio builds).
 *
 * `baseUrl` is the OpenAI-compatible URL (…/v1); the native API lives at the
 * same host under /api/v0, which we derive from it.
 */
export async function probeLMStudio(baseUrl = LMSTUDIO_URL): Promise<ModelEntry[]> {
  const nativeBase = baseUrl.replace(/\/v1\/?$/, '')

  // Preferred path: native API with state + capabilities.
  const native = await fetchJSON(`${nativeBase}/api/v0/models`) as
    { data?: Array<{ id: string; state?: string; type?: string; capabilities?: string[] }> } | null
  if (native && Array.isArray(native.data) && native.data.length > 0) {
    return native.data
      // Hide pure embedding models from the chat-model picker — they can't
      // drive an agent loop.
      .filter(m => m.type !== 'embeddings')
      .map(m => {
        const loaded = m.state === 'loaded'
        const tools = Array.isArray(m.capabilities) && m.capabilities.includes('tool_use')
        const badges = `${loaded ? '  ●' : ''}${tools ? '' : '  ⚠no-tools'}`
        return {
          provider: 'lmstudio' as const,
          model: m.id,
          label: `LM Studio · ${m.id}${badges}`,
          baseUrl,
          loaded,
          toolCapable: tools
        }
      })
  }

  // Fallback: OpenAI-compatible endpoint (no state/capability info).
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
  // Best: a model already loaded in memory that can call tools.
  const loadedToolCapable = lm.find(m => m.loaded && m.toolCapable)
  if (loadedToolCapable) return loadedToolCapable
  // Next: any loaded model (agent tool loop may be degraded but connection works).
  const loaded = lm.find(m => m.loaded)
  if (loaded) return loaded
  // Next: any installed tool-capable model (LM Studio JIT-loads it on first call).
  const anyToolCapable = lm.find(m => !m.offline && m.toolCapable)
  if (anyToolCapable) return anyToolCapable
  const anyLm = lm.find(m => !m.offline)
  if (anyLm) return anyLm
  const ol = await probeOllama()
  const anyOl = ol.find(m => !m.offline)
  return anyOl || null
}
