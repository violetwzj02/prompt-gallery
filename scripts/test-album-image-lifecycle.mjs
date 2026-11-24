import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createElement, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { Window } from 'happy-dom'
import { buildSync } from 'esbuild'

const cacheDir = join(process.cwd(), 'node_modules', '.cache')
mkdirSync(cacheDir, { recursive: true })
const outfile = join(cacheDir, 'pg-album-slot.mjs')
buildSync({
  entryPoints: ['scripts/album-slot-test-entry.ts'],
  outfile,
  bundle: true,
  platform: 'browser',
  format: 'esm',
  external: ['react', 'react-dom', 'react/jsx-runtime'],
})

const {
  useDriveImageSlot,
  prefetchDriveImages,
  setDriveImageBlobFetcher,
  rebindDriveImageToken,
  clearDriveImageCache,
  peekDriveImage,
  DRIVE_IMAGE_SESSION_ENDED,
} = await import(pathToFileURL(outfile).href)

function solidBlob(label) {
  return new Blob([`png:${label}`], { type: 'image/png' })
}

function installWindow() {
  const happy = new Window({ url: 'https://example.test/album-harness' })
  globalThis.window = happy
  globalThis.document = happy.document
  globalThis.HTMLElement = happy.HTMLElement
  globalThis.Node = happy.Node
  globalThis.Document = happy.Document
  return happy
}

function Viewer({ token, ids, start = 0 }) {
  const [index, setIndex] = useState(start)
  const fileId = ids[index] ?? null
  const slot = useDriveImageSlot({ token, fileId, priority: 'high' })
  useEffect(() => {
    const neighbors = []
    if (ids[index - 1]) neighbors.push(ids[index - 1])
    if (ids[index + 1]) neighbors.push(ids[index + 1])
    if (token) prefetchDriveImages(token, neighbors)
  }, [token, ids, index])
  return createElement(
    'div',
    null,
    createElement('div', { 'data-testid': 'status' }, slot.error ? `error:${slot.error}` : slot.url ? `ready:${fileId}` : 'loading'),
    createElement('button', { 'data-testid': 'next', onClick: () => setIndex((value) => Math.min(ids.length - 1, value + 1)) }, 'next'),
    createElement('button', { 'data-testid': 'prev', onClick: () => setIndex((value) => Math.max(0, value - 1)) }, 'prev'),
  )
}

function slotLabel(slot, readyText = 'ready') {
  if (slot.loading) return 'loading'
  if (slot.error) return `error:${slot.error}`
  if (slot.url) return readyText
  return 'empty'
}

function Host({ token, fileId }) {
  const slot = useDriveImageSlot({ token, fileId, priority: 'high' })
  return createElement('div', { 'data-testid': 'status' }, slotLabel(slot))
}

function ThumbProbe({ token, fileId }) {
  const slot = useDriveImageSlot({ token, fileId, priority: 'low' })
  return createElement(
    'div',
    { 'data-testid': `thumb-${fileId}`, 'data-state': slot.loading ? 'loading' : slot.error ? 'error' : slot.url ? 'ready' : 'empty' },
    createElement('div', { 'data-testid': `thumb-status-${fileId}` }, slotLabel(slot)),
    slot.error ? null : createElement('span', { 'data-testid': `thumb-title-${fileId}` }, fileId),
  )
}

function AlbumProbe({ token, ids }) {
  const [index, setIndex] = useState(0)
  const fileId = ids[index] ?? null
  const slot = useDriveImageSlot({ token, fileId, priority: 'high' })
  useEffect(() => {
    const neighbors = []
    if (ids[index - 1]) neighbors.push(ids[index - 1])
    if (ids[index + 1]) neighbors.push(ids[index + 1])
    if (token) prefetchDriveImages(token, neighbors)
  }, [token, ids, index])
  return createElement(
    'div',
    null,
    createElement(
      'div',
      { 'data-testid': 'viewer', 'data-state': slot.loading ? 'loading' : slot.error ? 'error' : slot.url ? 'ready' : 'empty' },
      createElement('div', { 'data-testid': 'viewer-title' }, slot.error ? '' : fileId),
      createElement('div', { 'data-testid': 'viewer-status' }, slotLabel(slot, fileId ? `ready:${fileId}` : 'ready')),
    ),
    ids.map((id) => createElement(ThumbProbe, { key: id, token, fileId: id })),
    createElement('button', { 'data-testid': 'next', onClick: () => setIndex((value) => Math.min(ids.length - 1, value + 1)) }, 'next'),
  )
}

const cases = []
const check = (name, got, expected = true) => {
  const ok = typeof expected === 'boolean' && expected === true ? Boolean(got) : Object.is(got, expected) || JSON.stringify(got) === JSON.stringify(expected)
  cases.push({ name, ok, got, expected })
  if (!ok) console.error(`FAIL ${name}\n  got: ${JSON.stringify(got)}\n  expected: ${JSON.stringify(expected)}`)
}

