import type { Category, Medium, PromptItem } from '../types'
import { categorySlug } from '../utils/category'
import { normalizeItem } from '../utils/filters'
import {
  DEFAULT_FOLDER_ID,
  DEFAULT_FOLDER_NAME,
  loadFavorites,
  loadLikes,
  loadLocalItems,
  type FavoriteFolder,
} from './localStore'
import { supabase, syncErrorMessage } from './supabase'

export interface CloudFolderRow {
  id: string
  name: string
  is_default: boolean
}

export interface CustomStyleRow {
  id: string
  owner_id: string
  payload: unknown
  created_at?: string
  updated_at?: string
}

const mergeLocks = new Map<string, Promise<void>>()

export function toStylePayload(item: PromptItem, id = item.id): Record<string, unknown> {
  const { ownerId: _ownerId, local: _local, ...rest } = item
  return { ...rest, id }
}

export function itemFromCustomStyle(row: CustomStyleRow): PromptItem {
  const payload = row.payload && typeof row.payload === 'object' && !Array.isArray(row.payload)
    ? (row.payload as Partial<PromptItem>)
    : {}
  const category = (payload.category ?? '自定义') as Category
  return normalizeItem({
    id: row.id,
    category,
    categorySlug: payload.categorySlug ?? categorySlug(category),
    title: typeof payload.title === 'string' && payload.title ? payload.title : row.id,
    usage: payload.usage ?? '',
    body: payload.body ?? '',
    source: payload.source ?? '',
    cover: payload.cover ?? null,
    parentId: payload.parentId ?? null,
    collection: payload.collection ?? null,
    collectionIndex: payload.collectionIndex ?? null,
    collectionTotal: payload.collectionTotal ?? null,
    tags: Array.isArray(payload.tags) ? payload.tags : [],
    medium: (payload.medium ?? '图像') as Medium,
    aspect: payload.aspect ?? null,
    promptText: payload.promptText ?? '',
    duplicateNote: payload.duplicateNote ?? null,
    duplicateOf: payload.duplicateOf ?? null,
    coverDataUrl: payload.coverDataUrl,
    local: false,
    ownerId: row.owner_id,
  })
}

export async function fetchSharedStyles(): Promise<PromptItem[]> {
  if (!supabase) return []
  const { data, error } = await supabase
    .from('custom_styles')
    .select('id, owner_id, payload, created_at, updated_at')
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data ?? []).map((row) => itemFromCustomStyle(row as CustomStyleRow))
}

async function mintFreeStyleId(base: string): Promise<string> {
  if (!supabase) return `${base}-${Date.now().toString(36)}`
  const stem = base.slice(0, 180)
  for (let n = 2; n <= 40; n++) {
    const candidate = `${stem}-${n}`
    const { data, error } = await supabase.from('custom_styles').select('id').eq('id', candidate).maybeSingle()
    if (error) return `${stem}-${Date.now().toString(36)}`
    if (!data) return candidate
  }
  return `${stem}-${Date.now().toString(36)}`
}

