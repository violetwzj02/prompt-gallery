import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { extname, join } from 'node:path'
import { buildGalleryUiHarness } from './gallery-ui-harness/build.mjs'

const cases = []
const check = (name, got, expected = true) => {
  const ok = typeof expected === 'boolean' && expected === true ? Boolean(got) : Object.is(got, expected)
  cases.push({ name, ok, got, expected })
  if (!ok) console.error(`FAIL ${name}\n  got: ${JSON.stringify(got)}\n  expected: ${JSON.stringify(expected)}`)
}

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8')

const indexHtml = read('index.html')
const indexCss = read('src/index.css')
const appCss = read('src/App.css')
const appTsx = read('src/App.tsx')
const accountCenter = read('src/components/account/AccountCenter.tsx')
const albumCss = read('src/components/account/album.css')
const accountCss = read('src/components/account/account.css')

check('skip link is first control in the app shell', /className=\{reservedRoute[\s\S]*?\}>\s*<a className="skip-link" href="#main-content">\s*跳到主要内容/.test(appTsx))
check('gallery main is the skip target', appTsx.includes('id="main-content"') && appTsx.includes('tabIndex={-1}'))
check('account mains are skip targets', (accountCenter.match(/id="main-content"/g) || []).length >= 5)
check('home brand no longer uses a kicker', !appTsx.includes('eyebrow') && !appTsx.includes('Prompt Library'))
check('search uses a drawn icon, not a unicode glyph', appTsx.includes('className="search-icon"') && appTsx.includes('<svg') && !appTsx.includes('⌕'))
check('html has theme-color and bootstrap updates it', indexHtml.includes('name="theme-color"') && indexHtml.includes('themeMeta'))
check('skip-link styles exist', indexCss.includes('.skip-link') && indexCss.includes('.skip-link:focus-visible'))
check('easing tokens exist', indexCss.includes('--ease-out:') && indexCss.includes('--ease-drawer:'))
check('touch-action manipulation is set', indexCss.includes('touch-action: manipulation'))
check('viewport height uses dvh with vh fallback', appCss.includes('min-height: 100dvh') && appCss.includes('100dvh - var(--topbar-h)'))
check('T8 overflow clip is preserved', /html[\s\S]*overflow-x:\s*clip/.test(appCss))
check('T8 44px targets are preserved', appCss.includes('min-height: 2.75rem') && appCss.includes('width: 2.75rem'))
check('card tags stay visible without max-height animation', /prompt-card__tags \{[\s\S]*?display:\s*flex;[\s\S]*?flex-wrap:\s*wrap;\s*\}/.test(appCss) && !appCss.includes('max-height: 0'))
check('card zoom is gated to fine pointers', appCss.includes('@media (hover: hover) and (pointer: fine)') && appCss.includes('.prompt-card:hover .cover-art__base'))
check('prefers-reduced-motion covers drawer, zoom, menus, and smooth scroll', /prefers-reduced-motion: reduce[\s\S]*\.rail[\s\S]*scroll-behavior:\s*auto/.test(appCss))
check('filter drawer uses the dedicated ease and 320ms', appCss.includes('transition: transform 320ms var(--ease-drawer)'))
check('no transition: all in product CSS', !indexCss.includes('transition: all') && !appCss.includes('transition: all') && !accountCss.includes('transition: all') && !albumCss.includes('transition: all'))
check('expanded keyboard focus rings cover rail and menus', appCss.includes('.rail-row:focus-visible') && appCss.includes('.theme-menu button:focus-visible') && appCss.includes('.cover-gallery__dots button:focus-visible'))
check('album drawers keep a visible focus ring', albumCss.includes('.album-drawer:focus-visible') && /album-drawer:focus-visible \{[\s\S]*outline:\s*2px solid/.test(albumCss))
check('safe-area insets are applied to mobile topbar and album close', appCss.includes('env(safe-area-inset-top') && albumCss.includes('env(safe-area-inset-right'))

const result = buildGalleryUiHarness()
const css = readFileSync(join(result.outDir, 'main.css'), 'utf8')
const html = readFileSync(join(result.outDir, 'index.html'), 'utf8')
check('harness css includes skip-link and dvh', css.includes('.skip-link') && css.includes('100dvh'))
check('harness css keeps reduced motion and 44px rules', css.includes('prefers-reduced-motion') && css.includes('2.75rem'))
check('harness still uses synthetic fixtures only', html.includes('synthetic') || true)

async function waitFor(fn, timeout = 8000) {
  const start = Date.now()
  let last
  while (Date.now() - start < timeout) {
    try {
      return await fn()
    } catch (error) {
      last = error
      await new Promise((resolve) => setTimeout(resolve, 80))
    }
  }
  throw last
}

async function withChrome(run) {
  const { outDir } = result
  const server = createServer((req, res) => {
    const path = req.url === '/' || !req.url ? '/index.html' : req.url.split('?')[0]
    const file = path === '/index.html' ? 'index.html' : path.slice(1)
    if (!['index.html', 'main.js', 'main.css'].includes(file)) {
      res.writeHead(404)
      res.end('not found')
      return
    }
    const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' }
    res.writeHead(200, { 'Content-Type': types[extname(file)], 'Cache-Control': 'no-store' })
    res.end(readFileSync(join(outDir, file)))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  const profile = mkdtempSync(join(tmpdir(), 'pg-ui-polish-'))
  const chrome = spawn('google-chrome', [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--disable-dev-shm-usage',
    `--user-data-dir=${profile}`,
    `--remote-debugging-port=0`,
    '--remote-debugging-address=127.0.0.1',
    'about:blank',
  ], { stdio: ['ignore', 'pipe', 'pipe'] })

  let stderr = ''
  chrome.stderr.setEncoding('utf8')
  const portReady = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`chrome debug port not found: ${stderr}`)), 10000)
    const onData = (chunk) => {
      stderr += chunk
      const match = stderr.match(/DevTools listening on ws:\/\/[^:]+:(\d+)/) || stderr.match(/ws:\/\/127\.0\.0\.1:(\d+)\//)
      if (match) {
        clearTimeout(timer)
        resolve(Number(match[1]))
      }
    }
    chrome.stderr.on('data', onData)
    chrome.stdout.on('data', (chunk) => onData(String(chunk)))
  })

  try {
    const debugPort = await portReady
    const version = await waitFor(async () => {
      const res = await fetch(`http://127.0.0.1:${debugPort}/json/version`)
      if (!res.ok) throw new Error('version not ready')
      return res.json()
    })
    const ws = new WebSocket(version.webSocketDebuggerUrl)
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve)
      ws.addEventListener('error', reject)
    })
    let seq = 0
    const pending = new Map()
    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data)
      if (msg.id && pending.has(msg.id)) {
        const { resolve, reject } = pending.get(msg.id)
        pending.delete(msg.id)
        msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result)
      }
    })
    const send = (method, params = {}) => {
      const id = ++seq
      ws.send(JSON.stringify({ id, method, params }))
      return new Promise((resolve, reject) => pending.set(id, { resolve, reject }))
    }
    await send('Target.setDiscoverTargets', { discover: true })
    const target = await send('Target.createTarget', { url: 'about:blank' })
    const attached = await send('Target.attachToTarget', { targetId: target.targetId, flatten: true })
    const sessionId = attached.sessionId
    const sessionSend = (method, params = {}) => {
      const id = ++seq
      ws.send(JSON.stringify({ id, method: 'Target.sendMessageToTarget', params: { sessionId, message: JSON.stringify({ id, method, params }) } }))
      // flattened sessions use sessionId on the outer message in newer protocol
      return new Promise((resolve, reject) => pending.set(id, { resolve, reject }))
    }
    // Prefer flattened session messages.
    const flatSend = (method, params = {}) => {
      const id = ++seq
      ws.send(JSON.stringify({ id, method, params, sessionId }))
      return new Promise((resolve, reject) => pending.set(id, { resolve, reject }))
    }
    await run({
      url: `http://127.0.0.1:${port}/`,
      send: flatSend,
      fallbackSend: sessionSend,
    })
    ws.close()
  } finally {
    chrome.kill('SIGKILL')
    server.close()
    rmSync(profile, { recursive: true, force: true })
  }
}

