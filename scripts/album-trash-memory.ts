import type { AlbumItem } from '../src/lib/album'
import {
  ALBUM_CANNOT_RESTORE_PURGED,
  ALBUM_PURGE_METADATA_FAILED,
  purgeAlbumItem,
  purgeAlbumItems,
  restoreAlbumItemInStore,
  softDeleteAlbumItemInStore,
  type AlbumPurgeDeps,
  type AlbumPurgeItemResult,
  type AlbumPurgeBatchResult,
} from '../src/lib/albumPurge'

export { ALBUM_CANNOT_RESTORE_PURGED, ALBUM_PURGE_METADATA_FAILED }

export type FailPlan = 'drive' | 'db_cleanup'

export type AlbumTrashCounters = {
  driveAttempts: number
  driveSuccesses: number
  metadataAttempts: number
  metadataSuccesses: number
  markAttempts: number
  markSuccesses: number
  mutations: number
}

export type AlbumTrashSnapshot = {
  live: AlbumItem[]
  trash: AlbumItem[]
  counters: AlbumTrashCounters
  driveFailOnce: boolean
  dbCleanupFailOnce: boolean
  pendingItemFails: Array<{ id: string; plan: FailPlan }>
}

const ZERO_COUNTERS: AlbumTrashCounters = {
  driveAttempts: 0,
  driveSuccesses: 0,
  metadataAttempts: 0,
  metadataSuccesses: 0,
  markAttempts: 0,
  markSuccesses: 0,
  mutations: 0,
}

export function seedAlbumItem(overrides: Partial<AlbumItem> & Pick<AlbumItem, 'id' | 'driveFileId' | 'title'>): AlbumItem {
  return {
    ownerId: 'harness-user',
    source: 'upload',
    promptId: null,
    mimeType: 'image/png',
    sizeBytes: 24,
    autoCategories: ['场景'],
    customCategories: [],
    createdAt: '2026-11-24T00:00:00.000Z',
    updatedAt: null,
    deletedAt: null,
    deletedBy: null,
    purgeStatus: 'idle',
    purgeError: null,
    drivePurgedAt: null,
    ...overrides,
  }
}

export function initialLiveItems(): AlbumItem[] {
  return [
    seedAlbumItem({ id: 'live-lake', driveFileId: 'file-lake', title: '湖畔晨雾' }),
    seedAlbumItem({ id: 'live-valley', driveFileId: 'file-valley', title: '山谷午后' }),
    seedAlbumItem({
      id: 'live-folder',
      driveFileId: 'file-folder',
      title: '构图练习卡片',
      autoCategories: ['18+'],
      customCategories: ['测试角色'],
    }),
  ]
}

export function initialTrashItems(): AlbumItem[] {
  return [
    seedAlbumItem({
      id: 'trash-one',
      driveFileId: 'file-trash',
      title: '已放入回收站的练习图',
      autoCategories: ['场景'],
      deletedAt: '2026-11-24T03:00:00.000Z',
    }),
  ]
}

export const PARTIAL_FAIL_FIXTURE = {
  success: seedAlbumItem({
    id: 'trash-ok',
    driveFileId: 'file-ok',
    title: '会成功清除的练习图',
    autoCategories: ['场景'],
    deletedAt: '2026-11-24T03:10:00.000Z',
  }),
  driveFail: seedAlbumItem({
    id: 'trash-drive-fail',
    driveFileId: 'file-drive-fail',
    title: '模拟云盘失败的练习图',
    autoCategories: ['场景'],
    deletedAt: '2026-11-24T03:11:00.000Z',
  }),
  dbCleanupFail: seedAlbumItem({
    id: 'trash-db-fail',
    driveFileId: 'file-db-fail',
    title: '模拟记录清理失败的练习图',
    autoCategories: ['场景'],
    deletedAt: '2026-11-24T03:12:00.000Z',
  }),
}

export const DRIVE_FAIL_MESSAGE = '500 模拟云盘删除失败'
export const DB_CLEANUP_FAIL_MESSAGE = '数据库暂时不可用'

