import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { buildSync } from 'esbuild'

const outfile = join(mkdtempSync(join(tmpdir(), 'pg-album-hash-')), 'accountRoutes.mjs')
buildSync({
  entryPoints: ['src/utils/accountRoutes.ts'],
  outfile,
  bundle: true,
  platform: 'neutral',
  format: 'esm',
})

function installWindow() {
  const stack = [{ href: 'https://example.test/#/me/album', state: null }]
  const listeners = new Map()
  const location = {
    get href() {
      return stack[stack.length - 1].href
    },
    get hash() {
      return new URL(stack[stack.length - 1].href).hash
    },
  }
  const history = {
    get state() {
      return stack[stack.length - 1].state
    },
    pushState(state, _title, url) {
      const next = new URL(String(url), 'https://example.test')
      stack.push({ href: next.href, state })
      // Intentionally do not dispatch hashchange: this is what browsers do for pushState.
    },
    replaceState(state, _title, url) {
      const next = new URL(String(url), 'https://example.test')
      stack[stack.length - 1] = { href: next.href, state }
    },
    back() {
      if (stack.length < 2) return
      stack.pop()
      window.dispatchEvent(new Event('popstate'))
    },
  }
  const windowObj = {
    location,
    history,
    addEventListener(type, fn) {
      const list = listeners.get(type) || []
      list.push(fn)
      listeners.set(type, list)
    },
    removeEventListener(type, fn) {
      const list = listeners.get(type) || []
      listeners.set(type, list.filter((item) => item !== fn))
    },
    dispatchEvent(event) {
      const list = listeners.get(event.type) || []
      for (const fn of list) fn(event)
      return true
    },
  }
  globalThis.window = windowObj
  globalThis.history = history
  globalThis.location = location
  globalThis.HashChangeEvent = class HashChangeEvent extends Event {
    constructor(type) {
      super(type)
    }
  }
  return { stack, listeners }
}

const cases = []
const check = (name, got, expected) => {
  const ok = Object.is(got, expected) || JSON.stringify(got) === JSON.stringify(expected)
  cases.push({ name, ok, got, expected })
  if (!ok) console.error(`FAIL ${name}\n  got: ${JSON.stringify(got)}\n  expected: ${JSON.stringify(expected)}`)
}

const env = installWindow()
const mod = await import(pathToFileURL(outfile).href)
const {
  pushHash,
  replaceHash,
  albumHistoryState,
  albumLayerFromHistoryState,
  closeAlbumHashLayer,
  ensureHashNavigationEvents,
  resetHashNavigationEventsForTests,
  toAccountHash,
  parseAccountRoute,
} = mod

resetHashNavigationEventsForTests()
ensureHashNavigationEvents()

let hashEvents = 0
window.addEventListener('hashchange', () => {
  hashEvents += 1
})

history.pushState(null, '', '#/me/album?cat=demo')
check('raw pushState does not emit hashchange', hashEvents, 0)
check('raw pushState did change hash', window.location.hash, '#/me/album?cat=demo')

pushHash('#/me/album?cat=demo&folder=one', albumHistoryState('folder'))
check('pushHash dispatches hashchange', hashEvents, 1)
check('pushHash hash', window.location.hash, '#/me/album?cat=demo&folder=one')
check('pushHash records folder layer', albumLayerFromHistoryState(history.state), 'folder')

replaceHash('#/me/album?cat=demo&folder=one')
check('replaceHash same hash is a no-op', hashEvents, 1)

pushHash('#/me/album?cat=demo&folder=one&item=abc', albumHistoryState('item'))
check('push item hashchange', hashEvents, 2)
check('item layer', albumLayerFromHistoryState(history.state), 'item')

let fallbacks = 0
closeAlbumHashLayer({
  expected: 'item',
  fallback: () => {
    fallbacks += 1
  },
})
check('close item uses history.back', fallbacks, 0)
check('back after close item hash', window.location.hash, '#/me/album?cat=demo&folder=one')
check('back after close item fires hashchange via popstate hook', hashEvents, 3)
check('folder layer restored', albumLayerFromHistoryState(history.state), 'folder')

closeAlbumHashLayer({
  expected: 'folder',
  fallback: () => {
    fallbacks += 1
  },
})
check('close folder uses history.back', fallbacks, 0)
check('back to list hash', window.location.hash, '#/me/album?cat=demo')
check('back to list hashchange', hashEvents, 4)

replaceHash('#/me/album?cat=other')
check('replaceHash dispatches on change', hashEvents, 5)
check('replaceHash clears layer state', albumLayerFromHistoryState(history.state), null)

closeAlbumHashLayer({
  expected: 'folder',
  fallback: () => {
    fallbacks += 1
    replaceHash(toAccountHash({ view: 'album', cat: 'other', folderId: null, itemId: null }))
  },
})
check('deep link close uses fallback', fallbacks, 1)

check('album trash hash', toAccountHash({ view: 'album', bin: true }), '#/me/album?bin=1')
check(
  'album trash hash keeps item and drops live category',
  toAccountHash({ view: 'album', bin: true, itemId: 'abc', cat: '场景' }),
  '#/me/album?bin=1&item=abc',
)
check('parse album trash hash', parseAccountRoute('#/me/album?bin=1')?.bin, true)
check('parse live album hash has no bin', parseAccountRoute('#/me/album?cat=场景')?.bin, false)
check('parse live album keeps category', parseAccountRoute('#/me/album?cat=场景')?.cat, '场景')

const failed = cases.filter((c) => !c.ok)
console.log(`${cases.length - failed.length}/${cases.length} passed`)
if (failed.length) process.exit(1)
