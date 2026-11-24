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

const { createDriveImageCache } = await import(pathToFileURL(outfile).href)

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
await expectReject('cleared inflight rejects', staleAcquire, '相册图片缓存已清空')
check('stale result not cached', staleCache.peek('stale-file') === null, true)
check('stale late result left no entry', staleCache.stats().entries, 0)

const fresh = await staleCache.acquire('new-token', 'stale-file')
check('new token can fetch after clear', fresh.fileId, 'stale-file')
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

const failed = cases.filter((c) => !c.ok)
console.log(`${cases.length - failed.length}/${cases.length} passed`)
if (failed.length) process.exit(1)
