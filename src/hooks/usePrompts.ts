import { useCallback, useEffect, useMemo, useState } from 'react'
import type { PromptItem, PromptsData } from '../types'
import { CATEGORY_SLUG } from '../types'

const LOCAL_KEY = 'prompt-gallery-local-items'

function loadLocal(): PromptItem[] {
  try {
    const raw = localStorage.getItem(LOCAL_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as PromptItem[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function saveLocal(items: PromptItem[]) {
  localStorage.setItem(LOCAL_KEY, JSON.stringify(items))
}

export function usePrompts() {
  const [base, setBase] = useState<PromptItem[]>([])
  const [local, setLocal] = useState<PromptItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [meta, setMeta] = useState<{ count: number; categories: Record<string, number> } | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('./data/prompts.json')
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = (await res.json()) as PromptsData
        if (cancelled) return
        setBase(data.items)
        setMeta({ count: data.count, categories: data.categories })
        setLocal(loadLocal())
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const items = useMemo(() => {
    const ids = new Set(local.map((i) => i.id))
    return [...base.filter((b) => !ids.has(b.id)), ...local]
  }, [base, local])

  const addItem = useCallback((partial: Omit<PromptItem, 'id' | 'categorySlug' | 'local'> & { id?: string }) => {
    const slug = CATEGORY_SLUG[partial.category]
    const id =
      partial.id ??
      `local-${slug}-${Date.now().toString(36)}`
    const item: PromptItem = {
      ...partial,
      id,
      categorySlug: slug,
      local: true,
      cover: partial.cover ?? null,
    }
    setLocal((prev) => {
      const next = [...prev.filter((p) => p.id !== id), item]
      saveLocal(next)
      return next
    })
    return item
  }, [])

  const removeLocal = useCallback((id: string) => {
    setLocal((prev) => {
      const next = prev.filter((p) => p.id !== id)
      saveLocal(next)
      return next
    })
  }, [])

  const exportJson = useCallback(() => {
    const payload: PromptsData = {
      generatedFrom: 'prompt-gallery export (base + local)',
      count: items.length,
      categories: items.reduce<Record<string, number>>((acc, it) => {
        acc[it.category] = (acc[it.category] ?? 0) + 1
        return acc
      }, {}),
      items: items.map(({ coverDataUrl: _c, local: _l, ...rest }) => ({
        ...rest,
        cover: rest.cover,
      })),
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json',
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'prompts.json'
    a.click()
    URL.revokeObjectURL(url)
  }, [items])

  return { items, loading, error, meta, addItem, removeLocal, exportJson, localCount: local.length }
}