async function flush() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

async function waitFor(fn, attempts = 40) {
  for (let i = 0; i < attempts; i += 1) {
    const value = fn()
    if (value) return value
    await flush()
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  return fn()
}

installWindow()
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const rootNode = document.createElement('div')
document.body.appendChild(rootNode)
const root = createRoot(rootNode)

let fetches = []
setDriveImageBlobFetcher(({ token, fileId }) => {
  return new Promise((resolve, reject) => {
    fetches.push({ token, fileId, resolve, reject })
  })
})

function pending(fileId) {
  return fetches.filter((item) => item.fileId === fileId && !item.done)
}

function resolvePending(fileId, token) {
  for (const item of pending(fileId)) {
    if (token && item.token !== token) continue
    item.done = true
    item.resolve(solidBlob(`${fileId}:${item.token}`))
  }
}

// Slow first load, then token rebind, should recover without the old cache-cleared message.
fetches = []
await act(async () => {
  root.render(createElement(Host, { token: 'tok-1', fileId: 'one' }))
})
check('initial mount is loading', await waitFor(() => rootNode.textContent === 'loading'), true)
check('one network request', fetches.filter((item) => item.fileId === 'one').length, 1)
rebindDriveImageToken('tok-2')
await flush()
check('rebind did not show an error', !String(rootNode.textContent).startsWith('error:') && !String(rootNode.textContent).includes('相册图片缓存已清空'))
resolvePending('one')
check('rebind load becomes ready', await waitFor(() => rootNode.textContent === 'ready'))

// Logout while visible should show the session-ended message, and should not retry forever.
fetches = []
await act(async () => {
  root.render(createElement(Host, { token: 'tok-2', fileId: 'two' }))
})
await waitFor(() => pending('two').length > 0)
await act(async () => {
  clearDriveImageCache('logout')
})
for (const item of pending('two')) {
  item.done = true
  item.resolve(solidBlob('late'))
}
await waitFor(() => String(rootNode.textContent).startsWith('error:'))
check('logout shows reconnect copy instead of cache-cleared', rootNode.textContent, `error:${DRIVE_IMAGE_SESSION_ENDED}`)
check('no 相册图片缓存已清空 text', rootNode.textContent.includes('相册图片缓存已清空'), false)

// Viewer: back to a prefetched neighbor after a slow first load should not refetch.
await act(async () => {
  rebindDriveImageToken('tok-v')
})
fetches = []
const ids = ['a', 'b', 'c']
await act(async () => {
  root.render(createElement(Viewer, { token: 'tok-v', ids }))
})
await waitFor(() => pending('a').length > 0)
resolvePending('a')
check('first frame ready', await waitFor(() => rootNode.textContent.includes('ready:a')), true)
await waitFor(() => pending('b').length > 0)
resolvePending('b')
await flush()
const bCount = () => fetches.filter((item) => item.fileId === 'b').length
const aCount = () => fetches.filter((item) => item.fileId === 'a').length
const beforeNext = bCount()
await act(async () => {
  rootNode.querySelector('[data-testid="next"]').click()
})
await waitFor(() => rootNode.textContent.includes('ready:b'))
check('next shows prefetched image', rootNode.textContent.includes('ready:b'))
check('next uses prefetch without a new request', bCount(), beforeNext)
await waitFor(() => pending('c').length > 0)
resolvePending('c')
const beforeBack = aCount()
await act(async () => {
  rootNode.querySelector('[data-testid="prev"]').click()
})
await waitFor(() => rootNode.textContent.includes('ready:a'))
check('back to previous stays ready without refetch', aCount(), beforeBack)
check('back did not flash the cache-cleared error', rootNode.textContent.includes('相册图片缓存已清空'), false)

// Repeated unmount/remount of the same file should reuse the cache.
fetches = []
await act(async () => {
  root.render(createElement(Host, { token: 'tok-v', fileId: 'a' }))
})
await waitFor(() => rootNode.textContent === 'ready')
check('remount is immediately ready from cache', rootNode.textContent, 'ready')
check('remount did not refetch a', pending('a').length, 0)

// Concurrent components sharing a fileId cause a single inflight request.
fetches = []
function Pair() {
  const left = useDriveImageSlot({ token: 'tok-p', fileId: 'pair', priority: 'high' })
  const right = useDriveImageSlot({ token: 'tok-p', fileId: 'pair', priority: 'low' })
  return createElement('div', { 'data-testid': 'status' }, `${left.url ? 'L' : 'l'}${right.url ? 'R' : 'r'}`)
}
await act(async () => {
  root.render(createElement(Pair))
})
await waitFor(() => pending('pair').length > 0)
check('concurrent components share one fetch', fetches.filter((item) => item.fileId === 'pair').length, 1)
resolvePending('pair')
await waitFor(() => rootNode.textContent === 'LR')
check('both components become ready', rootNode.textContent, 'LR')

// Logout after images are already ready, token still present (stale production token).
await act(async () => {
  rebindDriveImageToken('tok-ready')
})
fetches = []
await act(async () => {
  root.render(createElement(Host, { token: 'tok-ready', fileId: 'ready-one' }))
})
await waitFor(() => pending('ready-one').length > 0)
resolvePending('ready-one')
check('ready-one becomes ready before logout', await waitFor(() => rootNode.textContent === 'ready'))
const readyFetches = fetches.filter((item) => item.fileId === 'ready-one').length
await act(async () => {
  clearDriveImageCache('logout')
})
check('logout after ready shows reconnect, not loading', await waitFor(() => rootNode.textContent === `error:${DRIVE_IMAGE_SESSION_ENDED}`))
check('logout after ready is not loading', rootNode.textContent.includes('loading'), false)
check('logout after ready does not show cache-cleared', rootNode.textContent.includes('相册图片缓存已清空'), false)
check('logout after ready does not start a new fetch', fetches.filter((item) => item.fileId === 'ready-one').length, readyFetches)
await flush()
await flush()
check('logout after ready does not retry later', fetches.filter((item) => item.fileId === 'ready-one').length, readyFetches)

// Harness-shaped album: clear then drop token, titles must disappear and thumbs/viewer leave loading.
await act(async () => {
  rebindDriveImageToken('tok-album')
})
fetches = []
const albumIds = ['synth-1', 'synth-2']
await act(async () => {
  root.render(createElement(AlbumProbe, { token: 'tok-album', ids: albumIds }))
})
await waitFor(() => pending('synth-1').length > 0 && pending('synth-2').length > 0)
resolvePending('synth-1')
resolvePending('synth-2')
check('album probe viewer is ready', await waitFor(() => document.querySelector('[data-testid="viewer-status"]')?.textContent === 'ready:synth-1'))
check('album probe shows the current title', document.querySelector('[data-testid="viewer-title"]')?.textContent, 'synth-1')
check('thumb title is visible before logout', Boolean(document.querySelector('[data-testid="thumb-title-synth-1"]')))
const albumFetchCount = fetches.length
await act(async () => {
  clearDriveImageCache('logout')
  root.render(createElement(AlbumProbe, { token: null, ids: albumIds }))
})
check(
  'viewer status after harness logout is reconnect',
  await waitFor(() => document.querySelector('[data-testid="viewer-status"]')?.textContent === `error:${DRIVE_IMAGE_SESSION_ENDED}`),
)
check('viewer leaves loading after logout', document.querySelector('[data-testid="viewer"]')?.getAttribute('data-state'), 'error')
check('viewer title is cleared after logout', document.querySelector('[data-testid="viewer-title"]')?.textContent, '')
check('viewer text does not keep 载入中', document.querySelector('[data-testid="viewer"]')?.textContent.includes('载入中'), false)
check('thumb-1 status is reconnect', document.querySelector('[data-testid="thumb-status-synth-1"]')?.textContent, `error:${DRIVE_IMAGE_SESSION_ENDED}`)
check('thumb-2 status is reconnect', document.querySelector('[data-testid="thumb-status-synth-2"]')?.textContent, `error:${DRIVE_IMAGE_SESSION_ENDED}`)
check('thumb-1 title is removed', document.querySelector('[data-testid="thumb-title-synth-1"]') == null)
check('thumb-2 title is removed', document.querySelector('[data-testid="thumb-title-synth-2"]') == null)
check('harness logout does not refetch', fetches.length, albumFetchCount)
await flush()
await new Promise((resolve) => setTimeout(resolve, 20))
check('harness logout does not retry after a wait', fetches.length, albumFetchCount)
check('log hint is not used as the only reconnect state', document.querySelector('[data-testid="viewer-status"]')?.textContent, `error:${DRIVE_IMAGE_SESSION_ENDED}`)

// Reconnect after logout should load again.
await act(async () => {
  rebindDriveImageToken('tok-back')
})
fetches = []
await act(async () => {
  root.render(createElement(Host, { token: 'tok-back', fileId: 'back-one' }))
})
check('reconnect starts loading again', await waitFor(() => rootNode.textContent === 'loading'))
await waitFor(() => pending('back-one').length > 0)
resolvePending('back-one')
check('reconnect becomes ready', await waitFor(() => rootNode.textContent === 'ready'))

await act(async () => {
  root.unmount()
})

const failed = cases.filter((item) => !item.ok)
console.log(`${cases.length - failed.length}/${cases.length} passed`)
if (failed.length) process.exit(1)
