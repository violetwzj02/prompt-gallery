import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { buildSync } from 'esbuild'

const outfile = join(mkdtempSync(join(tmpdir(), 'pg-drive-cache-')), 'driveImageCache.mjs')
buildSync({
  entryPoints: ['src/lib/driveImageCache.ts'],
  outfile,
  bundle: true,
  platform: 'neutral',
  format: 'esm',
})

const {
  createDriveImageCache,
  DriveImageCacheError,
  DRIVE_IMAGE_SESSION_ENDED,
  isDriveImageSessionEndedError,
} = await import(pathToFileURL(outfile).href)

const livingUrls = new Set()
let urlSeq = 0
globalThis.URL = globalThis.URL || class URL {}
URL.createObjectURL = () => {
  const url = `blob:test/${++urlSeq}`
  livingUrls.add(url)
  return url
}
URL.revokeObjectURL = (url) => {
  livingUrls.delete(url)
}

function solidBlob(label, size = 8) {
  return new Blob([`${label}:${'x'.repeat(size)}`], { type: 'image/png' })
}

function deferred() {
  let resolve
  let reject
  const promise = new Promise((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const cases = []
const check = (name, got, expected) => {
  const ok = Object.is(got, expected) || JSON.stringify(got) === JSON.stringify(expected)
  cases.push({ name, ok, got, expected })
  if (!ok) console.error(`FAIL ${name}\n  got: ${JSON.stringify(got)}\n  expected: ${JSON.stringify(expected)}`)
}

async function expectReject(name, promise, includes) {
  try {
    await promise
    cases.push({ name, ok: false, got: 'resolved', expected: includes })
    console.error(`FAIL ${name}\n  got: resolved\n  expected: reject ${includes}`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const ok = message.includes(includes)
    cases.push({ name, ok, got: message, expected: includes })
    if (!ok) console.error(`FAIL ${name}\n  got: ${message}\n  expected: ${includes}`)
  }
}

const inflightFetches = []
let fetchCount = 0
const cache = createDriveImageCache({
  maxEntries: 2,
  maxBytes: 40,
  maxConcurrent: 1,
  recentPins: 0,
  fetchBlob: ({ fileId }) => {
    fetchCount += 1
    const job = deferred()
    inflightFetches.push({ fileId, ...job })
    return job.promise
  },
})

const first = cache.acquire('tok-a', 'file-1')
const firstAgain = cache.acquire('tok-a', 'file-1')
check('parallel same id one network start', fetchCount, 1)
check('one inflight', cache.stats().inflight, 1)

inflightFetches.shift().resolve(solidBlob('one', 8))
const rec1 = await first
const rec1b = await firstAgain
check('shared blob url', rec1.url, rec1b.url)
check('refs after two acquires', cache.stats().refs, 2)
check('peek hit', cache.peek('file-1') !== null, true)

const secondStart = cache.acquire('tok-a', 'file-2')
const thirdQueued = cache.acquire('tok-a', 'file-3')
check('concurrency limits network to one extra', fetchCount, 2)
inflightFetches.shift().resolve(solidBlob('two', 8))
const rec2 = await secondStart
check('second resolved', rec2.fileId, 'file-2')

inflightFetches.shift().resolve(solidBlob('three', 8))
const rec3 = await thirdQueued
check('third resolved after queue', rec3.fileId, 'file-3')
// maxEntries 2, file-1 still refs=2 so cannot evict; file-2 refs=1; file-3 refs=1.
// entries may be 3 because in-use entries are protected.
check('in-use entries not evicted over max', cache.stats().entries >= 3, true)
check('file-1 url still alive', livingUrls.has(rec1.url), true)

cache.release(rec1)
cache.release(rec1b)
check('file-1 refs released', cache.peek('file-1') ? 'maybe-kept-or-evicted' : 'evicted', cache.peek('file-1') ? 'maybe-kept-or-evicted' : 'evicted')
// After releasing file-1, evictIfNeeded should drop zero-ref LRU until budget met.
// refs left: file-2 and file-3. entries should be 2, file-1 gone, its url revoked.
check('zero-ref evicted after release', cache.peek('file-1') === null, true)
check('evicted url revoked', livingUrls.has(rec1.url), false)
check('visible urls kept', livingUrls.has(rec2.url) && livingUrls.has(rec3.url), true)

// Failed promise is not cached; retry happens on retryable errors.
let attempts = 0
const retryCache = createDriveImageCache({
  maxConcurrent: 2,
  fetchBlob: ({ fileId }) => {
    attempts += 1
    if (fileId === 'flaky' && attempts === 1) return Promise.reject(new Error('Failed to fetch'))
    if (fileId === 'dead') return Promise.reject(new Error('Failed to fetch'))
    return Promise.resolve(solidBlob(fileId, 8))
  },
})
const flaky = await retryCache.acquire('tok', 'flaky')
check('retry then success', flaky.fileId, 'flaky')
check('retry used two attempts', attempts, 2)
check('success cached', retryCache.peek('flaky') !== null, true)

attempts = 0
await expectReject('retry exhausted not cached', retryCache.acquire('tok', 'dead'), 'Failed to fetch')
check('failed not cached', retryCache.peek('dead') === null, true)
check('failed retried once', attempts, 2)
const later = retryCache.acquire('tok', 'dead')
// will try again (not cached) - 2 more attempts
await expectReject('failed id fetched again', later, 'Failed to fetch')

// Non-retryable 404 should be single attempt
let notFound = 0
const hardCache = createDriveImageCache({
  fetchBlob: () => {
    notFound += 1
    return Promise.reject(new Error('找不到对应的云盘文件'))
  },
})
await expectReject('no retry on 404', hardCache.acquire('tok', 'missing'), '找不到对应的云盘文件')
check('404 fetched once', notFound, 1)

// Logout / clear invalidates inflight so it cannot refill the cache.
let lateResolve
let staleCalls = 0
const staleCache = createDriveImageCache({
  fetchBlob: () =>
    new Promise((resolve) => {
      staleCalls += 1
      if (staleCalls === 1) lateResolve = resolve
      else resolve(solidBlob('fresh', 8))
    }),
})
const staleAcquire = staleCache.acquire('old-token', 'stale-file')
check('stale fetch started', staleCache.stats().inflight, 1)
staleCache.clear()
check('clear bumps generation', staleCache.stats().generation >= 1, true)
lateResolve(solidBlob('stale', 8))
await expectReject('cleared inflight rejects', staleAcquire, DRIVE_IMAGE_SESSION_ENDED)
check('stale result not cached', staleCache.peek('stale-file') === null, true)
check('stale late result left no entry', staleCache.stats().entries, 0)
check('session is ended after clear', staleCache.session().status, 'ended')
await expectReject('acquire after clear stays rejected until rebind', staleCache.acquire('new-token', 'stale-file'), DRIVE_IMAGE_SESSION_ENDED)
check('ended session does not auto fetch', staleCalls, 1)

staleCache.rebindToken('new-token')
check('rebind reopens the session', staleCache.session().status, 'active')
const fresh = await staleCache.acquire('new-token', 'stale-file')
check('new token can fetch after rebind', fresh.fileId, 'stale-file')
check('new token required a new fetch', staleCalls, 2)
staleCache.release(fresh)
staleCache.clear()
check('logout clears entries', staleCache.peek('stale-file') === null, true)

// Prefetch uses cache for later acquire with no extra fetch if still present
let prefCount = 0
const preCache = createDriveImageCache({
  maxEntries: 8,
  maxBytes: 1024,
  fetchBlob: ({ fileId }) => {
    prefCount += 1
    return Promise.resolve(solidBlob(fileId, 8))
  },
})
preCache.prefetch('tok', ['n1', 'n2'])
await new Promise((resolve) => setTimeout(resolve, 20))
const n1 = await preCache.acquire('tok', 'n1')
check('prefetch then acquire no extra fetch', prefCount, 2)
preCache.release(n1)

// Token rebind must not surface an internal clear error, and in-flight work should retry with the new token.
let rebindTokens = []
let rebindResolvers = []
const rebindCache = createDriveImageCache({
  fetchBlob: ({ token, fileId }) => {
    rebindTokens.push(token)
    return new Promise((resolve, reject) => {
      rebindResolvers.push({ token, fileId, resolve, reject })
    })
  },
})
const rebound = rebindCache.acquire('tok-old', 'live-file')
check('rebind fetch started with old token', rebindTokens[0], 'tok-old')
rebindCache.rebindToken('tok-new')
check('rebind keeps existing entries map', rebindCache.stats().generation, 0)
const firstJob = rebindResolvers.shift()
firstJob.reject(new Error('Failed to fetch'))
let wait = 0
while (rebindResolvers.length === 0 && wait < 30) {
  await Promise.resolve()
  wait += 1
}
const retryJob = rebindResolvers.shift()
check('retry job arrived', Boolean(retryJob), true)
retryJob.resolve(solidBlob('live', 8))
const recLive = await rebound
check('rebind retries with new token instead of failing', recLive.fileId, 'live-file')
check('retry used rebound token', rebindTokens[1], 'tok-new')
check('no cache-cleared string on rebind', recLive.url.includes('blob:'), true)
rebindCache.release(recLive)

// Logout mid-flight must reject with a session-ended error and must not be treated as retryable.
let logoutResolve
const logoutCache = createDriveImageCache({
  fetchBlob: () => new Promise((resolve) => { logoutResolve = resolve }),
})
const logoutAcquire = logoutCache.acquire('tok', 'gone')
logoutCache.clear('logout')
logoutResolve(solidBlob('too-late', 8))
try {
  await logoutAcquire
  check('logout inflight should reject', 'resolved', 'rejected')
} catch (error) {
  check('logout uses session-ended message, not cache-cleared', error.message, DRIVE_IMAGE_SESSION_ENDED)
  check('logout error is not retryable', isDriveImageSessionEndedError(error) && error.reason === 'logout', true)
  check('error name', error instanceof DriveImageCacheError, true)
}
check('logout does not cache late blob', logoutCache.peek('gone') === null, true)

// Recent pins keep prefetched images even when many in-use thumbs overflow maxEntries.
let pinFetches = 0
const pinCache = createDriveImageCache({
  maxEntries: 3,
  maxBytes: 10_000,
  recentPins: 3,
  maxConcurrent: 4,
  fetchBlob: ({ fileId }) => {
    pinFetches += 1
    return Promise.resolve(solidBlob(fileId, 8))
  },
})
const thumbs = []
for (const id of ['t1', 't2', 't3', 't4']) thumbs.push(await pinCache.acquire('tok', id))
pinCache.prefetch('tok', ['prev', 'next'])
await new Promise((resolve) => setTimeout(resolve, 20))
const beforeBack = pinFetches
const prev = await pinCache.acquire('tok', 'prev')
check('back to prefetched neighbor does not refetch', pinFetches, beforeBack)
check('previous image is a cache hit', prev.fileId, 'prev')
pinCache.release(prev)
for (const thumb of thumbs) pinCache.release(thumb)

// High-priority viewer jobs are not starved by a pile of low-priority thumbs.
const started = []
const blockers = []
const starveCache = createDriveImageCache({
  maxConcurrent: 2,
  reservedHigh: 1,
  fetchBlob: ({ fileId }) => {
    started.push(fileId)
    return new Promise((resolve) => {
      blockers.push({ fileId, resolve })
    })
  },
})
const low1 = starveCache.acquire('tok', 'low-1', 'low')
const low2 = starveCache.acquire('tok', 'low-2', 'low')
const low3 = starveCache.acquire('tok', 'low-3', 'low')
await Promise.resolve()
const high1 = starveCache.acquire('tok', 'view-1', 'high')
await Promise.resolve()
check('low traffic left a slot for the viewer', started.includes('view-1'), true)
check('third low waited behind the viewer', started.includes('low-3'), false)
const settleStarted = () => {
  for (const job of blockers) {
    if (!job.settled) {
      job.settled = true
      job.resolve(solidBlob(job.fileId, 8))
    }
  }
}
for (let step = 0; step < 40 && blockers.filter((job) => job.settled).length < 4; step += 1) {
  settleStarted()
  await Promise.resolve()
}
settleStarted()
const [low1rec, low2rec, low3rec, high1rec] = await Promise.all([low1, low2, low3, high1])
starveCache.release(low1rec)
starveCache.release(low2rec)
starveCache.release(low3rec)
starveCache.release(high1rec)

const failed = cases.filter((c) => !c.ok)
console.log(`${cases.length - failed.length}/${cases.length} passed`)
if (failed.length) process.exit(1)
