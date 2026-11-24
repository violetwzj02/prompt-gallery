import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createElement, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { Window } from 'happy-dom'
import { buildSync } from 'esbuild'

const cacheDir = join(process.cwd(), 'node_modules', '.cache')
mkdirSync(cacheDir, { recursive: true })
const outfile = join(cacheDir, 'pg-dialog-chrome.mjs')
buildSync({
  entryPoints: ['scripts/ui-chrome-test-entry.ts'],
  outfile,
  bundle: true,
  platform: 'browser',
  format: 'esm',
  external: ['react', 'react-dom', 'react/jsx-runtime'],
})

const { lockBodyScroll, getBodyScrollLockCount, getLockedScrollY, useDialogChrome, useEscapeLayer } = await import(
  pathToFileURL(outfile).href
)

const cases = []
const check = (name, got, expected = true) => {
  const ok = typeof expected === 'boolean' && expected === true ? Boolean(got) : Object.is(got, expected)
  cases.push({ name, ok, got, expected })
  if (!ok) console.error(`FAIL ${name}\n  got: ${JSON.stringify(got)}\n  expected: ${JSON.stringify(expected)}`)
}

const happy = new Window({ url: 'https://example.test/gallery-ui' })
globalThis.window = happy
globalThis.document = happy.document
globalThis.HTMLElement = happy.HTMLElement
globalThis.Node = happy.Node
globalThis.IS_REACT_ACT_ENVIRONMENT = true
window.scrollTo(0, 240)
if (window.scrollY !== 240) {
  Object.defineProperty(window, 'scrollY', { configurable: true, get: () => window.pageYOffset || 240 })
}

const first = lockBodyScroll()
check('first lock increments', getBodyScrollLockCount(), 1)
check('body overflow is hidden', document.body.style.overflow, 'hidden')
check('html overflow is hidden', document.documentElement.style.overflow, 'hidden')
check('html overlay lock class is set', document.documentElement.classList.contains('is-overlay-locked'))
check('body is fixed to preserve scroll', document.body.style.position, 'fixed')
check('body top records scroll', document.body.style.top, '-240px')
const second = lockBodyScroll()
check('nested lock stays at 2', getBodyScrollLockCount(), 2)
second()
check('partial unlock still locked', getBodyScrollLockCount(), 1)
check('overflow still hidden after one unlock', document.body.style.overflow, 'hidden')
let restoredY = null
const origScrollTo = window.scrollTo.bind(window)
window.scrollTo = (...args) => {
  restoredY = typeof args[0] === 'number' ? args[1] : args[0]?.top
  return origScrollTo(...args)
}
first()
check('full unlock clears lock count', getBodyScrollLockCount(), 0)
check('overflow restored after last unlock', document.body.style.overflow, '')
check('html overflow restored after last unlock', document.documentElement.style.overflow, '')
check('html overlay lock class is cleared', document.documentElement.classList.contains('is-overlay-locked'), false)
check('scroll position restored', restoredY, 240)

function Layer({ open, onClose, label, child }) {
  const ref = useRef(null)
  useDialogChrome({ open, onClose, containerRef: ref })
  if (!open) return null
  return createElement(
    'div',
    { ref, 'data-testid': `layer-${label}`, role: 'dialog' },
    createElement('button', { type: 'button', 'data-testid': `close-${label}`, onClick: onClose }, `close ${label}`),
    child,
  )
}

function Host() {
  const [front, setFront] = useState(true)
  const [back, setBack] = useState(true)
  useEscapeLayer(false, () => {})
  return createElement(
    'div',
    null,
    createElement(Layer, {
      open: back,
      onClose: () => setBack(false),
      label: 'back',
      child: createElement(Layer, { open: front, onClose: () => setFront(false), label: 'front' }),
    }),
    createElement('div', { 'data-testid': 'flags' }, `back:${back ? '1' : '0'} front:${front ? '1' : '0'}`),
  )
}

function DialogHost() {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useDialogChrome({ open, onClose: () => setOpen(false), containerRef: ref })
  return createElement(
    'div',
    null,
    createElement('button', { type: 'button', 'data-testid': 'opener', onClick: () => setOpen(true) }, 'open'),
    open
      ? createElement(
          'div',
          { ref, role: 'dialog', 'data-testid': 'dialog' },
          createElement('button', { type: 'button', 'data-testid': 'inside' }, 'inside'),
        )
      : null,
  )
}

const rootNode = document.createElement('div')
document.body.appendChild(rootNode)
const root = createRoot(rootNode)

