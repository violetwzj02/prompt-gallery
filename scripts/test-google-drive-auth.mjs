import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { buildSync } from 'esbuild'

const outfile = join(mkdtempSync(join(tmpdir(), 'pg-drive-')), 'googleDrive.mjs')
buildSync({
  entryPoints: ['src/lib/googleDrive.ts'],
  outfile,
  bundle: true,
  platform: 'neutral',
  format: 'esm',
  define: {
    'import.meta.env.VITE_GOOGLE_CLIENT_ID': '"test-client.apps.googleusercontent.com"',
  },
})

function createMemoryStorage() {
  const store = new Map()
  return {
    getItem(key) {
      return store.has(key) ? store.get(key) : null
    },
    setItem(key, value) {
      store.set(key, String(value))
    },
    removeItem(key) {
      store.delete(key)
    },
  }
}

function createScript() {
  return {
    src: '',
    async: false,
    onload: null,
    onerror: null,
    readyState: 'loading',
    dataset: {},
    listeners: { load: [], error: [] },
    addEventListener(type, fn, opts) {
      if (!this.listeners[type]) this.listeners[type] = []
      this.listeners[type].push({ fn, once: Boolean(opts && opts.once) })
    },
    remove() {
      this.removed = true
    },
    removed: false,
    fire(type) {
      this.readyState = 'complete'
      if (type === 'load' && typeof this.onload === 'function') this.onload()
      if (type === 'error' && typeof this.onerror === 'function') this.onerror(new Error('script error'))
      const list = this.listeners[type] || []
      this.listeners[type] = list.filter((item) => {
        item.fn()
        return !item.once
      })
    },
  }
}

function installDom() {
  const scripts = []
  const head = {
    appendChild(node) {
      scripts.push(node)
      return node
    },
  }
  const document = {
    head,
    scripts,
    createElement(tag) {
      if (tag !== 'script') return { tagName: String(tag).toUpperCase() }
      return createScript()
    },
    querySelector(sel) {
      const match = /script\[src="([^"]+)"\]/.exec(sel)
      if (!match) return null
      return scripts.find((script) => script.src === match[1] && !script.removed) || null
    },
  }
  const windowObj = {
    document,
    google: undefined,
    setTimeout,
    clearTimeout,
  }
  globalThis.window = windowObj
  globalThis.document = document
  globalThis.sessionStorage = createMemoryStorage()
  return { window: windowObj, document, scripts }
}