export function createAlbumTrashMemory(options?: { onChange?: () => void; log?: (line: string) => void }) {
  let live = initialLiveItems()
  let trash = initialTrashItems()
  let counters: AlbumTrashCounters = { ...ZERO_COUNTERS }
  let driveFailOnce = false
  let dbCleanupFailOnce = false
  const itemFails = new Map<string, FailPlan>()
  const notify = () => options?.onChange?.()
  const log = (line: string) => options?.log?.(line)

  const all = () => [...live, ...trash]

  const write = (nextLive: AlbumItem[], nextTrash: AlbumItem[]) => {
    live = nextLive
    trash = nextTrash
    notify()
  }

  const find = (idOrFile: string) =>
    all().find((item) => item.id === idOrFile || item.driveFileId === idOrFile) ?? null

  const consumeFail = (item: AlbumItem | null, kind: FailPlan): boolean => {
    if (item) {
      const planned = itemFails.get(item.id) ?? itemFails.get(item.driveFileId)
      if (planned === kind) {
        itemFails.delete(item.id)
        itemFails.delete(item.driveFileId)
        notify()
        return true
      }
    }
    if (kind === 'drive' && driveFailOnce) {
      driveFailOnce = false
      notify()
      return true
    }
    if (kind === 'db_cleanup' && dbCleanupFailOnce) {
      dbCleanupFailOnce = false
      notify()
      return true
    }
    return false
  }

  const deps: AlbumPurgeDeps = {
    async getItem(id) {
      const item = find(id)
      return item ? { ...item } : null
    },
    async updateItem(id, patch) {
      const current = find(id)
      if (!current) throw new Error('missing')
      if (patch.purgeStatus === 'drive_purged') counters.markAttempts += 1
      const next = { ...current, ...patch, updatedAt: new Date().toISOString() }
      const inTrash = Boolean(next.deletedAt)
      write(
        live.filter((item) => item.id !== id).concat(inTrash ? [] : [next]),
        trash.filter((item) => item.id !== id).concat(inTrash ? [next] : []),
      )
      if (patch.purgeStatus === 'drive_purged') counters.markSuccesses += 1
      notify()
      return { ...next }
    },
    async deleteRow(id) {
      counters.metadataAttempts += 1
      const current = find(id)
      if (consumeFail(current, 'db_cleanup')) {
        log(`模拟数据库清理失败 ${current?.title ?? id}（云盘文件已删除，记录仍在回收站）`)
        notify()
        throw new Error(DB_CLEANUP_FAIL_MESSAGE)
      }
      write(
        live.filter((item) => item.id !== id),
        trash.filter((item) => item.id !== id),
      )
      counters.metadataSuccesses += 1
      log(`已清除相册记录 ${current?.title ?? id}`)
      notify()
    },
    async deleteDriveFile(_token, fileId) {
      counters.driveAttempts += 1
      const current = find(fileId)
      if (consumeFail(current, 'drive')) {
        log(`模拟云盘删除失败 ${current?.title ?? fileId}`)
        notify()
        throw new Error(DRIVE_FAIL_MESSAGE)
      }
      counters.driveSuccesses += 1
      log(`模拟云盘删除成功 ${current?.title ?? fileId}（未连接真实 Drive）`)
      notify()
    },
  }

  const bumpMutation = () => {
    counters.mutations += 1
    notify()
  }

  return {
    deps,
    snapshot(): AlbumTrashSnapshot {
      return {
        live: live.map((item) => ({ ...item })),
        trash: trash.map((item) => ({ ...item })),
        counters: { ...counters },
        driveFailOnce,
        dbCleanupFailOnce,
        pendingItemFails: [...itemFails.entries()].map(([id, plan]) => ({ id, plan })),
      }
    },
    setDriveFailOnce(value: boolean) {
      driveFailOnce = value
      notify()
    },
    setDbCleanupFailOnce(value: boolean) {
      dbCleanupFailOnce = value
      notify()
    },
    planItemFail(id: string, plan: FailPlan) {
      itemFails.set(id, plan)
      notify()
    },
    reset(options?: { fixture?: 'default' | 'partial' }) {
      live = initialLiveItems()
      counters = { ...ZERO_COUNTERS }
      driveFailOnce = false
      dbCleanupFailOnce = false
      itemFails.clear()
      if (options?.fixture === 'partial') {
        trash = [
          { ...PARTIAL_FAIL_FIXTURE.success },
          { ...PARTIAL_FAIL_FIXTURE.driveFail },
          { ...PARTIAL_FAIL_FIXTURE.dbCleanupFail },
        ]
        itemFails.set(PARTIAL_FAIL_FIXTURE.driveFail.id, 'drive')
        itemFails.set(PARTIAL_FAIL_FIXTURE.dbCleanupFail.id, 'db_cleanup')
        log('已载入部分失败夹具：一项成功、一项云盘失败、一项记录清理失败')
      } else {
        trash = initialTrashItems()
        log('已重置为初始合成数据')
      }
      notify()
    },
    async softDelete(id: string) {
      bumpMutation()
      return softDeleteAlbumItemInStore(id, deps)
    },
    async restore(id: string) {
      bumpMutation()
      return restoreAlbumItemInStore(id, deps)
    },
    async purge(id: string, token: string | null) {
      bumpMutation()
      return purgeAlbumItem({ id, token, deps })
    },
    async purgeMany(ids: readonly string[], token: string | null): Promise<AlbumPurgeBatchResult> {
      bumpMutation()
      return purgeAlbumItems({ ids, token, deps })
    },
  }
}

export type AlbumTrashMemory = ReturnType<typeof createAlbumTrashMemory>
export type { AlbumPurgeItemResult, AlbumPurgeBatchResult }