await act(async () => {
  root.render(createElement(Host))
})
check('stacked dialogs both open', rootNode.querySelector('[data-testid="flags"]').textContent, 'back:1 front:1')
await act(async () => {
  window.dispatchEvent(new happy.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
})
check('escape closes only the top layer', rootNode.querySelector('[data-testid="flags"]').textContent, 'back:1 front:0')
await act(async () => {
  window.dispatchEvent(new happy.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
})
check('second escape closes the remaining layer', rootNode.querySelector('[data-testid="flags"]').textContent, 'back:0 front:0')
check('escape stack released body lock', getBodyScrollLockCount(), 0)

await act(async () => {
  root.render(createElement(DialogHost))
})
const opener = rootNode.querySelector('[data-testid="opener"]')
opener.focus()
await act(async () => {
  opener.click()
})
check('opening a dialog moves focus inside', document.activeElement?.getAttribute('data-testid'), 'inside')
await act(async () => {
  window.dispatchEvent(new happy.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
})
check('closing a dialog restores focus to the opener', document.activeElement?.getAttribute('data-testid'), 'opener')
check('dialog unmounted after escape', rootNode.querySelector('[data-testid="dialog"]') == null)

await act(async () => {
  root.unmount()
})

// --- Nested scroll restore regression ---
const protoFocus = happy.HTMLElement.prototype.focus
const protoScrollTo = window.scrollTo
let liveY = 0
function setLiveY(top) {
  liveY = top
  document.documentElement.scrollTop = top
}
Object.defineProperty(window, 'scrollY', { configurable: true, get: () => liveY })
Object.defineProperty(window, 'pageYOffset', { configurable: true, get: () => liveY })
window.scrollTo = (a, b) => {
  const top = typeof a === 'number' ? b : a?.top
  if (typeof top === 'number') setLiveY(top)
}

setLiveY(240)
const outerUnlock = lockBodyScroll()
check('snapshot captures pre-lock scroll', getLockedScrollY(), 240)
setLiveY(0)
const innerUnlock = lockBodyScroll()
check('nested lock keeps original snapshot while scrollY is 0', getLockedScrollY(), 240)
innerUnlock()
check('inner unlock leaves lock and snapshot', getBodyScrollLockCount() === 1 && getLockedScrollY() === 240)
outerUnlock()
check('outer unlock restores the original snapshot, not 0', liveY, 240)
check('outer unlock clears lock count', getBodyScrollLockCount(), 0)

// Relock must not snapshot window.scrollY=0 if the body is still visually fixed.
document.body.style.position = 'fixed'
document.body.style.top = '-240px'
document.documentElement.classList.add('is-overlay-locked')
setLiveY(0)
const relock = lockBodyScroll()
check('relock while still fixed reuses the previous snapshot', getLockedScrollY(), 240)
relock()
check('relock unlock restores 240, not 0', liveY, 240)

function NestedScrollHost() {
  const [outer, setOuter] = useState(false)
  const [inner, setInner] = useState(false)
  const cardRef = useRef(null)
  const outerRef = useRef(null)
  const innerRef = useRef(null)
  useDialogChrome({ open: outer, onClose: () => setOuter(false), containerRef: outerRef })
  useDialogChrome({ open: inner, onClose: () => setInner(false), containerRef: innerRef })
  return createElement(
    'div',
    null,
    createElement(
      'button',
      { type: 'button', 'data-testid': 'nested-card', ref: cardRef, onClick: () => setOuter(true) },
      '本地构图练习（可编辑）',
    ),
    outer
      ? createElement(
          'div',
          { ref: outerRef, role: 'dialog', 'data-testid': 'nested-detail', className: 'detail-sheet' },
          createElement('button', { type: 'button', 'data-testid': 'nested-edit', onClick: () => setInner(true) }, '编辑'),
        )
      : null,
    inner
      ? createElement(
          'div',
          { ref: innerRef, role: 'dialog', 'data-testid': 'nested-edit-panel', className: 'add-panel' },
          createElement('input', { 'data-testid': 'nested-title', defaultValue: '本地构图练习（可编辑）' }),
        )
      : null,
  )
}

const nestNode = document.createElement('div')
document.body.appendChild(nestNode)
const nestRoot = createRoot(nestNode)
await act(async () => {
  nestRoot.render(createElement(NestedScrollHost))
})
const card = nestNode.querySelector('[data-testid="nested-card"]')
setLiveY(240)
card.focus({ preventScroll: true })
let focusJumped = false
happy.HTMLElement.prototype.focus = function focus(opts) {
  if (!opts || opts.preventScroll !== true) {
    focusJumped = true
    setLiveY(0)
  }
  return protoFocus.call(this, opts)
}
await act(async () => {
  card.click()
})
check('nested host opened detail without losing snapshot', getLockedScrollY(), 240)
const edit = nestNode.querySelector('[data-testid="nested-edit"]')
await act(async () => {
  edit.focus({ preventScroll: true })
  edit.click()
})
check('opening edit keeps the original lock snapshot', getLockedScrollY(), 240)
check('edit panel is stacked over detail', Boolean(nestNode.querySelector('[data-testid="nested-edit-panel"]')))
await act(async () => {
  window.dispatchEvent(new happy.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
})
check('first Esc keeps the detail and the snapshot', nestNode.querySelector('[data-testid="nested-detail"]') != null && getLockedScrollY() === 240)
check('first Esc closes only the edit panel', nestNode.querySelector('[data-testid="nested-edit-panel"]') == null)
await act(async () => {
  window.dispatchEvent(new happy.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
})
check('nested Esc close restores list scroll', liveY, 240)
check('nested Esc close does not leave body locked', getBodyScrollLockCount(), 0)
check('programmatic focus used preventScroll so it could not zero the list', focusJumped, false)
check('focus returns to the original card', document.activeElement?.getAttribute('data-testid'), 'nested-card')

happy.HTMLElement.prototype.focus = protoFocus
window.scrollTo = protoScrollTo
await act(async () => {
  nestRoot.unmount()
})

const failed = cases.filter((item) => !item.ok)
console.log(`${cases.length - failed.length}/${cases.length} passed`)
if (failed.length) process.exit(1)
