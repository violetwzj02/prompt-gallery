import { useCallback, useEffect, useState } from 'react'
import {
  AlbumSchemaError,
  ALBUM_SCHEMA_UNAVAILABLE,
  createAlbumCategory,
  deleteAlbumCategory,
  deleteAlbumItemRow,
  fetchAlbumCategories,
  fetchAlbumItems,
  fetchAlbumSettings,
  insertAlbumItem,
  renameAlbumCategory,
  saveAlbumSettings,
  updateAlbumItem,
  type AlbumCategory,
  type AlbumItem,
  type AlbumItemSource,
  type AlbumSettings,
} from '../lib/album'
import { isSupabaseConfigured } from '../lib/supabase'

export function useAlbum(enabled: boolean) {
  const [settings, setSettings] = useState<AlbumSettings | null>(null)
  const [categories, setCategories] = useState<AlbumCategory[]>([])
  const [items, setItems] = useState<AlbumItem[]>([])
  const [loading, setLoading] = useState(enabled)
  const [error, setError] = useState<string | null>(null)
  const [schemaMissing, setSchemaMissing] = useState(false)

  const load = useCallback(async () => {
    if (!enabled) {
      setLoading(false)
      return
    }
    if (!isSupabaseConfigured) {
      setSettings(null)
      setCategories([])
      setItems([])
      setSchemaMissing(false)
      setError('账号服务暂不可用')
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const [nextSettings, nextCategories, nextItems] = await Promise.all([
        fetchAlbumSettings(),
        fetchAlbumCategories(),
        fetchAlbumItems(),
      ])
      setSettings(nextSettings)
      setCategories(nextCategories)
      setItems(nextItems)
      setSchemaMissing(false)
      setError(null)
    } catch (err) {
      setSettings(null)
      setCategories([])
      setItems([])
      if (err instanceof AlbumSchemaError) {
        setSchemaMissing(true)
        setError(ALBUM_SCHEMA_UNAVAILABLE)
      } else {
        setSchemaMissing(false)
        setError(err instanceof Error ? err.message : '加载相册失败，请稍后重试')
      }
    } finally {
      setLoading(false)
    }
  }, [enabled])

  useEffect(() => {
    void load()
  }, [load])

  const connectSettings = useCallback(async (input: { driveRootFolderId: string; connectedGoogleEmail: string }) => {
    const next = await saveAlbumSettings(input)
    setSettings(next)
    return next
  }, [])

  const addCategory = useCallback(async (name: string) => {
    const created = await createAlbumCategory(
      name,
      categories.map((category) => category.name),
    )
    setCategories((current) => [...current, created])
    return created
  }, [categories])

  const editCategory = useCallback(async (id: string, name: string) => {
    const current = categories.find((category) => category.id === id)
    const existing = categories.filter((category) => category.id !== id).map((category) => category.name)
    const updated = await renameAlbumCategory(id, name, existing)
    setCategories((list) => list.map((category) => (category.id === id ? updated : category)))
    if (current && current.name !== updated.name) {
      setItems((list) =>
        list.map((item) => ({
          ...item,
          customCategories: item.customCategories.map((label) => (label === current.name ? updated.name : label)),
        })),
      )
    }
    return updated
  }, [categories])

  const removeCategory = useCallback(async (id: string) => {
    const current = categories.find((category) => category.id === id)
    await deleteAlbumCategory(id)
    setCategories((list) => list.filter((category) => category.id !== id))
    if (current) {
      setItems((list) =>
        list.map((item) => ({
          ...item,
          customCategories: item.customCategories.filter((label) => label !== current.name),
        })),
      )
    }
  }, [categories])

  const addItem = useCallback(
    async (input: {
      driveFileId: string
      title?: string | null
      source: AlbumItemSource
      promptId?: string | null
      mimeType?: string | null
      sizeBytes?: number | null
      autoCategories: string[]
      customCategories: string[]
    }) => {
      const created = await insertAlbumItem(input)
      setItems((list) => [created, ...list.filter((item) => item.id !== created.id)])
      return created
    },
    [],
  )

  const editItem = useCallback(
    async (
      id: string,
      patch: { title?: string | null; autoCategories?: string[]; customCategories?: string[] },
    ) => {
      const updated = await updateAlbumItem(id, patch)
      setItems((list) => list.map((item) => (item.id === id ? updated : item)))
      return updated
    },
    [],
  )

  const removeItem = useCallback(async (id: string) => {
    await deleteAlbumItemRow(id)
    setItems((list) => list.filter((item) => item.id !== id))
  }, [])

  return {
    settings,
    categories,
    items,
    loading,
    error,
    schemaMissing,
    reload: load,
    connectSettings,
    addCategory,
    editCategory,
    removeCategory,
    addItem,
    editItem,
    removeItem,
  }
}
