import { useCallback, useEffect, useMemo, useState } from 'react'

export const LIKES_KEY = 'prompt-gallery-likes'

function loadLikes(): string[] {
  try {
    const raw = localStorage.getItem(LIKES_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    const source = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === 'object' && Array.isArray((parsed as { ids?: unknown }).ids)
        ? (parsed as { ids: unknown[] }).ids
        : []
    const ids: string[] = []
    const seen = new Set<string>()
    for (const value of source) {
      if (typeof value === 'string' && value && !seen.has(value)) {
        seen.add(value)
        ids.push(value)
      }
    }
    return ids
  } catch {
    return []
  }
}

function saveLikes(ids: string[]) {
  try {
    localStorage.setItem(LIKES_KEY, JSON.stringify(ids))
  } catch {
    /* private mode or quota */
  }
}

export function useLikes() {
  const [ids, setIds] = useState<string[]>(() =>
    typeof window === 'undefined' ? [] : loadLikes(),
  )

  useEffect(() => {
    saveLikes(ids)
  }, [ids])

  const idSet = useMemo(() => new Set(ids), [ids])

  const isLiked = useCallback((id: string) => idSet.has(id), [idSet])

  const toggle = useCallback((itemId: string) => {
    setIds((prev) => (prev.includes(itemId) ? prev.filter((id) => id !== itemId) : [...prev, itemId]))
  }, [])

  return { ids, idSet, isLiked, toggle, count: ids.length }
}
