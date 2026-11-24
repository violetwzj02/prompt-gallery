import type { PromptItem } from '../types'
import { albumCategorySlug, validateAlbumCategoryName, type AlbumPresetName } from '../utils/albumClassify'
import {
  MAX_ALBUM_FILE_BYTES,
  normalizeImageMime,
  sanitizeUploadFilename,
  type AcceptedImageType,
} from './googleDrive'
import { isMissingColumnError, isMissingRelationError } from './schemaErrors'
import { supabase, syncErrorMessage } from './supabase'
import {
  ALBUM_TRASH_SCHEMA_UNAVAILABLE,
  restoreAlbumItemInStore,
  softDeleteAlbumItemInStore,
} from './albumPurge'

export const ALBUM_SCHEMA_UNAVAILABLE = '相册数据尚未就绪，请稍后再试。'
export const ALBUM_NOT_ENABLED = '云端相册尚未启用。请先配置谷歌云盘接口后再试。'
export const ALBUM_CONNECT_FIRST = '请先打开云端相册并连接谷歌云盘。'
export type AlbumItemScope = 'live' | 'trash'
export type AlbumPurgeStatus = 'idle' | 'pending' | 'drive_purged' | 'failed'

export type AlbumCategoryKind = 'preset' | 'custom'
export type AlbumItemSource = 'upload' | 'generated'

export interface AlbumSettings {
  driveRootFolderId: string | null
  connectedGoogleEmail: string | null
  updatedAt: string | null
  updatedBy: string | null
}

export interface AlbumCategory {
  id: string
  name: string
  slug: string | null
  kind: AlbumCategoryKind
  createdAt: string
  createdBy: string | null
}

export interface AlbumItem {
  id: string
  ownerId: string
  driveFileId: string
  title: string | null
  source: AlbumItemSource
  promptId: string | null
  mimeType: string | null
  sizeBytes: number | null
  autoCategories: string[]
  customCategories: string[]
  createdAt: string
  updatedAt: string | null
  deletedAt: string | null
  deletedBy: string | null
  purgeStatus: AlbumPurgeStatus
  purgeError: string | null
  drivePurgedAt: string | null
}

export class AlbumSchemaError extends Error {
  constructor(message = ALBUM_SCHEMA_UNAVAILABLE) {
    super(message)
    this.name = 'AlbumSchemaError'
  }
}

export class AlbumTrashSchemaError extends Error {
  constructor(message = ALBUM_TRASH_SCHEMA_UNAVAILABLE) {
    super(message)
    this.name = 'AlbumTrashSchemaError'
  }
}

function rethrowTrashOrSchema(error: { code?: string; message?: string } | null, fallback: string): never {
  if (isMissingColumnError(error)) throw new AlbumTrashSchemaError()
  rethrowSchema(error, fallback)
}

function asPurgeStatus(value: unknown): AlbumPurgeStatus {
  if (value === 'pending' || value === 'drive_purged' || value === 'failed' || value === 'idle') return value
  return 'idle'
}

function requireClient() {
  if (!supabase) throw new Error('账号服务暂不可用')
  return supabase
}

function rethrowSchema(error: { code?: string; message?: string } | null, fallback: string): never {
  if (isMissingRelationError(error)) throw new AlbumSchemaError()
  throw new Error(error?.message?.trim() || fallback)
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
}

function rowToSettings(row: Record<string, unknown> | null): AlbumSettings | null {
  if (!row) return null
  return {
    driveRootFolderId: typeof row.drive_root_folder_id === 'string' ? row.drive_root_folder_id : null,
    connectedGoogleEmail: typeof row.connected_google_email === 'string' ? row.connected_google_email : null,
    updatedAt: typeof row.updated_at === 'string' ? row.updated_at : null,
    updatedBy: typeof row.updated_by === 'string' ? row.updated_by : null,
  }
}

