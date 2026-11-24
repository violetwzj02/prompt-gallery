import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { Window } from 'happy-dom'
import { buildSync } from 'esbuild'

const cacheDir = join(process.cwd(), 'node_modules', '.cache')
mkdirSync(cacheDir, { recursive: true })
const outfile = join(cacheDir, 'pg-album-thumb-ui.mjs')
buildSync({
  entryPoints: ['scripts/album-thumb-ui-entry.ts'],
  outfile,
  bundle: true,
  platform: 'browser',
  format: 'esm',
  external: ['react', 'react-dom', 'react/jsx-runtime'],
  define: {
    'import.meta.env.VITE_GOOGLE_CLIENT_ID': '"test-client"',
    'import.meta.env.VITE_SUPABASE_URL': '""',
    'import.meta.env.VITE_SUPABASE_ANON_KEY': '""',
    'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY': '""',
    'import.meta.env.DEV': 'true',
    'import.meta.env.PROD': 'false',
    'import.meta.env.MODE': '"test"',
    'import.meta.env.BASE_URL': '"/"',
  },
})

const { AlbumFlipBook, clearDriveImageCache, rebindDriveImageToken, clearDriveThumbs, peekDriveThumb } = await import(
  pathToFileURL(outfile).href
)

const THUMB = 'https://lh3.googleusercontent.com/drive-viewer/thumb=w1600'
let thumbRequests = 0
let mediaRequests = 0
const pendingMedia = []
let blobSeq = 0

const happy = new Window({ url: 'https://example.test/#/me/album' })
globalThis.window = happy
globalThis.document = happy.document
globalThis.HTMLElement = happy.HTMLElement
globalThis.Node = happy.Node
globalThis.IS_REACT_ACT_ENVIRONMENT = true

if (!globalThis.URL) globalThis.URL = {}
if (typeof globalThis.URL.createObjectURL !== 'function') {
  globalThis.URL.createObjectURL = () => `blob:test/${++blobSeq}`
  globalThis.URL.revokeObjectURL = () => {}
}

globalThis.fetch = async (url, init) => {
  const href = String(url)
  if (href.includes('fields=id,thumbnailLink')) {
    thumbRequests += 1
    return new Response(JSON.stringify({ thumbnailLink: 'https://lh3.googleusercontent.com/drive-viewer/thumb=s220' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  if (href.includes('alt=media')) {
    mediaRequests += 1
    // Full-size bytes are held back first (the slow original that used to
    // leave the card stuck on 「载入中…」), then released to prove the
    // download path still receives the original bytes.
    return new Promise((resolve) => {
      pendingMedia.push(() =>
        resolve(
          new Response(new Blob(['FULL-RESOLUTION-ORIGINAL'], { type: 'image/jpeg' }), {
            status: 200,
            headers: { 'Content-Type': 'image/jpeg' },
          }),
        ),
      )
    })
  }
  if (href.includes('/files/') && init?.method === 'DELETE') return new Response(null, { status: 204 })
  return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } })
}

const items = [1, 2, 3].map((n) => ({
  id: `item-${n}`,
  ownerId: 'user-1',
  driveFileId: `file-${n}`,
  title: `蒂法·侧身跪坐${n}`,
  source: 'upload',
  promptId: null,
  mimeType: 'image/jpeg',
  sizeBytes: 1024,
  autoCategories: ['18+'],
  customCategories: ['蒂法'],
  createdAt: '2026-11-24T00:00:00.000Z',
  updatedAt: null,
  deletedAt: null,
  deletedBy: null,
  purgeStatus: 'idle',
  purgeError: null,
  drivePurgedAt: null,
}))

const container = document.createElement('div')
document.body.appendChild(container)
const root = createRoot(container)

const settle = async () => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

clearDriveImageCache('reset')
clearDriveThumbs()
rebindDriveImageToken('token-1')
await act(async () => {
  root.render(createElement(AlbumFlipBook, { items, token: 'token-1', character: '蒂法', onOpen: () => {} }))
})
await settle()

const failures = []
const check = (name, ok, detail = '') => {
  if (!ok) failures.push(`${name}${detail ? ` — ${detail}` : ''}`)
  else console.log(`ok   ${name}`)
}

const img = container.querySelector('.album-flip__card.is-front img')
check('front card renders an image before the original arrives', Boolean(img))
check(
  'front card uses the Drive preview, not a placeholder',
  Boolean(img && img.getAttribute('src') === THUMB),
  img ? `src=${img.getAttribute('src')}` : 'no img',
)
check('no 载入中 placeholder while the original is pending', !container.textContent.includes('载入中'))
check('original still requested in the background', mediaRequests >= 1, `mediaRequests=${mediaRequests}`)
check('preview cached for the next render', peekDriveThumb('file-1') === THUMB, String(peekDriveThumb('file-1')))
check('readable title is displayed', container.textContent.includes('蒂法·侧身跪坐1'))

// Flipping must reuse the cached preview instead of refetching the original.
const before = thumbRequests
const next = container.querySelector('.album-flip__nav--next')
await act(async () => {
  next.dispatchEvent(new happy.Event('click', { bubbles: true }))
})
await settle()
const afterImg = container.querySelector('.album-flip__card.is-front img')
check('next card also shows a preview', Boolean(afterImg) && afterImg.getAttribute('src') === THUMB)
check('flip reuses preview cache', thumbRequests > before, `requests ${before} -> ${thumbRequests}`)
check('flip never shows 载入中', !container.textContent.includes('载入中'))

// Release the original bytes: the viewer must swap to the full-size image and
// keep handing the original blob to 「下载原图」.
for (const resolveMedia of pendingMedia.splice(0)) resolveMedia()
await settle()
const fullImg = container.querySelector('.album-flip__card.is-front img')
check('full-size image replaces the preview once it loads', Boolean(fullImg) && fullImg.getAttribute('src').startsWith('blob:'), fullImg ? fullImg.getAttribute('src') : 'no img')
check('download button appears only with the original blob', container.textContent.includes('下载原图'))
check('preview URL is not used as the download source', !container.innerHTML.includes(`href="${THUMB}"`))

await act(async () => {
  root.unmount()
})

if (failures.length) {
  console.error(`\nFAILED ${failures.length}/${failures.length + 6}`)
  for (const line of failures) console.error(` - ${line}`)
  process.exit(1)
}
console.log('\nalbum thumbnail viewer: all checks passed')
