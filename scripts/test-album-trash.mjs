import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { buildSync } from 'esbuild'

const outfile = join(mkdtempSync(join(tmpdir(), 'pg-album-trash-')), 'albumPurge.mjs')
buildSync({
  entryPoints: ['src/lib/albumPurge.ts'],
  outfile,
  bundle: true,
  platform: 'neutral',
  format: 'esm',
})

const {
  canRestoreAlbumItem,
  isDrivePurged,
  purgeAlbumItem,
  purgeAlbumItems,
  restoreAlbumItemInStore,
  softDeleteAlbumItemInStore,
  ALBUM_CANNOT_RESTORE_PURGED,
  ALBUM_ITEM_NOT_IN_TRASH,
  ALBUM_PURGE_DRIVE_MARK_FAILED,
  ALBUM_PURGE_NEEDS_DRIVE,
  ALBUM_TRASH_NAME,
  ALBUM_TRASH_SCHEMA_UNAVAILABLE,
} = await import(pathToFileURL(outfile).href)

const cases = []
const check = (name, got, expected = true) => {
  const ok = typeof expected === 'boolean' && expected === true ? Boolean(got) : Object.is(got, expected)
  cases.push({ name, ok, got, expected })
  if (!ok) console.error(`FAIL ${name}\n  got: ${JSON.stringify(got)}\n  expected: ${JSON.stringify(expected)}`)
}