function rowToCategory(row: Record<string, unknown>): AlbumCategory {
  return {
    id: String(row.id),
    name: String(row.name ?? ''),
    slug: typeof row.slug === 'string' ? row.slug : null,
    kind: row.kind === 'preset' ? 'preset' : 'custom',
    createdAt: typeof row.created_at === 'string' ? row.created_at : '',
    createdBy: typeof row.created_by === 'string' ? row.created_by : null,
  }
}

function rowToItem(row: Record<string, unknown>): AlbumItem {
  return {
    id: String(row.id),
    ownerId: String(row.owner_id ?? ''),
    driveFileId: String(row.drive_file_id ?? ''),
    title: typeof row.title === 'string' ? row.title : null,
    source: row.source === 'generated' ? 'generated' : 'upload',
    promptId: typeof row.prompt_id === 'string' ? row.prompt_id : null,
    mimeType: typeof row.mime_type === 'string' ? row.mime_type : null,
    sizeBytes: typeof row.size_bytes === 'number' ? row.size_bytes : null,
    autoCategories: asStringArray(row.auto_categories),
    customCategories: asStringArray(row.custom_categories),
    createdAt: typeof row.created_at === 'string' ? row.created_at : '',
    updatedAt: typeof row.updated_at === 'string' ? row.updated_at : null,
    deletedAt: typeof row.deleted_at === 'string' ? row.deleted_at : null,
    deletedBy: typeof row.deleted_by === 'string' ? row.deleted_by : null,
    purgeStatus: asPurgeStatus(row.purge_status),
    purgeError: typeof row.purge_error === 'string' ? row.purge_error : null,
    drivePurgedAt: typeof row.drive_purged_at === 'string' ? row.drive_purged_at : null,
  }
}

export async function fetchAlbumSettings(): Promise<AlbumSettings | null> {
  const client = requireClient()
  const { data, error } = await client.from('album_settings').select('*').eq('id', 'default').maybeSingle()
  if (error) rethrowSchema(error, syncErrorMessage('加载相册设置'))
  return rowToSettings((data ?? null) as Record<string, unknown> | null)
}

export async function saveAlbumSettings(input: {
  driveRootFolderId: string
  connectedGoogleEmail: string
}): Promise<AlbumSettings> {
  const client = requireClient()
  const { data, error } = await client
    .from('album_settings')
    .upsert(
      {
        id: 'default',
        drive_root_folder_id: input.driveRootFolderId,
        connected_google_email: input.connectedGoogleEmail,
      },
      { onConflict: 'id' },
    )
    .select('*')
    .single()
  if (error) rethrowSchema(error, syncErrorMessage('保存相册设置'))
  const settings = rowToSettings(data as Record<string, unknown>)
  if (!settings) throw new Error(syncErrorMessage('保存相册设置'))
  return settings
}

export async function fetchAlbumCategories(): Promise<AlbumCategory[]> {
  const client = requireClient()
  const { data, error } = await client
    .from('album_categories')
    .select('id, name, slug, kind, created_at, created_by')
    .order('created_at', { ascending: true })
  if (error) rethrowSchema(error, syncErrorMessage('加载相册分类'))
  return ((data ?? []) as Record<string, unknown>[]).map(rowToCategory)
}

export async function createAlbumCategory(name: string, existing: string[]): Promise<AlbumCategory> {
  const validated = validateAlbumCategoryName(name, existing)
  if (!validated.ok) throw new Error(validated.error)
  const client = requireClient()
  const { data, error } = await client
    .from('album_categories')
    .insert({
      name: validated.name,
      slug: albumCategorySlug(validated.name),
      kind: 'custom',
    })
    .select('id, name, slug, kind, created_at, created_by')
    .single()
  if (error) {
    if (error.code === '23505') throw new Error('已有相同名称的分类')
    rethrowSchema(error, syncErrorMessage('创建分类'))
  }
  return rowToCategory(data as Record<string, unknown>)
}

