import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { buildSync } from 'esbuild'

const outfile = join(mkdtempSync(join(tmpdir(), 'pg-album-trash-mem-')), 'albumTrashMemory.mjs')
buildSync({
  entryPoints: ['scripts/album-trash-memory.ts'],
  outfile,
  bundle: true,
  platform: 'neutral',
  format: 'esm',
})

const {
  ALBUM_CANNOT_RESTORE_PURGED,
  ALBUM_PURGE_METADATA_FAILED,
  PARTIAL_FAIL_FIXTURE,
  createAlbumTrashMemory,
} = await import(pathToFileURL(outfile).href)

const cases = []
const check = (name, got, expected = true) => {
  const ok = typeof expected === 'boolean' && expected === true ? Boolean(got) : Object.is(got, expected)
  cases.push({ name, ok, got, expected })
  if (!ok) console.error(`FAIL ${name}\n  got: ${JSON.stringify(got)}\n  expected: ${JSON.stringify(expected)}`)
}

const store = createAlbumTrashMemory()
store.reset({ fixture: 'partial' })
let snap = store.snapshot()
check('partial fixture has three trash rows', snap.trash.length, 3)
check('partial fixture does not bump mutations until an action', snap.counters.mutations, 0)

const first = await store.purgeMany(
  [PARTIAL_FAIL_FIXTURE.success.id, PARTIAL_FAIL_FIXTURE.driveFail.id, PARTIAL_FAIL_FIXTURE.dbCleanupFail.id],
  'tok',
)
snap = store.snapshot()
check('partial batch is not full success', first.ok, false)
check('partial batch succeeded count', first.succeeded, 1)
check('partial batch failed count', first.failed, 2)
check('partial batch keeps two rows', snap.trash.length, 2)
check('drive-fail item remains', snap.trash.some((item) => item.id === PARTIAL_FAIL_FIXTURE.driveFail.id))
check('db-cleanup item remains', snap.trash.some((item) => item.id === PARTIAL_FAIL_FIXTURE.dbCleanupFail.id))
check('successful item was removed', snap.trash.some((item) => item.id === PARTIAL_FAIL_FIXTURE.success.id), false)
check('drive-fail status is failed', snap.trash.find((item) => item.id === PARTIAL_FAIL_FIXTURE.driveFail.id)?.purgeStatus, 'failed')
check(
  'db-cleanup status is drive_purged',
  snap.trash.find((item) => item.id === PARTIAL_FAIL_FIXTURE.dbCleanupFail.id)?.purgeStatus,
  'drive_purged',
)
check('first pass drive attempts', snap.counters.driveAttempts, 3)
check('first pass drive successes', snap.counters.driveSuccesses, 2)
check('first pass metadata attempts', snap.counters.metadataAttempts, 2)
check('first pass metadata successes', snap.counters.metadataSuccesses, 1)
check('first pass marked drive_purged twice', snap.counters.markSuccesses, 2)

try {
  await store.restore(PARTIAL_FAIL_FIXTURE.dbCleanupFail.id)
  check('cannot restore drive_purged fixture', false, true)
} catch (error) {
  check('cannot restore drive_purged fixture', error.message, ALBUM_CANNOT_RESTORE_PURGED)
}
snap = store.snapshot()
check('failed restore does not remove the purged row', snap.trash.some((item) => item.id === PARTIAL_FAIL_FIXTURE.dbCleanupFail.id))

const restored = await store.restore(PARTIAL_FAIL_FIXTURE.driveFail.id)
check('drive-fail item can still be restored', restored.deletedAt, null)
store.reset({ fixture: 'partial' })
await store.purgeMany(
  [PARTIAL_FAIL_FIXTURE.success.id, PARTIAL_FAIL_FIXTURE.driveFail.id, PARTIAL_FAIL_FIXTURE.dbCleanupFail.id],
  'tok',
)

const beforeRetry = store.snapshot().counters
const retry = await store.purgeMany(
  [PARTIAL_FAIL_FIXTURE.driveFail.id, PARTIAL_FAIL_FIXTURE.dbCleanupFail.id],
  'tok',
)
snap = store.snapshot()
check('retry after planned failures succeeds', retry.ok, true)
check('retry only calls Drive for the earlier Drive failure', snap.counters.driveAttempts - beforeRetry.driveAttempts, 1)
check('retry Drive successes increase by one', snap.counters.driveSuccesses - beforeRetry.driveSuccesses, 1)
check('retry metadata successes increase by two', snap.counters.metadataSuccesses - beforeRetry.metadataSuccesses, 2)
check('retry leaves trash empty', snap.trash.length, 0)

const cancelStore = createAlbumTrashMemory()
const cancelSnap = cancelStore.snapshot()
check('fresh store has zero mutations before any confirm', cancelSnap.counters.mutations, 0)
check('fresh store has zero drive attempts', cancelSnap.counters.driveAttempts, 0)

const oneShot = createAlbumTrashMemory()
oneShot.setDbCleanupFailOnce(true)
const once = await oneShot.purge('trash-one', 'tok')
check('one-shot db cleanup failure is metadata stage', once.ok === false && once.stage === 'metadata')
check('one-shot flag clears itself', oneShot.snapshot().dbCleanupFailOnce, false)
check('one-shot leaves drive_purged item', oneShot.snapshot().trash[0]?.purgeStatus, 'drive_purged')
const onceRetry = await oneShot.purge('trash-one', 'tok')
check('one-shot retry only clears metadata', onceRetry.ok, true)
check('one-shot retry does not add a second Drive success if already purged', oneShot.snapshot().counters.driveSuccesses, 1)

const failed = cases.filter((item) => !item.ok)
console.log(`${cases.length - failed.length}/${cases.length} passed`)
if (failed.length) process.exit(1)
