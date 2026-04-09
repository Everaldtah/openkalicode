/**
 * OpenKaliClaude — Model Picker (readline, no Ink)
 *
 * Renders a scrollable, arrow-key-navigable list of model entries built by
 * `buildCatalog()`. Returns the chosen ModelEntry (or null on escape).
 *
 * Kept framework-free on purpose: the rest of the REPL is plain readline +
 * chalk, and adding Ink just for one picker would pull JSX into tsc.
 */

import readline from 'node:readline'
import chalk from 'chalk'
import { buildCatalog, ModelEntry } from '../models/registry.js'

const C = {
  title:  chalk.hex('#2EA8FF').bold,
  border: chalk.hex('#1B6FB8'),
  hl:     chalk.bgHex('#1B6FB8').whiteBright.bold,
  dim:    chalk.gray,
  offline:chalk.hex('#555555'),
  hint:   chalk.dim
}

const GROUPS: Array<{ label: string; match: (e: ModelEntry) => boolean }> = [
  { label: 'Anthropic',  match: e => e.provider === 'anthropic' },
  { label: 'OpenAI',     match: e => e.provider === 'openai' },
  { label: 'LM Studio (local)', match: e => e.provider === 'lmstudio' },
  { label: 'Ollama (local)',    match: e => e.provider === 'ollama' }
]

interface Row {
  kind: 'header' | 'entry'
  text: string
  entry?: ModelEntry
}

function buildRows(catalog: ModelEntry[]): Row[] {
  const rows: Row[] = []
  for (const g of GROUPS) {
    const items = catalog.filter(g.match)
    if (items.length === 0) continue
    rows.push({ kind: 'header', text: g.label })
    for (const e of items) rows.push({ kind: 'entry', text: e.label, entry: e })
  }
  return rows
}

/** Find the first selectable (entry) row index. */
function firstSelectable(rows: Row[], from = 0): number {
  for (let i = from; i < rows.length; i++) if (rows[i].kind === 'entry' && !rows[i].entry?.offline) return i
  for (let i = from; i < rows.length; i++) if (rows[i].kind === 'entry') return i
  return -1
}

function render(rows: Row[], selected: number, scroll: number, height: number): string {
  const lines: string[] = []
  lines.push(C.title('  Select a model') + C.hint('   ↑/↓ navigate · Enter choose · Esc cancel'))
  lines.push(C.border('  ' + '─'.repeat(60)))
  const end = Math.min(rows.length, scroll + height)
  for (let i = scroll; i < end; i++) {
    const r = rows[i]
    if (r.kind === 'header') {
      lines.push('  ' + C.title(r.text))
      continue
    }
    const prefix = i === selected ? '▶ ' : '  '
    const body = r.entry?.offline ? C.offline(r.text) : r.text
    const line = prefix + body
    lines.push(i === selected ? C.hl(line.padEnd(60)) : '  ' + line)
  }
  if (rows.length > height) {
    lines.push(C.dim(`  ── ${scroll + 1}-${end} of ${rows.length} ──`))
  }
  return lines.join('\n')
}

/**
 * Show the scrollable picker. Assumes caller has already paused its own
 * readline interface so we can take over stdin in raw mode.
 */
export async function showModelPicker(): Promise<ModelEntry | null> {
  process.stdout.write(C.dim('\n  loading model catalog…\n'))
  const catalog = await buildCatalog()
  const rows = buildRows(catalog)
  if (rows.length === 0) {
    console.log(C.dim('  no models available.'))
    return null
  }

  let selected = firstSelectable(rows)
  if (selected === -1) return null
  const height = Math.max(8, Math.min(18, (process.stdout.rows || 24) - 6))
  let scroll = 0

  const stdin = process.stdin
  const wasRaw = stdin.isRaw
  readline.emitKeypressEvents(stdin)
  if (stdin.isTTY) stdin.setRawMode(true)
  stdin.resume()

  const clear = () => {
    // Move cursor up & clear previous render
    const total = Math.min(rows.length, height) + 3
    process.stdout.write(`\x1b[${total}A\x1b[0J`)
  }

  const draw = (first = false) => {
    if (!first) clear()
    // Keep selected in view
    if (selected < scroll) scroll = selected
    if (selected >= scroll + height) scroll = selected - height + 1
    process.stdout.write(render(rows, selected, scroll, height) + '\n')
  }

  draw(true)

  return new Promise<ModelEntry | null>(resolve => {
    const onKey = (_str: string, key: { name?: string; ctrl?: boolean }) => {
      if (!key) return
      if (key.name === 'up') {
        for (let i = selected - 1; i >= 0; i--) if (rows[i].kind === 'entry') { selected = i; break }
        draw()
      } else if (key.name === 'down') {
        for (let i = selected + 1; i < rows.length; i++) if (rows[i].kind === 'entry') { selected = i; break }
        draw()
      } else if (key.name === 'pageup') {
        selected = Math.max(0, selected - height)
        while (selected < rows.length && rows[selected].kind !== 'entry') selected++
        draw()
      } else if (key.name === 'pagedown') {
        selected = Math.min(rows.length - 1, selected + height)
        while (selected >= 0 && rows[selected].kind !== 'entry') selected--
        draw()
      } else if (key.name === 'return') {
        cleanup()
        const e = rows[selected].entry || null
        resolve(e && !e.offline ? e : null)
      } else if (key.name === 'escape' || (key.ctrl && key.name === 'c')) {
        cleanup()
        resolve(null)
      }
    }
    const cleanup = () => {
      stdin.removeListener('keypress', onKey)
      if (stdin.isTTY) stdin.setRawMode(!!wasRaw)
    }
    stdin.on('keypress', onKey)
  })
}