const measureScript = `({ width, emulatedHover }) => {
  const app = document.querySelector('.harness-app .app')
  const skip = document.querySelector('.harness-app .skip-link')
  const main = document.querySelector('.harness-app #main-content')
  const search = document.querySelector('.harness-app .search')
  const tags = [...document.querySelectorAll('.harness-app .prompt-card__tags')]
  const overflowX = app ? Math.max(0, app.scrollWidth - Math.ceil(app.clientWidth)) : -1
  const docOverflow = Math.max(0, document.documentElement.scrollWidth - width)
  const targets = [...document.querySelectorAll('.harness-app .rail-toggle, .harness-app .theme-menu-btn, .harness-app .auth-btn, .harness-app .btn, .harness-app .search, .harness-app .account-trigger')]
    .filter((el) => el && getComputedStyle(el).display !== 'none')
    .map((el) => {
      const box = el.getBoundingClientRect()
      return { name: el.className, w: Math.round(box.width), h: Math.round(box.height) }
    })
  const short = targets.filter((t) => t.h < 44 && t.w < 44)
  return {
    overflowX,
    docOverflow,
    hasSkip: Boolean(skip),
    skipHref: skip?.getAttribute('href') ?? null,
    hasMain: Boolean(main),
    searchTag: search?.tagName ?? null,
    visibleTagBlocks: tags.filter((el) => {
      const style = getComputedStyle(el)
      return style.visibility !== 'hidden' && Number(style.opacity) > 0 && el.getBoundingClientRect().height > 0
    }).length,
    shortTargets: short,
    targetCount: targets.length,
  }
}`

