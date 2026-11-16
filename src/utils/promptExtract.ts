/**
 * Try to extract the pure prompt text from markdown body.
 * Prefer **提示词** sections; fall back to longest non-meta paragraph.
 */
export function extractPurePrompt(body: string): string {
  const lines = body.split('\n')
  const chunks: string[] = []
  let collecting = false
  let buf: string[] = []

  const flush = () => {
    const t = buf.join('\n').trim()
    if (t) chunks.push(t)
    buf = []
    collecting = false
  }

  for (const raw of lines) {
    const line = raw.trimEnd()
    const stripped = line.trim()

    if (/^\*\*提示词\*\*/.test(stripped) || /^提示词[：:]/.test(stripped)) {
      flush()
      collecting = true
      const after = stripped.replace(/^\*\*提示词\*\*\s*[：:]?\s*/, '').replace(/^提示词[：:]\s*/, '')
      if (after) buf.push(after)
      continue
    }

    if (collecting) {
      if (
        /^#{1,3}\s/.test(stripped) ||
        /^\*\*[^*]+\*\*\s*[：:]?\s*$/.test(stripped) ||
        /^---+$/.test(stripped) ||
        /^>\s*/.test(stripped) && /用途|风格|适用|说明/.test(stripped)
      ) {
        flush()
        continue
      }
      if (stripped === '' && buf.length > 0 && buf[buf.length - 1] === '') {
        flush()
        continue
      }
      buf.push(line)
    }
  }
  flush()

  if (chunks.length > 0) {
    return chunks.join('\n\n').trim()
  }

  // Fallback: strip blockquotes / headings / bold labels, take substantial paragraphs
  const paras = body
    .split(/\n{2,}/)
    .map((p) =>
      p
        .split('\n')
        .filter((l) => {
          const t = l.trim()
          if (!t) return false
          if (t.startsWith('>')) return false
          if (/^#{1,6}\s/.test(t)) return false
          if (/^---+$/.test(t)) return false
          if (/^\*\*[^*]+\*\*\s*$/.test(t)) return false
          return true
        })
        .join('\n')
        .replace(/^\*\*[^*]+\*\*[：:]\s*/gm, '')
        .trim(),
    )
    .filter((p) => p.length > 40)

  if (paras.length === 0) return body.trim()
  return paras.sort((a, b) => b.length - a.length)[0]
}
