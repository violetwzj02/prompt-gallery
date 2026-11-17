import type { PromptItem } from '../types'
import { normalizeItem } from '../utils/filters'

export const LIKES_KEY = 'prompt-gallery-likes'
export const FAVORITES_KEY = 'prompt-gallery-favorites'
export const LOCAL_ITEMS_KEY = 'prompt-gallery-local-items'

export const DEFAULT_FOLDER_ID = 'default'
export const DEFAULT_FOLDER_NAME = '默认收藏夹'

export interface FavoriteFolder {
  id: string
  name: string
  isDefault?: boolean
}

export interface FavoritesState {
  folders: FavoriteFolder[]
  /** item id → folder id only; no prompt bodies */
  items: Record<string, string>
}

export function fallbackFavorites(): FavoritesState {
  return {
    folders: [{ id: DEFAULT_FOLDER_ID, name: DEFAULT_FOLDER_NAME, isDefault: true }],
    items: {},
  }
}

function isFolder(value: unknown): value is FavoriteFolder {
  if (!value || typeof value !== 'object') return false
  const rec = value as Record<string, unknown>
  return typeof rec.id === 'string' && rec.id.trim() !== '' && typeof rec.name === 'string'
}

export function loadLikes(): string[] {
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

export function saveLikes(ids: string[]) {
  try {
    localStorage.setItem(LIKES_KEY, JSON.stringify(ids))
  } catch {
    /* private mode or quota */
  }
}

export function loadFavorites(): FavoritesState {
  const base = fallbackFavorites()
  try {
    const raw = localStorage.getItem(FAVORITES_KEY)
    if (!raw) return base
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return base
    const rec = parsed as Record<string, unknown>
    const folders = Array.isArray(rec.folders) ? rec.folders.filter(isFolder) : []
    if (!folders.some((f) => f.id === DEFAULT_FOLDER_ID)) {
      folders.unshift({ id: DEFAULT_FOLDER_ID, name: DEFAULT_FOLDER_NAME, isDefault: true })
    } else {
      for (const folder of folders) {
        if (folder.id === DEFAULT_FOLDER_ID) folder.isDefault = true
      }
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

export function saveFavorites(state: FavoritesState) {
  try {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(state))
  } catch {
    /* private mode or quota */
  }
}

export function loadLocalItems(): PromptItem[] {
  try {
    const raw = localStorage.getItem(LOCAL_ITEMS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as PromptItem[]
    return Array.isArray(parsed) ? parsed.map(normalizeItem) : []
  } catch {
    return []
  }
}

export function saveLocalItems(items: PromptItem[]) {
  try {
    localStorage.setItem(LOCAL_ITEMS_KEY, JSON.stringify(items))
  } catch {
    /* private mode or quota */
  }
}

export function isDefaultFolder(folder: Pick<FavoriteFolder, 'id' | 'name' | 'isDefault'>): boolean {
  return folder.isDefault === true || folder.id === DEFAULT_FOLDER_ID || folder.name === DEFAULT_FOLDER_NAME
}

/** Treat hash `fav=default` as the current default folder (local id or cloud UUID). */
export function resolveFolderScope(scope: string | null, defaultFolderId: string): string | null {
  if (!scope) return null
  if (scope === 'all') return 'all'
  if (scope === DEFAULT_FOLDER_ID) return defaultFolderId
  return scope
}

export function folderScopeMatches(
  scope: string | null,
  folderId: string,
  defaultFolderId: string,
): boolean {
  if (!scope || scope === 'all') return false
  const wanted = resolveFolderScope(scope, defaultFolderId)
  return wanted === folderId
}