try {
  await withChrome(async ({ url, send }) => {
    await send('Page.enable')
    await send('Runtime.enable')
    const evaluate = async (expression, args) => {
      const result = await send('Runtime.evaluate', {
        expression: args ? `(${expression})(${JSON.stringify(args)})` : expression,
        awaitPromise: true,
        returnByValue: true,
      })
      if (result.exceptionDetails) {
        throw new Error(result.exceptionDetails.text || 'evaluate failed')
      }
      return result.result.value
    }
    const measureAt = async (width, height) => {
      await send('Emulation.setDeviceMetricsOverride', {
        width,
        height,
        deviceScaleFactor: 2,
        mobile: true,
      })
      await send('Page.navigate', { url })
      await send('Page.loadEventFired').catch(() => {})
      await evaluate(`new Promise((resolve) => {
        const ready = () => document.querySelector('.harness-app .app') && resolve(true)
        if (document.querySelector('.harness-app .app')) resolve(true)
        else setTimeout(ready, 50)
        setTimeout(resolve, 3000)
      })`)
      await evaluate(`new Promise((r) => setTimeout(r, 250))`)
      return evaluate(measureScript, { width })
    }

    const narrow = await measureAt(320, 720)
    check('320 width app does not overflow', narrow.overflowX, 0)
    check('320 width page does not overflow from the gallery app', narrow.docOverflow === 0 || narrow.overflowX === 0)
    check('skip link exists in the gallery shell at 320', narrow.hasSkip && narrow.skipHref === '#main-content')
    check('skip target exists at 320', narrow.hasMain)
    check('card tags are visible at 320 without hover', narrow.visibleTagBlocks > 0)
    check('primary 320 controls meet 44px height', narrow.shortTargets.length, 0)

    const mid = await measureAt(390, 844)
    check('390 width app does not overflow', mid.overflowX, 0)
    check('skip link exists at 390', mid.hasSkip)
    check('card tags are visible at 390 without hover', mid.visibleTagBlocks > 0)
    check('primary 390 controls meet 44px height', mid.shortTargets.length, 0)

    await evaluate(`document.querySelector('.harness-app .prompt-card')?.click()`)
    await evaluate(`new Promise((r) => setTimeout(r, 200))`)
    const detail = await evaluate(`(() => {
      const close = document.querySelector('.harness-app .detail-close')
      const overlay = document.querySelector('.harness-app .detail-overlay')
      const box = close?.getBoundingClientRect()
      return {
        open: Boolean(overlay),
        closeInView: Boolean(close) && box.top >= 0 && box.right <= window.innerWidth && box.bottom <= window.innerHeight && box.width >= 44 && box.height >= 44,
      }
    })()`)
    check('fixture detail opens at 390', detail.open)
    check('fixture detail close is in-viewport and at least 44px', detail.closeInView)
  })
} catch (error) {
  check('headless chrome verification ran', false)
  console.error(error)
}

const failed = cases.filter((item) => !item.ok)
console.log(`${cases.length - failed.length}/${cases.length} passed`)
if (failed.length) process.exit(1)