export async function renameAlbumCategory(id: string, name: string, existing: string[]): Promise<AlbumCategory> {
  const validated = validateAlbumCategoryName(name, existing)
  if (!validated.ok) throw new Error(validated.error)
  const client = requireClient()
  const { data, error } = await client
    .from('album_categories')
    .update({ name: validated.name, slug: albumCategorySlug(validated.name) })
    .eq('id', id)
    .eq('kind', 'custom')
    .select('id, name, slug, kind, created_at, created_by')
    .single()
  if (error) {
    if (error.code === '23505') throw new Error('已有相同名称的分类')
    rethrowSchema(error, syncErrorMessage('重命名分类'))
  }
  return rowToCategory(data as Record<string, unknown>)
}

export async function deleteAlbumCategory(id: string): Promise<void> {
  const client = requireClient()
  const { error } = await client.from('album_categories').delete().eq('id', id).eq('kind', 'custom')
  if (error) rethrowSchema(error, syncErrorMessage('删除分类'))
}

export async function fetchAlbumItemsLegacy(): Promise<AlbumItem[]> {
  const client = requireClient()
  const { data, error } = await client.from('album_items').select('*').order('created_at', { ascending: false })
  if (error) rethrowSchema(error, syncErrorMessage('加载相册'))
  return ((data ?? []) as Record<string, unknown>[]).map(rowToItem)
}

export async function fetchAlbumItems(scope: AlbumItemScope = 'live'): Promise<AlbumItem[]> {
  const client = requireClient()
  let query = client.from('album_items').select('*')
  query = scope === 'trash' ? query.not('deleted_at', 'is', null) : query.is('deleted_at', null)
  const { data, error } = await query.order(scope === 'trash' ? 'deleted_at' : 'created_at', { ascending: false })
  if (error) rethrowTrashOrSchema(error, syncErrorMessage('加载相册'))
  return ((data ?? []) as Record<string, unknown>[]).map(rowToItem)
}

