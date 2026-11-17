import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { foldersFromRows, mergeLocalIntoAccount, type CloudFolderRow } from '../lib/accountSync'
import {
  DEFAULT_FOLDER_ID,
  DEFAULT_FOLDER_NAME,
  FAVORITES_KEY,
  fallbackFavorites,
  loadFavorites,
  saveFavorites,
  type FavoriteFolder,
  type FavoritesState,
} from '../lib/localStore'
import { supabase, syncErrorMessage } from '../lib/supabase'

export { DEFAULT_FOLDER_ID, DEFAULT_FOLDER_NAME, FAVORITES_KEY }
export type { FavoriteFolder, FavoritesState }

function uid(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

export function useFavorites(userId: string | null = null, authLoading = false) {
  const [state, setState] = useState<FavoritesState>(() =>
    typeof window === 'undefined' ? fallbackFavorites() : loadFavorites(),
  )
  const [defaultFolderId, setDefaultFolderId] = useState<string>(DEFAULT_FOLDER_ID)
  const [error, setError] = useState<string | null>(null)
  const defaultIdRef = useRef(defaultFolderId)
  defaultIdRef.current = defaultFolderId

  useEffect(() => {
    if (authLoading) return
    if (!userId || !supabase) {
      const local = loadFavorites()
      setState(local)
      setDefaultFolderId(DEFAULT_FOLDER_ID)
      return
    }

    let cancelled = false
    const client = supabase
    ;(async () => {
      try {
        await mergeLocalIntoAccount(userId)
        if (cancelled) return
        const [{ data: folderRows, error: folderErr }, { data: favRows, error: favErr }] = await Promise.all([
          client.from('favorite_folders').select('id, name, is_default').eq('user_id', userId),
          client.from('favorites').select('item_id, folder_id').eq('user_id', userId),
        ])
        if (folderErr) throw folderErr
        if (favErr) throw favErr
        if (cancelled) return
        const folders = foldersFromRows((folderRows ?? []) as CloudFolderRow[])
        const cloudDefault = folders.find((f) => f.isDefault)?.id ?? folders[0]?.id ?? DEFAULT_FOLDER_ID
        const items: Record<string, string> = {}
        for (const row of favRows ?? []) {
          items[row.item_id as string] = (row.folder_id as string) || cloudDefault
        }
        setError(null)
        setDefaultFolderId(cloudDefault)
        setState({ folders, items })
      } catch {
        if (!cancelled) setError(syncErrorMessage('同步收藏'))
      }
    })()

    return () => {
      cancelled = true
    }
  }, [userId, authLoading])

  const folderById = useMemo(() => {
    const map = new Map<string, FavoriteFolder>()
    for (const f of state.folders) map.set(f.id, f)
    return map
  }, [state.folders])

  const isFavorited = useCallback((id: string) => Boolean(state.items[id]), [state.items])

  const folderOf = useCallback((id: string) => state.items[id] ?? null, [state.items])

  const applyLocal = useCallback(
    (updater: (prev: FavoritesState) => FavoritesState) => {
      let next: FavoritesState | null = null
      setState((prev) => {
        next = updater(prev)
        if (next !== prev && (!userId || !supabase)) saveFavorites(next)
        return next
      })
      return next
    },
    [userId],
  )

  const addToFolder = useCallback(
    (itemId: string, folderId?: string) => {
      const fallback = defaultIdRef.current
      let snapshot: FavoritesState = state
      const requested =
        !folderId || folderId === DEFAULT_FOLDER_ID ? fallback : folderId
      let target = requested
      applyLocal((prev) => {
        snapshot = prev
        target = prev.folders.some((f) => f.id === requested) || requested !== fallback ? requested : fallback
        if (prev.items[itemId] === target) return prev
        return { ...prev, items: { ...prev.items, [itemId]: target } }
      })
      setError(null)
      if (!userId || !supabase) return
      const client = supabase
      const folderIdToWrite = target
      const rollback = snapshot
      void (async () => {
        const { error: writeErr } = await client.from('favorites').upsert(
          { user_id: userId, item_id: itemId, folder_id: folderIdToWrite },
          { onConflict: 'user_id,item_id' },
        )
        if (writeErr) {
          setState(rollback)
          setError(syncErrorMessage('收藏'))
        }
      })()
    },
    [applyLocal, state, userId],
  )

  const unfavorite = useCallback(
    (itemId: string) => {
      const snapshot = state
      applyLocal((prev) => {
        if (!(itemId in prev.items)) return prev
        const items = { ...prev.items }
        delete items[itemId]
        return { ...prev, items }
      })
      setError(null)
      if (!userId || !supabase) return
      const client = supabase
      void (async () => {
        const { error: writeErr } = await client
          .from('favorites')
          .delete()
          .eq('user_id', userId)
          .eq('item_id', itemId)
        if (writeErr) {
          setState(snapshot)
          setError(syncErrorMessage('取消收藏'))
        }
      })()
    },
    [applyLocal, state, userId],
  )

  const toggle = useCallback(
    (itemId: string, folderId?: string) => {
      if (state.items[itemId]) unfavorite(itemId)
      else addToFolder(itemId, folderId ?? defaultIdRef.current)
    },
    [addToFolder, state.items, unfavorite],
  )

  const createFolder = useCallback(
    async (rawName: string): Promise<FavoriteFolder | null> => {
      const name = rawName.trim()
      if (!name) return null
      setError(null)
      if (!userId || !supabase) {
        const folder: FavoriteFolder = { id: uid('folder'), name }
        applyLocal((prev) => ({ ...prev, folders: [...prev.folders, folder] }))
        return folder
      }
      const { data, error: writeErr } = await supabase
        .from('favorite_folders')
        .insert({ user_id: userId, name, is_default: false })
        .select('id, name, is_default')
        .single()
      if (writeErr || !data) {
        setError(syncErrorMessage('创建收藏夹'))
        return null
      }
      const folder: FavoriteFolder = { id: data.id as string, name: data.name as string, isDefault: false }
      setState((prev) => ({ ...prev, folders: [...prev.folders, folder] }))
      return folder
    },
    [applyLocal, userId],
  )

  const renameFolder = useCallback(
    async (id: string, rawName: string): Promise<boolean> => {
      const name = rawName.trim()
      if (!name) return false
      const snapshot = state
      if (!snapshot.folders.some((f) => f.id === id)) return false
      applyLocal((prev) => ({
        ...prev,
        folders: prev.folders.map((f) => (f.id === id ? { ...f, name } : f)),
      }))
      setError(null)
      if (!userId || !supabase) return true
      const { error: writeErr } = await supabase
        .from('favorite_folders')
        .update({ name })
        .eq('id', id)
        .eq('user_id', userId)
      if (writeErr) {
        setState(snapshot)
        setError(syncErrorMessage('重命名收藏夹'))
        return false
      }
      return true
    },
    [applyLocal, state, userId],
  )

  const deleteFolder = useCallback(
    async (id: string): Promise<boolean> => {
      const fallback = defaultIdRef.current
      if (id === DEFAULT_FOLDER_ID || id === fallback) return false
      const snapshot = state
      if (!snapshot.folders.some((f) => f.id === id)) return false
      applyLocal((prev) => {
        const folders = prev.folders.filter((f) => f.id !== id)
        const items: Record<string, string> = {}
        for (const [itemId, folderId] of Object.entries(prev.items)) {
          items[itemId] = folderId === id ? fallback : folderId
        }
        return { folders, items }
      })
      setError(null)
      if (!userId || !supabase) return true
      const client = supabase
      const { error: moveErr } = await client
        .from('favorites')
        .update({ folder_id: fallback })
        .eq('user_id', userId)
        .eq('folder_id', id)
      if (moveErr) {
        setState(snapshot)
        setError(syncErrorMessage('删除收藏夹'))
        return false
      }
      const { error: delErr } = await client
        .from('favorite_folders')
        .delete()
        .eq('id', id)
        .eq('user_id', userId)
      if (delErr) {
        setState(snapshot)
        setError(syncErrorMessage('删除收藏夹'))
        return false
      }
      return true
    },
    [applyLocal, state, userId],
  )

  return {
    folders: state.folders,
    items: state.items,
    folderById,
    isFavorited,
    folderOf,
    addToFolder,
    unfavorite,
    toggle,
    createFolder,
    renameFolder,
    deleteFolder,
    defaultFolderId,
    error,
  }
}