function mockOauth(onRequest) {
  let config
  return {
    initTokenClient(next) {
      config = next
      return {
        requestAccessToken(override) {
          if (onRequest) onRequest(override, config)
        },
      }
    },
    get config() {
      return config
    },
  }
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function settled(promise, ms = 40) {
  return Promise.race([
    promise.then(
      (value) => ({ state: 'fulfilled', value }),
      (error) => ({ state: 'rejected', error: error instanceof Error ? error.message : String(error) }),
    ),
    wait(ms).then(() => ({ state: 'pending' })),
  ])
}

installDom()
const mod = await import(pathToFileURL(outfile).href)
const {
  GIS_SRC,
  DRIVE_NETWORK_ERROR,
  DRIVE_POPUP_INCOMPLETE_ERROR,
  DRIVE_AUTH_NOT_READY_ERROR,
  preloadDriveAuth,
  isDriveAuthReady,
  requestDriveAccess,
  getDriveUserEmail,
  setDriveAuthTimeoutsForTests,
  resetDriveAuthForTests,
  peekAccessToken,
} = mod

const cases = []
const check = (name, ok, detail = '') => {
  cases.push({ name, ok, detail })
  if (!ok) console.error(`FAIL ${name}${detail ? `\n  ${detail}` : ''}`)
}

async function withFresh(run) {
  resetDriveAuthForTests()
  const env = installDom()
  try {
    await run(env)
  } finally {
    resetDriveAuthForTests()
  }
}

await withFresh(async ({ window, document }) => {
  let calledInClick = null
  window.google = { accounts: { oauth2: mockOauth(() => { calledInClick = Boolean(globalThis.__inClick) }) } }
  await preloadDriveAuth()
  check('preload marks auth ready when GIS already present', isDriveAuthReady() === true)
  setDriveAuthTimeoutsForTests({ tokenMs: 30 })
  globalThis.__inClick = true
  const promise = requestDriveAccess('consent')
  const calledBeforeLeavingClick = calledInClick
  globalThis.__inClick = false
  check(
    'preloaded requestAccessToken runs in the same click stack',
    calledBeforeLeavingClick === true,
    `calledInClick=${calledBeforeLeavingClick}`,
  )
  const status = await settled(promise, 20)
  check('click-stack token request stays pending until callback', status.state === 'pending')
})

await withFresh(async ({ window }) => {
  let requested = false
  window.google = { accounts: { oauth2: mockOauth(() => { requested = true }) } }
  check('auth is not ready before preload', isDriveAuthReady() === false)
  const status = await settled(requestDriveAccess('consent'), 20)
  check(
    'requestDriveAccess rejects immediately when SDK is not ready',
    status.state === 'rejected' && status.error === DRIVE_AUTH_NOT_READY_ERROR && requested === false,
    `state=${status.state} error=${status.error} requested=${requested}`,
  )
})

await withFresh(async ({ document, scripts }) => {
  setDriveAuthTimeoutsForTests({ loadMs: 30 })
  const promise = preloadDriveAuth()
  check('hanging GIS injects a script', scripts.length === 1 && scripts[0].src === GIS_SRC)
  const status = await settled(promise, 80)
  check(
    'GIS script hang times out with a network error and removes the script',
    status.state === 'rejected' &&
      status.error === DRIVE_NETWORK_ERROR &&
      isDriveAuthReady() === false &&
      scripts[0].removed === true &&
      document.querySelector(`script[src="${GIS_SRC}"]`) == null,
    `state=${status.state} error=${status.error} removed=${scripts[0].removed}`,
  )
})

await withFresh(async ({ window, document, scripts }) => {
  const leftover = createScript()
  leftover.src = GIS_SRC
  leftover.readyState = 'complete'
  leftover.fire = leftover.fire
  scripts.push(leftover)
  setDriveAuthTimeoutsForTests({ loadMs: 200 })
  const promise = preloadDriveAuth()
  check('stale completed script without oauth2 is discarded', leftover.removed === true)
  check('retry injects a fresh GIS script', scripts.filter((script) => !script.removed).length === 1)
  const fresh = scripts.find((script) => !script.removed)
  window.google = { accounts: { oauth2: mockOauth(() => {}) } }
  fresh.fire('load')
  const status = await settled(promise, 40)
  check(
    'preload succeeds after discarding a stale GIS script',
    status.state === 'fulfilled' && isDriveAuthReady() === true && document.querySelector(`script[src="${GIS_SRC}"]`) === fresh,
    `state=${status.state}`,
  )
})

await withFresh(async ({ window, document, scripts }) => {
  setDriveAuthTimeoutsForTests({ loadMs: 30 })
  const first = preloadDriveAuth()
  scripts[0].fire('error')
  const firstStatus = await settled(first, 40)
  check(
    'GIS onerror rejects with the network error and removes the script',
    firstStatus.state === 'rejected' && firstStatus.error === DRIVE_NETWORK_ERROR && scripts[0].removed === true,
    `state=${firstStatus.state} error=${firstStatus.error}`,
  )
  setDriveAuthTimeoutsForTests({ loadMs: 200 })
  const second = preloadDriveAuth()
  const fresh = document.querySelector(`script[src="${GIS_SRC}"]`)
  check('second preload uses a new script tag', Boolean(fresh) && fresh !== scripts[0])
  window.google = { accounts: { oauth2: mockOauth(() => {}) } }
  fresh.fire('load')
  const secondStatus = await settled(second, 40)
  check(
    'retry after a failed GIS script can succeed',
    secondStatus.state === 'fulfilled' && isDriveAuthReady() === true,
    `state=${secondStatus.state}`,
  )
})

await withFresh(async ({ window }) => {
  setDriveAuthTimeoutsForTests({ tokenMs: 30 })
  window.google = { accounts: { oauth2: mockOauth(() => {}) } }
  await preloadDriveAuth()
  const first = requestDriveAccess('consent')
  const firstStatus = await settled(first, 80)
  check(
    'silent popup / missing callback times out and can be retried',
    firstStatus.state === 'rejected' && firstStatus.error === DRIVE_POPUP_INCOMPLETE_ERROR,
    `state=${firstStatus.state} error=${firstStatus.error}`,
  )
  let secondPrompt
  window.google = { accounts: { oauth2: mockOauth((override) => { secondPrompt = override.prompt }) } }
  resetDriveAuthForTests()
  setDriveAuthTimeoutsForTests({ tokenMs: 200 })
  window.google = { accounts: { oauth2: mockOauth((override, config) => {
    secondPrompt = override.prompt
    config.callback({ access_token: 'tok-retry', expires_in: 3600 })
  }) } }
  await preloadDriveAuth()
  const second = await settled(requestDriveAccess('consent'), 40)
  check(
    'retry after a token timeout can complete',
    second.state === 'fulfilled' && second.value === 'tok-retry' && secondPrompt === 'consent',
    `state=${second.state} value=${second.value} prompt=${secondPrompt}`,
  )
})

await withFresh(async ({ window }) => {
  window.google = { accounts: { oauth2: mockOauth((_override, config) => {
    config.error_callback({ type: 'popup_failed', message: 'blocked' })
  }) } }
  await preloadDriveAuth()
  const status = await settled(requestDriveAccess('consent'), 40)
  check(
    'popup_failed error_callback uses the incomplete-popup message and does not hang',
    status.state === 'rejected' && status.error === DRIVE_POPUP_INCOMPLETE_ERROR,
    `state=${status.state} error=${status.error}`,
  )
  window.google = { accounts: { oauth2: mockOauth((_override, config) => {
    config.callback({ access_token: 'tok-after-popup', expires_in: 3600 })
  }) } }
  resetDriveAuthForTests()
  window.google = { accounts: { oauth2: mockOauth((_override, config) => {
    config.callback({ access_token: 'tok-after-popup', expires_in: 3600 })
  }) } }
  await preloadDriveAuth()
  const retry = await settled(requestDriveAccess('consent'), 40)
  check(
    'retry after popup_failed can succeed',
    retry.state === 'fulfilled' && retry.value === 'tok-after-popup',
    `state=${retry.state} value=${retry.value}`,
  )
})

await withFresh(async ({ window }) => {
  window.google = { accounts: { oauth2: mockOauth((_override, config) => {
    config.callback({ access_token: 'tok-1', expires_in: 3600 })
  }) } }
  await preloadDriveAuth()
  const status = await settled(requestDriveAccess('consent'), 40)
  check(
    'happy path callback resolves the access token',
    status.state === 'fulfilled' && status.value === 'tok-1' && peekAccessToken() === 'tok-1',
    `state=${status.state} value=${status.value} peek=${peekAccessToken()}`,
  )
})

await withFresh(async ({ window }) => {
  setDriveAuthTimeoutsForTests({ apiMs: 30 })
  window.google = { accounts: { oauth2: mockOauth(() => {}) } }
  await preloadDriveAuth()
  const previousFetch = globalThis.fetch
  globalThis.fetch = (_url, init) => new Promise((_, reject) => {
    const abort = () => {
      const error = new Error('The operation was aborted')
      error.name = 'AbortError'
      reject(error)
    }
    if (init?.signal?.aborted) {
      abort()
      return
    }
    init?.signal?.addEventListener('abort', abort, { once: true })
  })
  try {
    const status = await settled(getDriveUserEmail('tok-1'), 80)
    check(
      'Drive API hang times out with the network error',
      status.state === 'rejected' && status.error === DRIVE_NETWORK_ERROR,
      `state=${status.state} error=${status.error}`,
    )
  } finally {
    globalThis.fetch = previousFetch
  }
})

await withFresh(async ({ window }) => {
  setDriveAuthTimeoutsForTests({ tokenMs: 30 })
  window.google = { accounts: { oauth2: mockOauth((_override, config) => {
    setTimeout(() => {
      config.callback({ access_token: 'late-token', expires_in: 3600 })
    }, 50)
  }) } }
  await preloadDriveAuth()
  const status = await settled(requestDriveAccess('consent'), 80)
  await wait(40)
  check(
    'late callback after timeout still persists the token for the next click',
    status.state === 'rejected' &&
      status.error === DRIVE_POPUP_INCOMPLETE_ERROR &&
      peekAccessToken() === 'late-token',
    `state=${status.state} error=${status.error} peek=${peekAccessToken()}`,
  )
})

const failed = cases.filter((item) => !item.ok)
console.log(`${cases.length - failed.length}/${cases.length} passed`)
if (failed.length) process.exit(1)
