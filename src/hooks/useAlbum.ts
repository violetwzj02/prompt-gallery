import { useCallback, useEffect, useState } from 'react'
import {
  AlbumSchemaError,
  AlbumTrashSchemaError,
  ALBUM_SCHEMA_UNAVAILABLE,
  albumTrashStore,
  createAlbumCategory,
  deleteAlbumCategory,
  fetchAlbumCategories,
  fetchAlbumItems,
  fetchAlbumItemsLegacy,
  fetchAlbumSettings,
  insertAlbumItem,
  renameAlbumCategory,
  restoreAlbumItem,
  saveAlbumSettings,
  softDeleteAlbumItem,
  updateAlbumItem,
  type AlbumCategory,
  type AlbumItem,
  type AlbumItemSource,
  type AlbumSettings,
} from '../lib/album'
import {
  ALBUM_TRASH_SCHEMA_UNAVAILABLE,
  purgeAlbumItem,
  purgeAlbumItems,
  type AlbumPurgeBatchResult,
  type AlbumPurgeDeps,
  type AlbumPurgeItemResult,
} from '../lib/albumPurge'
import { evictDriveImage } from '../lib/driveImageCache'
import { deleteDriveFile } from '../lib/googleDrive'
import { isSupabaseConfigured } from '../lib/supabase'

export function useAlbum(enabled: boolean) {
  const [settings, setSettings] = useState<AlbumSettings | null>(null)
  const [categories, setCategories] = useState<AlbumCategory[]>([])
  const [items, setItems] = useState<AlbumItem[]>([])
  const [trashItems, setTrashItems] = useState<AlbumItem[]>([])
  const [loading, setLoading] = useState(enabled)
  const [error, setError] = useState<string | null>(null)
  const [schemaMissing, setSchemaMissing] = useState(false)
  const [trashSchemaMissing, setTrashSchemaMissing] = useState(false)

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
      const [nextSettings, nextCategories] = await Promise.all([
        fetchAlbumSettings(),
        fetchAlbumCategories(),
      ])
      try {
        const [nextItems, nextTrash] = await Promise.all([
          fetchAlbumItems('live'),
          fetchAlbumItems('trash'),
        ])
        setItems(nextItems)
        setTrashItems(nextTrash)
        setTrashSchemaMissing(false)
      } catch (err) {
        if (!(err instanceof AlbumTrashSchemaError)) throw err
        const legacy = await fetchAlbumItemsLegacy()
        setItems(legacy)
        setTrashItems([])
        setTrashSchemaMissing(true)
      }
      setSettings(nextSettings)
      setCategories(nextCategories)
      setSchemaMissing(false)
      setError(null)
    } catch (err) {
      setSettings(null)
      setCategories([])
      setItems([])
      setTrashItems([])
      setTrashSchemaMissing(false)
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

  const requireTrashSchema = useCallback(() => {
    if (trashSchemaMissing) throw new AlbumTrashSchemaError(ALBUM_TRASH_SCHEMA_UNAVAILABLE)
  }, [trashSchemaMissing])

  const softDeleteItem = useCallback(async (id: string) => {
    requireTrashSchema()
    const updated = await softDeleteAlbumItem(id)
    setItems((list) => list.filter((item) => item.id !== id))
    setTrashItems((list) => [updated, ...list.filter((item) => item.id !== updated.id)])
    return updated
  }, [requireTrashSchema])

  const restoreItem = useCallback(async (id: string) => {
    requireTrashSchema()
    const updated = await restoreAlbumItem(id)
    setTrashItems((list) => list.filter((item) => item.id !== id))
    setItems((list) => [updated, ...list.filter((item) => item.id !== updated.id)])
    return updated
  }, [requireTrashSchema])

  const purgeDeps = useCallback((): AlbumPurgeDeps => {
    requireTrashSchema()
    return {
      ...albumTrashStore(),
      deleteDriveFile,
      evictDriveImage,
    }
  }, [requireTrashSchema])

  const purgeItem = useCallback(
    async (id: string, token: string | null | undefined): Promise<AlbumPurgeItemResult> => {
      const result = await purgeAlbumItem({ id, token, deps: purgeDeps() })
      if (result.ok) {
        setTrashItems((list) => list.filter((item) => item.id !== id))
        setItems((list) => list.filter((item) => item.id !== id))
      } else {
        const latest = await albumTrashStore().getItem(id).catch(() => null)
        if (latest) {
          setTrashItems((list) => list.map((item) => (item.id === id ? latest : item)))
        }
      }
      return result
    },
    [purgeDeps],
  )

  const purgeItems = useCallback(
    async (ids: readonly string[], token: string | null | undefined): Promise<AlbumPurgeBatchResult> => {
      const result = await purgeAlbumItems({ ids, token, deps: purgeDeps() })
      const succeeded = new Set(result.results.filter((item) => item.ok).map((item) => item.id))
      if (succeeded.size) {
        setTrashItems((list) => list.filter((item) => !succeeded.has(item.id)))
        setItems((list) => list.filter((item) => !succeeded.has(item.id)))
      }
      return result
    },
    [purgeDeps],
  )

  return {
    settings,
    categories,
    items,
    trashItems,
    loading,
    error,
    schemaMissing,
    trashSchemaMissing,
    reload: load,
    connectSettings,
    addCategory,
    editCategory,
    removeCategory,
    addItem,
    editItem,
    softDeleteItem,
    restoreItem,
    purgeItem,
    purgeItems,
  }
}