async function mergeNow(userId: string): Promise<void> {
  if (!supabase) return

  const localLikes = loadLikes()
  const localFav = loadFavorites()
  const localItems = loadLocalItems()

  const { data: folderRows, error: folderErr } = await supabase
    .from('favorite_folders')
    .select('id, name, is_default')
    .eq('user_id', userId)
  if (folderErr) throw folderErr

  const folders: CloudFolderRow[] = (folderRows ?? []) as CloudFolderRow[]
  let defaultFolder = folders.find((f) => f.is_default)
  if (!defaultFolder) {
    const { data: created, error: createErr } = await supabase
      .from('favorite_folders')
      .insert({ user_id: userId, name: DEFAULT_FOLDER_NAME, is_default: true })
      .select('id, name, is_default')
      .single()
    if (createErr || !created) throw createErr ?? new Error('missing default folder')
    defaultFolder = created as CloudFolderRow
    folders.push(defaultFolder)
  }

  const folderMap = new Map<string, string>()
  folderMap.set(DEFAULT_FOLDER_ID, defaultFolder.id)
  folderMap.set(defaultFolder.id, defaultFolder.id)

  for (const localFolder of localFav.folders) {
    const isDefault =
      localFolder.isDefault === true ||
      localFolder.id === DEFAULT_FOLDER_ID ||
      localFolder.name === DEFAULT_FOLDER_NAME
    if (isDefault) {
      folderMap.set(localFolder.id, defaultFolder.id)
      continue
    }
    const existing = folders.find((f) => f.name === localFolder.name && !f.is_default)
    if (existing) {
      folderMap.set(localFolder.id, existing.id)
      continue
    }
    const { data: created, error } = await supabase
      .from('favorite_folders')
      .insert({ user_id: userId, name: localFolder.name, is_default: false })
      .select('id, name, is_default')
      .single()
    if (error || !created) throw error ?? new Error('create folder failed')
    const row = created as CloudFolderRow
    folders.push(row)
    folderMap.set(localFolder.id, row.id)
  }

  const { data: likeRows, error: likeErr } = await supabase.from('likes').select('item_id').eq('user_id', userId)
  if (likeErr) throw likeErr
  const liked = new Set((likeRows ?? []).map((r) => r.item_id as string))
  const likesToInsert = localLikes.filter((id) => !liked.has(id)).map((item_id) => ({ user_id: userId, item_id }))
  if (likesToInsert.length > 0) {
    const { error } = await supabase.from('likes').upsert(likesToInsert, {
      onConflict: 'user_id,item_id',
      ignoreDuplicates: true,
    })
    if (error) throw error
  }

  const { data: favRows, error: favErr } = await supabase
    .from('favorites')
    .select('item_id, folder_id')
    .eq('user_id', userId)
  if (favErr) throw favErr
  const favorited = new Set((favRows ?? []).map((r) => r.item_id as string))
  const favsToInsert = Object.entries(localFav.items)
    .filter(([itemId]) => !favorited.has(itemId))
    .map(([item_id, folderId]) => ({
      user_id: userId,
      item_id,
      folder_id: folderMap.get(folderId) ?? defaultFolder.id,
    }))
  if (favsToInsert.length > 0) {
    const { error } = await supabase.from('favorites').upsert(favsToInsert, {
      onConflict: 'user_id,item_id',
      ignoreDuplicates: true,
    })
    if (error) throw error
  }

  if (localItems.length > 0) {
    const ids = localItems.map((item) => item.id)
    const { data: existingRows, error: styleErr } = await supabase
      .from('custom_styles')
      .select('id, owner_id')
      .in('id', ids)
    if (styleErr) throw styleErr
    const ownerById = new Map((existingRows ?? []).map((r) => [r.id as string, r.owner_id as string]))

    for (const item of localItems) {
      const owner = ownerById.get(item.id)
      const id = owner && owner !== userId ? await mintFreeStyleId(item.id) : item.id
      const { error } = await supabase.from('custom_styles').upsert(
        {
          id,
          owner_id: userId,
          payload: toStylePayload(item, id),
        },
        { onConflict: 'id' },
      )
      if (error) throw error
    }
  }
}

/** Union-merge this browser's localStorage data into the signed-in account. Shared in-flight. */
export function mergeLocalIntoAccount(userId: string): Promise<void> {
  const existing = mergeLocks.get(userId)
  if (existing) return existing
  const job = mergeNow(userId).finally(() => {
    if (mergeLocks.get(userId) === job) mergeLocks.delete(userId)
  })
  mergeLocks.set(userId, job)
  return job
}

export async function allocateStyleId(preferred: string, userId: string): Promise<string> {
  if (!supabase) return preferred
  const { data, error } = await supabase.from('custom_styles').select('id, owner_id').eq('id', preferred).maybeSingle()
  if (error) throw error
  if (!data || data.owner_id === userId) return preferred
  return mintFreeStyleId(preferred)
}

export function foldersFromRows(rows: CloudFolderRow[]): FavoriteFolder[] {
  const folders: FavoriteFolder[] = rows.map((row) => ({
    id: row.id,
    name: row.name,
    isDefault: row.is_default,
  }))
  folders.sort((a, b) => Number(b.isDefault) - Number(a.isDefault))
  return folders
}

export { syncErrorMessage }
