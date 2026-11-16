import { useCallback, useEffect, useMemo, useState } from 'react'

export const FAVORITES_KEY = 'prompt-gallery-favorites'
export const DEFAULT_FOLDER_ID = 'default'
export const DEFAULT_FOLDER_NAME = '默认收藏夹'

export interface FavoriteFolder {
  id: string
  name: string
}

export interface FavoritesState {
  folders: FavoriteFolder[]
  /** item id → folder id only; no prompt bodies */
  items: Record<string, string>
}

function fallbackState(): FavoritesState {
  return {
    folders: [{ id: DEFAULT_FOLDER_ID, name: DEFAULT_FOLDER_NAME }],
    items: {},
  }
}

function isFolder(value: unknown): value is FavoriteFolder {
  if (!value || typeof value !== 'object') return false
  const rec = value as Record<string, unknown>
  return typeof rec.id === 'string' && rec.id.trim() !== '' && typeof rec.name === 'string'
}

function loadFavorites(): FavoritesState {
  const base = fallbackState()
  try {
    const raw = localStorage.getItem(FAVORITES_KEY)
    if (!raw) return base
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return base
    const rec = parsed as Record<string, unknown>
    const folders = Array.isArray(rec.folders) ? rec.folders.filter(isFolder) : []
    if (!folders.some((f) => f.id === DEFAULT_FOLDER_ID)) {
      folders.unshift({ id: DEFAULT_FOLDER_ID, name: DEFAULT_FOLDER_NAME })
    }
    const itemsIn: Record<string, string> = {}
    if (rec.items && typeof rec.items === 'object' && !Array.isArray(rec.items)) {
      for (const [itemId, folderId] of Object.entries(rec.items as Record<string, unknown>)) {
        if (typeof itemId === 'string' && itemId && typeof folderId === 'string' && folderId) {
          itemsIn[itemId] = folderId
        }
      }
    }
    const folderIds = new Set(folders.map((f) => f.id))
    for (const [itemId, folderId] of Object.entries(itemsIn)) {
      if (!folderIds.has(folderId)) itemsIn[itemId] = DEFAULT_FOLDER_ID
    }
    return { folders, items: itemsIn }
  } catch {
    return base
  }
}

function saveFavorites(state: FavoritesState) {
  try {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(state))
  } catch {
    /* private mode or quota */
  }
}

function uid(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

export function useFavorites() {
  const [state, setState] = useState<FavoritesState>(() =>
    typeof window === 'undefined' ? fallbackState() : loadFavorites(),
  )

  useEffect(() => {
    saveFavorites(state)
  }, [state])

  const folderById = useMemo(() => {
    const map = new Map<string, FavoriteFolder>()
    for (const f of state.folders) map.set(f.id, f)
    return map
  }, [state.folders])

  const isFavorited = useCallback((id: string) => Boolean(state.items[id]), [state.items])

  const folderOf = useCallback((id: string) => state.items[id] ?? null, [state.items])

  const addToFolder = useCallback((itemId: string, folderId = DEFAULT_FOLDER_ID) => {
    setState((prev) => {
      const target = prev.folders.some((f) => f.id === folderId) ? folderId : DEFAULT_FOLDER_ID
      if (prev.items[itemId] === target) return prev
      return { ...prev, items: { ...prev.items, [itemId]: target } }
    })
  }, [])

  const unfavorite = useCallback((itemId: string) => {
    setState((prev) => {
      if (!(itemId in prev.items)) return prev
      const items = { ...prev.items }
      delete items[itemId]
      return { ...prev, items }
    })
  }, [])

  const toggle = useCallback((itemId: string, folderId = DEFAULT_FOLDER_ID) => {
    setState((prev) => {
      if (prev.items[itemId]) {
        const items = { ...prev.items }
        delete items[itemId]
        return { ...prev, items }
      }
      const target = prev.folders.some((f) => f.id === folderId) ? folderId : DEFAULT_FOLDER_ID
      return { ...prev, items: { ...prev.items, [itemId]: target } }
    })
  }, [])

  const createFolder = useCallback((rawName: string): FavoriteFolder | null => {
    const name = rawName.trim()
    if (!name) return null
    const folder: FavoriteFolder = { id: uid('folder'), name }
    setState((prev) => ({ ...prev, folders: [...prev.folders, folder] }))
    return folder
  }, [])

  const renameFolder = useCallback((id: string, rawName: string): boolean => {
    const name = rawName.trim()
    if (!name) return false
    let ok = false
    setState((prev) => {
      if (!prev.folders.some((f) => f.id === id)) return prev
      ok = true
      return {
        ...prev,
        folders: prev.folders.map((f) => (f.id === id ? { ...f, name } : f)),
      }
    })
    return ok
  }, [])

  const deleteFolder = useCallback((id: string): boolean => {
    if (id === DEFAULT_FOLDER_ID) return false
    let ok = false
    setState((prev) => {
      if (id === DEFAULT_FOLDER_ID) return prev
      if (!prev.folders.some((f) => f.id === id)) return prev
      ok = true
      const folders = prev.folders.filter((f) => f.id !== id)
      const items: Record<string, string> = {}
      for (const [itemId, folderId] of Object.entries(prev.items)) {
        items[itemId] = folderId === id ? DEFAULT_FOLDER_ID : folderId
      }
      return { folders, items }
    })
    return ok
  }, [])

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
    defaultFolderId: DEFAULT_FOLDER_ID,
  }
}
