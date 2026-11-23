import type { PromptItem } from '../types'

/** Unique still paths for a card. `covers` wins when present; otherwise the primary cover. */
export function itemGallery(item: PromptItem): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  const add = (src: string | null | undefined) => {
    const value = src?.trim()
    if (!value || seen.has(value)) return
    seen.add(value)
    out.push(value)
  }
  if (item.covers && item.covers.length > 0) {
    for (const src of item.covers) add(src)
  } else {
    add(item.cover)
  }
  return out
}
