import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { buildSync } from 'esbuild'

const outfile = join(mkdtempSync(join(tmpdir(), 'pg-drive-thumb-')), 'driveThumbnails.mjs')
buildSync({
  entryPoints: ['src/lib/driveThumbnails.ts'],
  outfile,
  bundle: true,
  platform: 'neutral',
  format: 'esm',
})

const { getDriveThumb, peekDriveThumb, clearDriveThumbs } = await import(pathToFileURL(outfile).href)

let assertions = 0
function check(label, condition) {
  assertions += 1
  if (!condition) throw new Error(`FAIL: ${label}`)
}

const calls = []
let nextThumb = 'https://lh3.googleusercontent.com/drive-viewer/abc=s220'
let failNext = false

globalThis.fetch = async (url, init) => {
  const href = String(url)
  calls.push(href)
  const auth = init?.headers?.get?.('Authorization') ?? (init?.headers?.Authorization ?? null)
  check('request carries bearer token', String(auth).startsWith('Bearer token-1'))
  if (failNext) return { ok: false, status: 500, json: async () => ({}) }
  if (!href.includes('/files/FILE_1?') || !href.includes('fields=id,thumbnailLink')) {
    return { ok: false, status: 404, json: async () => ({}) }
  }
  return { ok: true, status: 200, json: async () => ({ thumbnailLink: nextThumb }) }
}

// 1. preview link is upgraded to a wide render.
const first = await getDriveThumb('token-1', 'FILE_1')
check('returns upgraded preview url', first === 'https://lh3.googleusercontent.com/drive-viewer/abc=w1600')
check('cached for the next render', peekDriveThumb('FILE_1') === first)
check('one request so far', calls.length === 1)

// 2. repeat lookups never refetch.
const second = await getDriveThumb('token-1', 'FILE_1')
check('repeat lookup hits cache', second === first && calls.length === 1)

// 3. concurrent lookups collapse into one request.
clearDriveThumbs()
calls.length = 0
const [a, b, c] = await Promise.all([
  getDriveThumb('token-1', 'FILE_1'),
  getDriveThumb('token-1', 'FILE_1'),
  getDriveThumb('token-1', 'FILE_1'),
])
check('concurrent lookups dedupe', calls.length === 1 && a === b && b === c)

// 4. failures resolve null and stay retryable.
clearDriveThumbs()
calls.length = 0
failNext = true
const failed = await getDriveThumb('token-1', 'FILE_1')
check('failure resolves null', failed === null)
check('failure is not cached', peekDriveThumb('FILE_1') === null)
failNext = false
const recovered = await getDriveThumb('token-1', 'FILE_1')
check('retry after failure succeeds', recovered === 'https://lh3.googleusercontent.com/drive-viewer/abc=w1600')

// 5. missing inputs short-circuit without a request.
clearDriveThumbs()
calls.length = 0
check('no token means no thumb', (await getDriveThumb(null, 'FILE_1')) === null)
check('no file means no thumb', (await getDriveThumb('token-1', null)) === null)
check('no request for empty inputs', calls.length === 0)

// 6. clear drops cached previews.
clearDriveThumbs()
check('clear empties cache', peekDriveThumb('FILE_1') === null)

console.log(`drive thumbnails: ${assertions} assertions passed`)