export async function fetchAlbumItemByPromptId(promptId: string): Promise<AlbumItem | null> {
  const client = requireClient()
  const { data, error } = await client
    .from('album_items')
    .select('*')
    .eq('prompt_id', promptId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error && isMissingColumnError(error)) {
    const fallback = await client
      .from('album_items')
      .select('*')
      .eq('prompt_id', promptId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (fallback.error) rethrowSchema(fallback.error, syncErrorMessage('查询相册'))
    return fallback.data ? rowToItem(fallback.data as Record<string, unknown>) : null
  }
  if (error) rethrowSchema(error, syncErrorMessage('查询相册'))
  return data ? rowToItem(data as Record<string, unknown>) : null
}

export async function insertAlbumItem(input: {
  driveFileId: string
  title?: string | null
  source: AlbumItemSource
  promptId?: string | null
  mimeType?: string | null
  sizeBytes?: number | null
  autoCategories: AlbumPresetName[] | string[]
  customCategories: string[]
}): Promise<AlbumItem> {
  const client = requireClient()
  const { data, error } = await client
    .from('album_items')
    .insert({
      drive_file_id: input.driveFileId,
      title: input.title ?? null,
      source: input.source,
      prompt_id: input.promptId ?? null,
      mime_type: input.mimeType ?? null,
      size_bytes: input.sizeBytes ?? null,
      auto_categories: input.autoCategories,
      custom_categories: input.customCategories,
    })
    .select('*')
    .single()
  if (error) {
    if (error.code === '23505') throw new Error('这张图片已在云端相册中')
    rethrowSchema(error, syncErrorMessage('保存相册条目'))
  }
  return rowToItem(data as Record<string, unknown>)
}

export async function updateAlbumItem(id: string, patch: {
  title?: string | null
  autoCategories?: string[]
  customCategories?: string[]
}): Promise<AlbumItem> {
  const client = requireClient()
  const body: Record<string, unknown> = {}
  if (patch.title !== undefined) body.title = patch.title
  if (patch.autoCategories) body.auto_categories = patch.autoCategories
  if (patch.customCategories) body.custom_categories = patch.customCategories
  const { data, error } = await client.from('album_items').update(body).eq('id', id).select('*').single()
  if (error) rethrowSchema(error, syncErrorMessage('更新相册条目'))
  return rowToItem(data as Record<string, unknown>)
}

export async function deleteAlbumItemRow(id: string): Promise<void> {
  const client = requireClient()
  const { error } = await client.from('album_items').delete().eq('id', id)
  if (error) rethrowTrashOrSchema(error, syncErrorMessage('删除相册条目'))
}

async function getAlbumItemById(id: string): Promise<AlbumItem | null> {
  const client = requireClient()
  const { data, error } = await client.from('album_items').select('*').eq('id', id).maybeSingle()
  if (error) rethrowTrashOrSchema(error, syncErrorMessage('查询相册条目'))
  return data ? rowToItem(data as Record<string, unknown>) : null
}

async function updateAlbumTrashFields(
  id: string,
  patch: {
    deletedAt?: string | null
    deletedBy?: string | null
    purgeStatus?: AlbumPurgeStatus
    purgeError?: string | null
    drivePurgedAt?: string | null
  },
): Promise<AlbumItem> {
  const client = requireClient()
  const body: Record<string, unknown> = {}
  if (patch.deletedAt !== undefined) body.deleted_at = patch.deletedAt
  if (patch.deletedBy !== undefined) body.deleted_by = patch.deletedBy
  if (patch.purgeStatus !== undefined) body.purge_status = patch.purgeStatus
  if (patch.purgeError !== undefined) body.purge_error = patch.purgeError
  if (patch.drivePurgedAt !== undefined) body.drive_purged_at = patch.drivePurgedAt
  const { data, error } = await client.from('album_items').update(body).eq('id', id).select('*').single()
  if (error) rethrowTrashOrSchema(error, syncErrorMessage('更新回收站记录'))
  return rowToItem(data as Record<string, unknown>)
}

export function albumTrashStore() {
  return {
    getItem: getAlbumItemById,
    updateItem: updateAlbumTrashFields,
    deleteRow: deleteAlbumItemRow,
  }
}

export async function softDeleteAlbumItem(id: string): Promise<AlbumItem> {
  try {
    return await softDeleteAlbumItemInStore(id, albumTrashStore())
  } catch (error) {
    if (error instanceof AlbumTrashSchemaError || error instanceof AlbumSchemaError) throw error
    if (error instanceof Error) throw error
    throw new Error('无法移入回收站')
  }
}

export async function restoreAlbumItem(id: string): Promise<AlbumItem> {
  try {
    return await restoreAlbumItemInStore(id, albumTrashStore())
  } catch (error) {
    if (error instanceof AlbumTrashSchemaError || error instanceof AlbumSchemaError) throw error
    if (error instanceof Error) throw error
    throw new Error('无法恢复这条记录')
  }
}

export function resolvePromptCoverUrl(item: PromptItem): string | null {
  if (item.coverDataUrl) return item.coverDataUrl
  const cover = item.cover?.trim()
  if (!cover) return null
  if (/^(data:|blob:|https?:\/\/)/i.test(cover)) return cover
  if (cover.startsWith('./') || cover.startsWith('/')) return cover
  return `./${cover}`
}

export async function fetchPromptCoverFile(item: PromptItem): Promise<{ file: File; mime: AcceptedImageType }> {
  const url = resolvePromptCoverUrl(item)
  if (!url) throw new Error('这条风格没有可上传的封面图')
  const response = await fetch(url)
  if (!response.ok) throw new Error('无法读取这条风格的封面图')
  const blob = await response.blob()
  if (blob.size > MAX_ALBUM_FILE_BYTES) throw new Error('单张图片不能超过 50 MB')
  const mime = normalizeImageMime(blob.type, item.cover || item.title)
  if (!mime) throw new Error('仅支持 JPG、PNG、WebP 或 GIF 图片')
  const filename = sanitizeUploadFilename(item.title || item.id, mime)
  return { file: new File([blob], filename, { type: mime }), mime }
}

export function formatAlbumTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function itemHasCategory(item: AlbumItem, category: string | null | undefined): boolean {
  if (!category || category === '全部') return true
  return item.autoCategories.includes(category) || item.customCategories.includes(category)
}
