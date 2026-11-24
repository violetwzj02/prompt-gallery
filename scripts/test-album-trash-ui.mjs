import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createElement, useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { Window } from 'happy-dom'
import { buildSync } from 'esbuild'

const cacheDir = join(process.cwd(), 'node_modules', '.cache')
mkdirSync(cacheDir, { recursive: true })
const outfile = join(cacheDir, 'pg-album-trash-ui.mjs')
buildSync({
  entryPoints: ['scripts/album-trash-ui-entry.ts'],
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

const {
  CloudAlbum,
  parseAccountRoute,
  ensureHashNavigationEvents,
  resetHashNavigationEventsForTests,
  setDriveImageBlobFetcher,
  validateAlbumCategoryName,
  createAlbumTrashMemory,
  PARTIAL_FAIL_FIXTURE,
  ALBUM_CANNOT_RESTORE_PURGED,
} = await import(pathToFileURL(outfile).href)

const cases = []
const check = (name, got, expected = true) => {
  const ok = typeof expected === 'boolean' && expected === true ? Boolean(got) : Object.is(got, expected)
  cases.push({ name, ok, got, expected })
  if (!ok) console.error(`FAIL ${name}\n  got: ${JSON.stringify(got)}\n  expected: ${JSON.stringify(expected)}`)
}

check('回收站 is a reserved category name', validateAlbumCategoryName('回收站').ok, false)

function liveItem(overrides = {}) {
  return {
    id: 'live-1',
    ownerId: 'user-1',
    driveFileId: 'file-live-1',
    title: '湖畔晨雾',
    source: 'upload',
    promptId: null,
    mimeType: 'image/png',
    sizeBytes: 16,
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

const happy = new Window({ url: 'https://example.test/#/me/album' })
globalThis.window = happy
globalThis.document = happy.document
globalThis.HTMLElement = happy.HTMLElement
globalThis.Node = happy.Node
globalThis.history = happy.history
globalThis.location = happy.location
globalThis.HashChangeEvent = happy.HashChangeEvent
globalThis.IS_REACT_ACT_ENVIRONMENT = true
globalThis.fetch = async (url) => {
  const href = String(url)
  if (/quyi-cards|quyi-meta|covers\/entries|prompts\.json/i.test(href)) {
    return new Response('blocked', { status: 404, statusText: 'Not Found' })
  }
  return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } })
}
setDriveImageBlobFetcher(async () => new Blob(['color'], { type: 'image/png' }))
resetHashNavigationEventsForTests()
ensureHashNavigationEvents()

function MockAlbumHost({
  confirm,
  initialItems,
  initialTrash = [],
  trashSchemaMissing = false,
  accessToken = 'tok',
  mutations,
  purgeImpl,
}) {
  const [items, setItems] = useState(initialItems)
  const [trashItems, setTrashItems] = useState(initialTrash)
  const [hash, setHash] = useState(window.location.hash || '#/me/album')
  const itemsRef = useRef(items)
  const trashRef = useRef(trashItems)
  itemsRef.current = items
  trashRef.current = trashItems
  useEffect(() => {
    const onHash = () => setHash(window.location.hash)
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  const album = useMemo(
    () => ({
      settings: {
        driveRootFolderId: 'root',
        connectedGoogleEmail: 'tester@example.com',
        updatedAt: null,
        updatedBy: null,
      },
      categories: [],
      items,
      trashItems,
      loading: false,
      error: null,
      schemaMissing: false,
      trashSchemaMissing,
      reload: async () => {},
      connectSettings: async (input) => input,
      addCategory: async () => {
        throw new Error('not used')
      },
      editCategory: async () => {
        throw new Error('not used')
      },
      removeCategory: async () => {},
      addItem: async () => {
        throw new Error('not used')
      },
      editItem: async () => {
        throw new Error('not used')
      },
      softDeleteItem: async (id) => {
        mutations.push(['softDelete', id])
        const found = itemsRef.current.find((item) => item.id === id)
        if (!found) throw new Error('missing')
        const updated = { ...found, deletedAt: '2026-11-24T06:00:00.000Z' }
        setItems((list) => list.filter((item) => item.id !== id))
        setTrashItems((list) => [updated, ...list])
        return updated
      },
      restoreItem: async (id) => {
        mutations.push(['restore', id])
        const found = trashRef.current.find((item) => item.id === id)
        if (!found) throw new Error('missing')
        const updated = { ...found, deletedAt: null, purgeStatus: 'idle', purgeError: null }
        setTrashItems((list) => list.filter((item) => item.id !== id))
        setItems((list) => [updated, ...list])
        return updated
      },
      purgeItem: async (id, token) => {
        mutations.push(['purge', id, token])
        if (purgeImpl) return purgeImpl(id, token)
        setTrashItems((list) => list.filter((item) => item.id !== id))
        return { ok: true, id }
      },
      purgeItems: async (ids, token) => {
        mutations.push(['purgeItems', [...ids], token])
        if (purgeImpl) {
          const results = []
          for (const id of ids) results.push(await purgeImpl(id, token))
          const succeeded = results.filter((result) => result.ok).length
          return { ok: results.every((result) => result.ok), results, succeeded, failed: results.length - succeeded }
        }
        setTrashItems((list) => list.filter((item) => !ids.includes(item.id)))
        return { ok: true, results: ids.map((id) => ({ ok: true, id })), succeeded: ids.length, failed: 0 }
      },
    }),
    [items, trashItems, trashSchemaMissing, mutations, purgeImpl],
  )
  const route = parseAccountRoute(hash) ?? {
    view: 'album',
    tab: 'works',
    itemId: null,
    folderId: null,
    cat: null,
    bin: false,
  }
  return createElement(CloudAlbum, {
    route,
    test: { album, confirm, accessToken, googleEnabled: true },
  })
}

const rootNode = document.createElement('div')
document.body.appendChild(rootNode)
const root = createRoot(rootNode)

async function flush() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

function chipCount(label) {
  const button = [...rootNode.querySelectorAll('.album-chip')].find((node) => {
    const text = node.textContent.replace(/\s+/g, ' ').trim()
    return text.startsWith(label)
  })
  const span = button?.querySelector('span')
  return span ? Number(span.textContent.trim()) : null
}

let hostKey = 0
async function renderHost(props) {
  hostKey += 1
  window.location.hash = props.hash || '#/me/album'
  await act(async () => {
    root.render(createElement(MockAlbumHost, { key: String(hostKey), ...props }))
  })
  await flush()
}

const mutations = []
await renderHost({
  confirm: () => true,
  initialItems: [liveItem(), liveItem({ id: 'live-2', title: '山谷午后', driveFileId: 'file-live-2' })],
  mutations,
})
check('live count shows both items', chipCount('全部'), 2)
check('trash starts empty', chipCount('回收站'), 0)

const firstCard = rootNode.querySelector('.album-card')
await act(async () => {
  firstCard.click()
})
await flush()
const deleteBtn = [...rootNode.querySelectorAll('button')].find((btn) => btn.textContent.trim() === '删除图片')
check('live detail has delete action', Boolean(deleteBtn))
await act(async () => {
  deleteBtn.click()
})
await flush()
check('soft delete mutation ran', mutations[0]?.[0], 'softDelete')
check('after soft delete live count is 1', chipCount('全部'), 1)
check('after soft delete trash count is 1', chipCount('回收站'), 1)

const trashChip = [...rootNode.querySelectorAll('button')].find((btn) => btn.textContent.includes('回收站'))
await act(async () => {
  trashChip.click()
})
await flush()
check('opening trash uses bin route', window.location.hash.includes('bin=1'))
const trashCard = rootNode.querySelector('.album-card')
await act(async () => {
  trashCard?.click()
})
await flush()
const restoreBtn = [...rootNode.querySelectorAll('button')].find((btn) => btn.textContent.trim() === '恢复')
check('trash detail has restore', Boolean(restoreBtn))
await act(async () => {
  restoreBtn.click()
})
await flush()
check('restore mutation ran', mutations.some((entry) => entry[0] === 'restore'))
check('after restore live count is 2', chipCount('全部'), 2)
check('after restore trash count is 0', chipCount('回收站'), 0)

// confirm cancel: zero mutation
mutations.length = 0
window.location.hash = '#/me/album'
await renderHost({
  confirm: () => false,
  initialItems: [liveItem()],
  mutations,
})
const card = rootNode.querySelector('.album-card')
await act(async () => {
  card.click()
})
await flush()
const deleteAgain = [...rootNode.querySelectorAll('button')].find((btn) => btn.textContent.trim() === '删除图片')
await act(async () => {
  deleteAgain.click()
})
await flush()
check('canceling confirm performs zero mutations', mutations.length, 0)
check('canceling confirm leaves the live count unchanged', chipCount('全部'), 1)

// schema missing disables actions
await renderHost({
  confirm: () => true,
  initialItems: [liveItem()],
  trashSchemaMissing: true,
  mutations,
})
const disabledDelete = [...rootNode.querySelectorAll('button')].find((btn) => btn.textContent.trim() === '删除图片')
const disabledTrash = [...rootNode.querySelectorAll('button')].find((btn) => btn.textContent.includes('回收站'))
check('schema missing copy is shown', rootNode.textContent.includes('回收站功能尚未就绪'))
check('schema missing disables trash chip', disabledTrash?.disabled, true)
await act(async () => {
  rootNode.querySelector('.album-card').click()
})
const disabledLiveDelete = [...rootNode.querySelectorAll('button')].find((btn) => btn.textContent.trim() === '删除图片')
check('schema missing disables live delete', disabledLiveDelete?.disabled, true)
mutations.length = 0
await act(async () => {
  disabledLiveDelete?.click()
})
check('disabled delete does not mutate', mutations.length, 0)

// last flip-book item delete returns
mutations.length = 0
window.location.hash = '#/me/album?cat=18%2B&folder=%E6%B5%8B%E8%AF%95%E8%A7%92%E8%89%B2&item=last-1'
await renderHost({
  hash: '#/me/album?cat=18%2B&folder=%E6%B5%8B%E8%AF%95%E8%A7%92%E8%89%B2&item=last-1',
  confirm: () => true,
  initialItems: [
    liveItem({
      id: 'last-1',
      title: '最后一张',
      autoCategories: ['18+'],
      customCategories: ['测试角色'],
    }),
  ],
  mutations,
})
const lastDelete = [...rootNode.querySelectorAll('button')].find((btn) => btn.textContent.trim() === '删除图片')
check('last flip item detail is open', Boolean(lastDelete))
await act(async () => {
  lastDelete.click()
})
await flush()
check('last flip item was soft-deleted', mutations[0]?.[1], 'last-1')
check(
  'last flip item delete returns to the list',
  !window.location.hash.includes('item=last-1') && !window.location.hash.includes('folder='),
)
check('last flip item delete keeps the 18+ category', window.location.hash.includes('cat='), true)


function StoreHost({ box, confirm, schemaMissing = false }) {
  const [, bump] = useState(0)
  box.setter = bump
  const snap = box.store.snapshot()
  const [hash, setHash] = useState(window.location.hash || '#/me/album')
  useEffect(() => {
    const onHash = () => setHash(window.location.hash)
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  const album = useMemo(
    () => ({
      settings: {
        driveRootFolderId: 'root',
        connectedGoogleEmail: 'tester@example.com',
        updatedAt: null,
        updatedBy: null,
      },
      categories: [],
      items: snap.live,
      trashItems: snap.trash,
      loading: false,
      error: null,
      schemaMissing: false,
      trashSchemaMissing: schemaMissing,
      reload: async () => {},
      connectSettings: async (input) => input,
      addCategory: async () => {
        throw new Error('not used')
      },
      editCategory: async () => {
        throw new Error('not used')
      },
      removeCategory: async () => {},
      addItem: async () => {
        throw new Error('not used')
      },
      editItem: async (id, patch) => box.store.deps.updateItem(id, patch),
      softDeleteItem: async (id) => box.store.softDelete(id),
      restoreItem: async (id) => box.store.restore(id),
      purgeItem: async (id, token) => box.store.purge(id, token),
      purgeItems: async (ids, token) => box.store.purgeMany(ids, token),
    }),
    [box, snap.live, snap.trash, schemaMissing],
  )
  const route = parseAccountRoute(hash) ?? {
    view: 'album',
    tab: 'works',
    itemId: null,
    folderId: null,
    cat: null,
    bin: false,
  }
  return createElement(CloudAlbum, {
    route,
    test: { album, confirm, accessToken: 'tok', googleEnabled: true },
  })
}

function createStoreBox() {
  const box = { setter: null, store: null }
  box.store = createAlbumTrashMemory({
    onChange: () => box.setter?.((value) => value + 1),
  })
  return box
}

async function renderStore(props) {
  hostKey += 1
  window.location.hash = props.hash || '#/me/album'
  await act(async () => {
    root.render(createElement(StoreHost, { key: String(hostKey), ...props }))
  })
  await flush()
}

const box = createStoreBox()
box.store.reset({ fixture: 'partial' })
const confirms = []
await renderStore({
  box,
  hash: '#/me/album?bin=1',
  confirm: (message) => {
    confirms.push(message)
    return false
  },
})
check('partial fixture live count stays on the live catalog', chipCount('全部'), 3)
check('partial fixture trash count is 3', chipCount('回收站'), 3)
const emptyBtn = [...rootNode.querySelectorAll('button')].find((btn) => btn.textContent.trim() === '清空回收站')
check('empty trash action is available in the bin', Boolean(emptyBtn))
const beforeCancel = box.store.snapshot().counters
await act(async () => {
  emptyBtn.click()
})
await flush()
check('empty-trash confirm mentions permanent Drive deletion', confirms[0]?.includes('原文件将从谷歌云盘永久删除'))
check('canceling empty trash does not mutate', box.store.snapshot().counters.mutations, beforeCancel.mutations)
check('canceling empty trash does not call Drive', box.store.snapshot().counters.driveAttempts, beforeCancel.driveAttempts)
check('canceling empty trash leaves 3 items', box.store.snapshot().trash.length, 3)

confirms.length = 0
await renderStore({
  box,
  hash: '#/me/album?bin=1',
  confirm: (message) => {
    confirms.push(message)
    return true
  },
})
const emptyNow = [...rootNode.querySelectorAll('button')].find((btn) => btn.textContent.trim() === '清空回收站')
await act(async () => {
  emptyNow.click()
})
await flush()
const afterPartial = box.store.snapshot()
check('partial empty reports mixed results in the album', rootNode.textContent.includes('已永久删除 1 项，2 项失败'))
check('partial empty keeps two trash rows', afterPartial.trash.length, 2)
check('partial empty Drive attempts are 3', afterPartial.counters.driveAttempts, 3)
check('partial empty Drive successes are 2', afterPartial.counters.driveSuccesses, 2)
check('partial empty metadata successes are 1', afterPartial.counters.metadataSuccesses, 1)
check(
  'drive-fail row remains failed',
  afterPartial.trash.find((item) => item.id === PARTIAL_FAIL_FIXTURE.driveFail.id)?.purgeStatus,
  'failed',
)
check(
  'db-cleanup row remains drive_purged',
  afterPartial.trash.find((item) => item.id === PARTIAL_FAIL_FIXTURE.dbCleanupFail.id)?.purgeStatus,
  'drive_purged',
)

const dbCard = [...rootNode.querySelectorAll('.album-card')].find((node) =>
  node.textContent.includes('模拟记录清理失败的练习图'),
)
await act(async () => {
  dbCard.click()
})
await flush()
const restorePurged = [...rootNode.querySelectorAll('button')].find((btn) => btn.textContent.trim() === '恢复')
await act(async () => {
  restorePurged.click()
})
await flush()
check('restoring a drive_purged item shows the real executor error', rootNode.textContent.includes(ALBUM_CANNOT_RESTORE_PURGED))
check(
  'restoring a drive_purged item keeps the row',
  box.store.snapshot().trash.some((item) => item.id === PARTIAL_FAIL_FIXTURE.dbCleanupFail.id),
)

const beforeRetry = box.store.snapshot().counters
const closeBtn = rootNode.querySelector('.album-lightbox__close, .album-viewer__close, [aria-label="关闭"]')
if (closeBtn) {
  await act(async () => {
    closeBtn.click()
  })
  await flush()
}
const emptyRetry = [...rootNode.querySelectorAll('button')].find((btn) => btn.textContent.trim() === '清空回收站')
await act(async () => {
  emptyRetry.click()
})
await flush()
const afterRetry = box.store.snapshot()
check('retry empty succeeds in the album', rootNode.textContent.includes('回收站已清空') || afterRetry.trash.length === 0)
check('retry only adds one Drive attempt', afterRetry.counters.driveAttempts - beforeRetry.driveAttempts, 1)
check('retry only adds one Drive success', afterRetry.counters.driveSuccesses - beforeRetry.driveSuccesses, 1)
check('retry adds two metadata successes', afterRetry.counters.metadataSuccesses - beforeRetry.metadataSuccesses, 2)
check('retry leaves trash empty', afterRetry.trash.length, 0)
check('retry live count stays at the original three live items', chipCount('全部'), 3)

await act(async () => {
  root.unmount()
})

const failed = cases.filter((item) => !item.ok)
console.log(`${cases.length - failed.length}/${cases.length} passed`)
if (failed.length) process.exit(1)
