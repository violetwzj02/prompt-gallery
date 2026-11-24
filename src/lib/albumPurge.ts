import type { AlbumItem, AlbumPurgeStatus } from './album'

export const ALBUM_TRASH_NAME = '回收站'
export const ALBUM_TRASH_SCHEMA_UNAVAILABLE = '回收站功能尚未就绪，删除和恢复暂时不可用。'
export const ALBUM_PURGE_NEEDS_DRIVE = '永久删除需要先连接谷歌云盘。'
export const ALBUM_CANNOT_RESTORE_PURGED = '云盘文件已删除，无法恢复。'
export const ALBUM_CANNOT_RESTORE_PENDING = '正在清除，请稍后再试。'
export const ALBUM_ITEM_NOT_FOUND = '找不到这条相册记录。'
export const ALBUM_ITEM_NOT_IN_TRASH = '只能在回收站中永久删除。'
export const ALBUM_ITEM_NOT_LIVE = '这条记录已在回收站中。'
export const ALBUM_PURGE_DRIVE_MARK_FAILED = '云盘文件已删除，但未能更新记录，请重试以清除条目。'
export const ALBUM_PURGE_METADATA_FAILED = '云盘文件已删除，但未能清除相册记录，请重试。'

export type AlbumPurgeStage = 'guard' | 'pending' | 'drive' | 'mark_purged' | 'metadata'

export type AlbumPurgeItemResult =
  | { ok: true; id: string }
  | { ok: false; id: string; stage: AlbumPurgeStage; error: string; retryable: boolean }

export type AlbumPurgeBatchResult = {
  ok: boolean
  results: AlbumPurgeItemResult[]
  succeeded: number
  failed: number
}

export interface AlbumPurgeStore {
  getItem: (id: string) => Promise<AlbumItem | null>
  updateItem: (
    id: string,
    patch: {
      deletedAt?: string | null
      deletedBy?: string | null
      purgeStatus?: AlbumPurgeStatus
      purgeError?: string | null
      drivePurgedAt?: string | null
    },
  ) => Promise<AlbumItem>
  deleteRow: (id: string) => Promise<void>
}

export interface AlbumPurgeDeps extends AlbumPurgeStore {
  deleteDriveFile: (token: string, fileId: string) => Promise<void>
  evictDriveImage?: (fileId: string) => void
  now?: () => string
}

export function isDrivePurged(item: Pick<AlbumItem, 'purgeStatus' | 'drivePurgedAt'>): boolean {
  return item.purgeStatus === 'drive_purged' || Boolean(item.drivePurgedAt)
}

export function canRestoreAlbumItem(item: AlbumItem): { ok: true } | { ok: false; error: string } {
  if (!item.deletedAt) return { ok: false, error: '这条记录不在回收站中。' }
  if (isDrivePurged(item)) return { ok: false, error: ALBUM_CANNOT_RESTORE_PURGED }
  if (item.purgeStatus === 'pending') return { ok: false, error: ALBUM_CANNOT_RESTORE_PENDING }
  return { ok: true }
}

export function trashSchemaUnavailableMessage(): string {
  return ALBUM_TRASH_SCHEMA_UNAVAILABLE
}

function fail(id: string, stage: AlbumPurgeStage, error: string, retryable = true): AlbumPurgeItemResult {
  return { ok: false, id, stage, error, retryable }
}

function asError(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback
}

export async function softDeleteAlbumItemInStore(id: string, store: AlbumPurgeStore, at?: string): Promise<AlbumItem> {
  const item = await store.getItem(id)
  if (!item) throw new Error(ALBUM_ITEM_NOT_FOUND)
  if (item.deletedAt) throw new Error(ALBUM_ITEM_NOT_LIVE)
  return store.updateItem(id, {
    deletedAt: at ?? new Date().toISOString(),
    purgeStatus: 'idle',
    purgeError: null,
  })
}

export async function restoreAlbumItemInStore(id: string, store: AlbumPurgeStore): Promise<AlbumItem> {
  const item = await store.getItem(id)
  if (!item) throw new Error(ALBUM_ITEM_NOT_FOUND)
  const allowed = canRestoreAlbumItem(item)
  if (!allowed.ok) throw new Error(allowed.error)
  return store.updateItem(id, {
    deletedAt: null,
    deletedBy: null,
    purgeStatus: 'idle',
    purgeError: null,
    drivePurgedAt: null,
  })
}

export async function purgeAlbumItem(input: {
  id: string
  token: string | null | undefined
  deps: AlbumPurgeDeps
}): Promise<AlbumPurgeItemResult> {
  const { id, token, deps } = input
  if (!token) return fail(id, 'guard', ALBUM_PURGE_NEEDS_DRIVE, true)

  let item: AlbumItem | null
  try {
    item = await deps.getItem(id)
  } catch (error) {
    return fail(id, 'guard', asError(error, '无法读取相册记录'))
  }
  if (!item) return fail(id, 'guard', ALBUM_ITEM_NOT_FOUND, false)
  if (!item.deletedAt && !isDrivePurged(item)) return fail(id, 'guard', ALBUM_ITEM_NOT_IN_TRASH, false)

  const alreadyPurgedOnDrive = isDrivePurged(item)

  if (!alreadyPurgedOnDrive && item.purgeStatus !== 'pending') {
    try {
      item = await deps.updateItem(id, { purgeStatus: 'pending', purgeError: null })
    } catch (error) {
      return fail(id, 'pending', asError(error, '无法开始永久删除'))
    }
  }

  if (!alreadyPurgedOnDrive) {
    try {
      await deps.deleteDriveFile(token, item.driveFileId)
    } catch (error) {
      const message = asError(error, '无法从谷歌云盘删除这张图片')
      try {
        await deps.updateItem(id, { purgeStatus: 'failed', purgeError: message })
      } catch {
        /* keep the Drive error as the reported failure */
      }
      return fail(id, 'drive', message)
    }

    const purgedAt = deps.now ? deps.now() : new Date().toISOString()
    try {
      item = await deps.updateItem(id, {
        purgeStatus: 'drive_purged',
        drivePurgedAt: purgedAt,
        purgeError: null,
      })
    } catch (error) {
      const message = asError(error, ALBUM_PURGE_DRIVE_MARK_FAILED)
      return fail(id, 'mark_purged', message.includes('云盘') ? message : ALBUM_PURGE_DRIVE_MARK_FAILED)
    }
  }

  try {
    await deps.deleteRow(id)
  } catch (error) {
    return fail(id, 'metadata', asError(error, ALBUM_PURGE_METADATA_FAILED))
  }

  deps.evictDriveImage?.(item.driveFileId)
  return { ok: true, id }
}

export async function purgeAlbumItems(input: {
  ids: readonly string[]
  token: string | null | undefined
  deps: AlbumPurgeDeps
}): Promise<AlbumPurgeBatchResult> {
  const results: AlbumPurgeItemResult[] = []
  for (const id of input.ids) {
    results.push(await purgeAlbumItem({ id, token: input.token, deps: input.deps }))
  }
  const succeeded = results.filter((result) => result.ok).length
  const failed = results.length - succeeded
  return { ok: failed === 0, results, succeeded, failed }
}