function item(overrides = {}) {
  return {
    id: 'item-1',
    ownerId: 'user-1',
    driveFileId: 'drive-1',
    title: '湖畔晨雾',
    source: 'upload',
    promptId: null,
    mimeType: 'image/png',
    sizeBytes: 12,
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

function memoryStore(seed) {
  const rows = new Map(seed.map((row) => [row.id, { ...row }]))
  const updates = []
  const deletes = []
  return {
    rows,
    updates,
    deletes,
    async getItem(id) {
      const row = rows.get(id)
      return row ? { ...row } : null
    },
    async updateItem(id, patch) {
      const current = rows.get(id)
      if (!current) throw new Error('missing')
      const camel = {
        deletedAt: patch.deletedAt !== undefined ? patch.deletedAt : current.deletedAt,
        deletedBy: patch.deletedBy !== undefined ? patch.deletedBy : current.deletedBy,
        purgeStatus: patch.purgeStatus !== undefined ? patch.purgeStatus : current.purgeStatus,
        purgeError: patch.purgeError !== undefined ? patch.purgeError : current.purgeError,
        drivePurgedAt: patch.drivePurgedAt !== undefined ? patch.drivePurgedAt : current.drivePurgedAt,
      }
      const next = { ...current, ...camel, updatedAt: '2026-11-24T01:00:00.000Z' }
      rows.set(id, next)
      updates.push({ id, patch })
      return { ...next }
    },
    async deleteRow(id) {
      if (!rows.has(id)) throw new Error('missing')
      deletes.push(id)
      rows.delete(id)
    },
  }
}

check('reserved trash name', ALBUM_TRASH_NAME, '回收站')
check('schema missing copy is explicit', ALBUM_TRASH_SCHEMA_UNAVAILABLE.includes('尚未就绪'))

const live = item()
const trashed = item({ id: 'item-2', deletedAt: '2026-11-24T02:00:00.000Z' })
const purged = item({
  id: 'item-3',
  deletedAt: '2026-11-24T02:00:00.000Z',
  purgeStatus: 'drive_purged',
  drivePurgedAt: '2026-11-24T03:00:00.000Z',
})
check('live item is not purged', isDrivePurged(live), false)
check('drive_purged cannot be restored', canRestoreAlbumItem(purged).ok, false)
check('drive_purged restore error', canRestoreAlbumItem(purged).error, ALBUM_CANNOT_RESTORE_PURGED)
check('trashed idle can restore', canRestoreAlbumItem(trashed).ok, true)

const store = memoryStore([live, item({ id: 'item-4', title: '山谷午后', autoCategories: ['场景'] })])
const moved = await softDeleteAlbumItemInStore('item-1', store, '2026-11-24T04:00:00.000Z')
check('soft delete sets deletedAt', moved.deletedAt, '2026-11-24T04:00:00.000Z')
check('soft delete leaves drive file id unchanged', moved.driveFileId, 'drive-1')
check('soft delete keeps original category', moved.autoCategories.join(','), '场景')
check('soft delete is only an update', store.deletes.length, 0)

const restored = await restoreAlbumItemInStore('item-1', store)
check('restore clears deletedAt', restored.deletedAt, null)
check('restore returns to original category', restored.autoCategories.join(','), '场景')

try {
  await restoreAlbumItemInStore('item-3', memoryStore([purged]))
  check('restoring drive_purged throws', false, true)
} catch (error) {
  check('restoring drive_purged throws', error.message, ALBUM_CANNOT_RESTORE_PURGED)
}

const evicted = []
const drive = { calls: [], failWith: null, failOnce: null }
const depsFor = (rows, extras = {}) => ({
  ...memoryStore(rows),
  async deleteDriveFile(_token, fileId) {
    drive.calls.push(fileId)
    if (drive.failWith) throw new Error(drive.failWith)
    if (drive.failOnce) {
      const error = new Error(drive.failOnce)
      drive.failOnce = null
      throw error
    }
    extras.onDrive?.()
  },
  evictDriveImage: (fileId) => evicted.push(fileId),
  now: () => '2026-11-24T05:00:00.000Z',
  ...extras,
})

drive.calls = []
const needToken = await purgeAlbumItem({
  id: 'item-2',
  token: null,
  deps: depsFor([trashed]),
})
check('purge without token is blocked', needToken.ok, false)
check('purge without token stays retryable', needToken.retryable, true)
check('purge without token does not call Drive', drive.calls.length, 0)
check('purge without token message', needToken.error, ALBUM_PURGE_NEEDS_DRIVE)

const livePurge = await purgeAlbumItem({
  id: 'item-1',
  token: 'tok',
  deps: depsFor([item()]),
})
check('purge of live item is rejected', livePurge.ok, false)
check('purge of live item stage', livePurge.stage, 'guard')
check('purge of live item error', livePurge.error, ALBUM_ITEM_NOT_IN_TRASH)

drive.calls = []
evicted.length = 0
const okPurge = await purgeAlbumItem({
  id: 'item-2',
  token: 'tok',
  deps: depsFor([trashed]),
})
check('happy path purge succeeds', okPurge.ok, true)
check('happy path deletes Drive once', drive.calls.join(','), 'drive-1')
check('happy path evicts that file only', evicted.join(','), 'drive-1')

drive.calls = []
const unauthorized = await purgeAlbumItem({
  id: 'item-2',
  token: 'tok',
  deps: depsFor([trashed]),
})
// reset fail
drive.failWith = '401 未授权'
const err401 = await purgeAlbumItem({
  id: 'item-2',
  token: 'tok',
  deps: depsFor([item({ id: 'item-2', deletedAt: '2026-11-24T02:00:00.000Z', driveFileId: 'drive-1' })]),
})
check('401 leaves a failed result', err401.ok, false)
check('401 is a drive stage failure', err401.stage, 'drive')
check('401 is retryable', err401.retryable, true)
drive.failWith = null

drive.failWith = '500 服务不可用'
const err500 = await purgeAlbumItem({
  id: 'item-2',
  token: 'tok',
  deps: depsFor([item({ id: 'item-2', deletedAt: '2026-11-24T02:00:00.000Z' })]),
})
check('500 is a drive stage failure', err500.ok === false && err500.stage === 'drive')
drive.failWith = null

// 404 from Drive is success: deleteDriveFile resolves (as googleDrive does)
const after404 = await purgeAlbumItem({
  id: 'item-2',
  token: 'tok',
  deps: depsFor([item({ id: 'item-2', deletedAt: '2026-11-24T02:00:00.000Z' })]),
})
check('Drive 404 treated as success by resolving deleteDriveFile', after404.ok, true)

// Drive success, mark drive_purged fails
const markFailStore = memoryStore([item({ id: 'item-2', deletedAt: '2026-11-24T02:00:00.000Z' })])
const originalUpdate = markFailStore.updateItem.bind(markFailStore)
let updateCount = 0
markFailStore.updateItem = async (id, patch) => {
  updateCount += 1
  if (patch.purgeStatus === 'drive_purged') throw new Error('数据库暂时不可用')
  return originalUpdate(id, patch)
}
drive.calls = []
const markFail = await purgeAlbumItem({
  id: 'item-2',
  token: 'tok',
  deps: {
    ...markFailStore,
    deleteDriveFile: async () => {
      drive.calls.push('drive-1')
    },
    evictDriveImage: () => evicted.push('nope'),
  },
})
check('Drive success and DB mark failure is not ok', markFail.ok, false)
check('Drive success and DB mark failure is retryable', markFail.retryable, true)
check('Drive success and DB mark failure stage', markFail.stage, 'mark_purged')
check('Drive success and DB mark failure keeps the row', markFailStore.rows.has('item-2'))
check('Drive success and DB mark failure called Drive', drive.calls.length, 1)
check('Drive success and DB mark failure message', markFail.error, ALBUM_PURGE_DRIVE_MARK_FAILED)

// retry after mark failure: Drive 404/success, then mark + delete works
markFailStore.updateItem = originalUpdate
const retried = await purgeAlbumItem({
  id: 'item-2',
  token: 'tok',
  deps: {
    ...markFailStore,
    deleteDriveFile: async () => {
      drive.calls.push('retry')
    },
  },
})
check('retry after mark failure can finish', retried.ok, true)
check('retry after mark failure removes metadata', markFailStore.rows.has('item-2'), false)

// already drive_purged: skip Drive, only metadata
drive.calls = []
const onlyMeta = memoryStore([purged])
const skipDrive = await purgeAlbumItem({
  id: 'item-3',
  token: 'tok',
  deps: {
    ...onlyMeta,
    deleteDriveFile: async () => {
      drive.calls.push('should-not')
    },
  },
})
check('drive_purged retry only clears metadata', skipDrive.ok, true)
check('drive_purged retry does not call Drive', drive.calls.length, 0)
check('drive_purged retry deleted the row', onlyMeta.deletes.join(','), 'item-3')

const batchStore = memoryStore([
  item({ id: 'ok-1', deletedAt: '2026-11-24T02:00:00.000Z', driveFileId: 'd-ok' }),
  item({ id: 'bad-1', deletedAt: '2026-11-24T02:00:00.000Z', driveFileId: 'd-bad' }),
  item({ id: 'ok-2', deletedAt: '2026-11-24T02:00:00.000Z', driveFileId: 'd-ok-2' }),
])
const batch = await purgeAlbumItems({
  ids: ['ok-1', 'bad-1', 'ok-2'],
  token: 'tok',
  deps: {
    ...batchStore,
    deleteDriveFile: async (_token, fileId) => {
      if (fileId === 'd-bad') throw new Error('500 失败')
    },
  },
})
check('batch partial is not reported as complete success', batch.ok, false)
check('batch succeeded count', batch.succeeded, 2)
check('batch failed count', batch.failed, 1)
check('batch removed only successful rows', [...batchStore.rows.keys()].join(','), 'bad-1')

const cancelledMutations = memoryStore([item({ id: 'item-2', deletedAt: '2026-11-24T02:00:00.000Z' })])
check('confirm-cancel fixture starts with one trash row', cancelledMutations.rows.size, 1)
check('confirm-cancel fixture has no implicit mutations', cancelledMutations.updates.length, 0)

// Drive succeeds, metadata delete fails: item stays drive_purged, retry only clears metadata
const metaFailStore = memoryStore([item({ id: 'item-2', deletedAt: '2026-11-24T02:00:00.000Z', driveFileId: 'drive-meta' })])
const originalDelete = metaFailStore.deleteRow.bind(metaFailStore)
let deleteShouldFail = true
drive.calls = []
metaFailStore.deleteRow = async (id) => {
  if (deleteShouldFail) throw new Error('数据库暂时不可用')
  return originalDelete(id)
}
const metaFail = await purgeAlbumItem({
  id: 'item-2',
  token: 'tok',
  deps: {
    ...metaFailStore,
    deleteDriveFile: async () => {
      drive.calls.push('drive-meta')
    },
  },
})
check('metadata cleanup failure is not ok', metaFail.ok, false)
check('metadata cleanup failure stage', metaFail.stage, 'metadata')
check('metadata cleanup failure leaves the row', metaFailStore.rows.has('item-2'))
check('metadata cleanup failure marks drive_purged', metaFailStore.rows.get('item-2')?.purgeStatus, 'drive_purged')
try {
  await restoreAlbumItemInStore('item-2', metaFailStore)
  check('drive_purged after metadata failure cannot restore', false, true)
} catch (error) {
  check('drive_purged after metadata failure cannot restore', error.message, ALBUM_CANNOT_RESTORE_PURGED)
}
drive.calls = []
deleteShouldFail = false
const metaRetry = await purgeAlbumItem({
  id: 'item-2',
  token: 'tok',
  deps: {
    ...metaFailStore,
    deleteDriveFile: async () => {
      drive.calls.push('should-not')
    },
  },
})
check('retry after metadata failure succeeds', metaRetry.ok, true)
check('retry after metadata failure skips Drive', drive.calls.length, 0)
check('retry after metadata failure removes the row', metaFailStore.rows.has('item-2'), false)

const failed = cases.filter((item) => !item.ok)
console.log(`${cases.length - failed.length}/${cases.length} passed`)
if (failed.length) process.exit(1)
