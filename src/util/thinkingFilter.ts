/**
 * Strip reasoning blocks from local-model output.
 *
 * Qwen, DeepSeek, and other OSS models emit explicit `<think>...</think>`
 * or `<reasoning>...</reasoning>` spans. We want them hidden from the
 * terminal display *and* from the persistent memory log, otherwise:
 *   - the user sees noise
 *   - future prompts inject stale reasoning as "context", blowing up tokens
 *
 * Also handles partially-streamed blocks: if a `<think>` is opened but not
 * yet closed, suppress output until the closing tag arrives.
 */

const OPEN_TAGS  = ['<think>', '<reasoning>', '<thought>']
const CLOSE_TAGS: Record<string, string> = {
  '<think>':     '</think>',
  '<reasoning>': '</reasoning>',
  '<thought>':   '</thought>'
}

/** One-shot strip for complete text (used when recording to memory). */
export function stripThinking(text: string): string {
  let out = text
  for (const open of OPEN_TAGS) {
    const close = CLOSE_TAGS[open]
    const re = new RegExp(`${open}[\\s\\S]*?${close}`, 'gi')
    out = out.replace(re, '')
  }
  // Also drop any dangling unopened closing tags that leak in rare cases.
  out = out.replace(/<\/(think|reasoning|thought)>/gi, '')
  return out.replace(/\n{3,}/g, '\n\n').trim()
}

/**
 * Stateful streaming filter. Feed it chunks; it returns the portion that
 * should be shown to the user, buffering everything inside a reasoning
 * block. Use one instance per assistant turn.
 */
export class ThinkingStreamFilter {
  private buffer = ''
  private inside = false
  private closeTag = ''

  feed(chunk: string): string {
    this.buffer += chunk
    let out = ''
    // Repeatedly scan for state transitions until the buffer has nothing
    // more to emit.
    while (true) {
      if (!this.inside) {
        // Look for the earliest opening tag.
        let earliest = -1
        let match = ''
        for (const open of OPEN_TAGS) {
          const idx = this.buffer.toLowerCase().indexOf(open)
          if (idx !== -1 && (earliest === -1 || idx < earliest)) {
            earliest = idx
            match = open
          }
        }
        if (earliest === -1) {
          // No opening tag anywhere. Keep the last few chars buffered in
          // case a tag is starting right at the edge.
          const safe = Math.max(0, this.buffer.length - 12)
          out += this.buffer.slice(0, safe)
          this.buffer = this.buffer.slice(safe)
          return out
        }
        // Emit everything before the opening tag, then enter reasoning mode.
        out += this.buffer.slice(0, earliest)
        this.buffer = this.buffer.slice(earliest + match.length)
        this.inside = true
        this.closeTag = CLOSE_TAGS[match]
      } else {
        const idx = this.buffer.toLowerCase().indexOf(this.closeTag)
        if (idx === -1) {
          // Haven't seen the close yet — swallow everything.
          this.buffer = ''
          return out
        }
        this.buffer = this.buffer.slice(idx + this.closeTag.length)
        this.inside = false
        this.closeTag = ''
      }
    }
  }

  /** Flush anything left at end of stream (drops buffered reasoning). */
  flush(): string {
    if (this.inside) {
      this.buffer = ''
      return ''
    }
    const rest = this.buffer
    this.buffer = ''
    return rest
  }
}
