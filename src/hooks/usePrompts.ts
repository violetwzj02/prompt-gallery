import { useCallback, useEffect, useMemo, useState } from 'react'
import type { CollectionInfo, PromptItem, PromptsData, TagFacets } from '../types'
import { categorySlug } from '../utils/category'
import { normalizeItem } from '../utils/filters'
import {
  allocateStyleId,
  fetchSharedStyles,
  mergeLocalIntoAccount,
  toStylePayload,
} from '../lib/accountSync'
import { loadLocalItems, saveLocalItems } from '../lib/localStore'
import { supabase, syncErrorMessage } from '../lib/supabase'

export interface GalleryMeta {
  count: number
  masterCount?: number
  categories: Record<string, number>
  collections: CollectionInfo[]
  tagFacets: TagFacets
}

export function usePrompts(userId: string | null = null, authLoading = false) {
  const [base, setBase] = useState<PromptItem[]>([])
  const [local, setLocal] = useState<PromptItem[]>([])
  const [shared, setShared] = useState<PromptItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [syncError, setSyncError] = useState<string | null>(null)
  const [meta, setMeta] = useState<GalleryMeta | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('./data/prompts.json')
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = (await res.json()) as PromptsData
        if (cancelled) return
        setBase(data.items.map(normalizeItem))
        setMeta({
          count: data.count,
          masterCount: data.masterCount,
          categories: data.categories,
          collections: data.collections ?? [],
          tagFacets: data.tagFacets ?? { medium: [], aspect: [], style: [] },
        })
        setLocal(loadLocalItems())
        if (supabase) {
          try {
            const styles = await fetchSharedStyles()
            if (!cancelled) setShared(styles)
          } catch {
            if (!cancelled) setSyncError(syncErrorMessage('载入公共风格'))
          }
        }
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

  useEffect(() => {
    if (authLoading || !userId || !supabase) return
    let cancelled = false
    ;(async () => {
      try {
        await mergeLocalIntoAccount(userId)
        if (cancelled) return
        const styles = await fetchSharedStyles()
        if (!cancelled) {
          setShared(styles)
          setSyncError(null)
        }
      } catch {
        if (!cancelled) setSyncError(syncErrorMessage('同步自定义风格'))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [userId, authLoading])

  const items = useMemo(() => {
    const overlay = new Map<string, PromptItem>()
    if (userId) {
      for (const item of local) overlay.set(item.id, item)
      for (const item of shared) overlay.set(item.id, item)
    } else {
      for (const item of shared) overlay.set(item.id, item)
      for (const item of local) overlay.set(item.id, item)
    }
    const overlaid = [...overlay.values()]
    const ids = new Set(overlaid.map((item) => item.id))
    return [...base.filter((item) => !ids.has(item.id)), ...overlaid]
  }, [base, local, shared, userId])

  const addItem = useCallback(
    async (
      partial: Omit<PromptItem, 'id' | 'categorySlug' | 'local' | 'ownerId'> & { id?: string },
    ): Promise<PromptItem> => {
      const slug = categorySlug(partial.category)
      const preferred = partial.id ?? `local-${slug}-${Date.now().toString(36)}`
      let id = preferred
      if (userId && supabase) {
        try {
          id = await allocateStyleId(preferred, userId)
        } catch {
          setSyncError(syncErrorMessage('添加风格'))
        }
      }
      const item = normalizeItem({
        ...partial,
        id,
        categorySlug: slug,
        local: true,
        ownerId: userId ?? undefined,
        cover: partial.cover ?? null,
        parentId: partial.parentId ?? null,
        collection: partial.collection ?? null,
        collectionIndex: partial.collectionIndex ?? null,
        collectionTotal: partial.collectionTotal ?? null,
        tags: partial.tags ?? [],
        medium: partial.medium ?? '图像',
        aspect: partial.aspect ?? null,
        promptText: partial.promptText ?? '',
        duplicateNote: partial.duplicateNote ?? null,
        duplicateOf: partial.duplicateOf ?? null,
      })

      setLocal((prev) => {
        const next = [...prev.filter((p) => p.id !== id), { ...item, local: true }]
        saveLocalItems(next)
        return next
      })

      if (userId && supabase) {
        const { error: writeErr } = await supabase.from('custom_styles').upsert(
          {
            id,
            owner_id: userId,
            payload: toStylePayload(item, id),
          },
          { onConflict: 'id' },
        )
        if (writeErr) {
          setSyncError(syncErrorMessage('添加风格'))
          return { ...item, ownerId: undefined }
        }
        setShared((prev) => [...prev.filter((p) => p.id !== id), { ...item, local: false, ownerId: userId }])
        setSyncError(null)
      }

      return item
    },
    [userId],
  )

  const removeLocal = useCallback(
    async (id: string) => {
      const sharedItem = shared.find((item) => item.id === id)
      if (userId && supabase && sharedItem) {
        if (sharedItem.ownerId !== userId) return
        const { error: writeErr } = await supabase.from('custom_styles').delete().eq('id', id).eq('owner_id', userId)
        if (writeErr) {
          setSyncError(syncErrorMessage('删除风格'))
          return
        }
        setShared((prev) => prev.filter((item) => item.id !== id))
        setSyncError(null)
      }
      setLocal((prev) => {
        const next = prev.filter((p) => p.id !== id)
        saveLocalItems(next)
        return next
      })
    },
    [shared, userId],
  )

  const exportJson = useCallback(() => {
    const payload: PromptsData = {
      generatedFrom: 'prompt-gallery export (base + shared + local)',
      count: items.length,
      categories: items.reduce<Record<string, number>>((acc, it) => {
        acc[it.category] = (acc[it.category] ?? 0) + 1
        return acc
      }, {}),
      collections: meta?.collections,
      tagFacets: meta?.tagFacets,
      items: items.map(({ coverDataUrl: _c, local: _l, ownerId: _o, ...rest }) => ({
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
  }, [items, meta])

  return {
    items,
    loading,
    error,
    syncError,
    meta,
    addItem,
    removeLocal,
    exportJson,
    localCount: local.length,
    baseCount: base.length,
  }
}
