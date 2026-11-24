import { useEffect, useLayoutEffect, type RefObject } from 'react'

type EscapeLayer = {
  id: number
  close: () => void
  getNode: () => HTMLElement | null
}
const escapeLayers = new Map<number, EscapeLayer>()
let nextEscapeId = 1
let escapeListenerAttached = false

function zRank(node: HTMLElement | null): number {
  if (!node || typeof window === 'undefined' || typeof window.getComputedStyle !== 'function') return 0
  let rank = 0
  let current: HTMLElement | null = node
  while (current) {
    const raw = window.getComputedStyle(current).zIndex
    const value = Number(raw)
    if (Number.isFinite(value)) rank = Math.max(rank, value)
    current = current.parentElement
  }
  return rank
}

function topEscapeLayer(): EscapeLayer | null {
  const list = Array.from(escapeLayers.values())
  list.sort((left, right) => {
    const leftNode = left.getNode()
    const rightNode = right.getNode()
    const zDiff = zRank(leftNode) - zRank(rightNode)
    if (zDiff !== 0) return zDiff
    if (leftNode && rightNode) {
      const position = leftNode.compareDocumentPosition(rightNode)
      if (position & Node.DOCUMENT_POSITION_CONTAINED_BY) return -1
      if (position & Node.DOCUMENT_POSITION_CONTAINS) return 1
      if (position & Node.DOCUMENT_POSITION_FOLLOWING) return -1
      if (position & Node.DOCUMENT_POSITION_PRECEDING) return 1
    }
    return left.id - right.id
  })
  return list[list.length - 1] ?? null
}

function ensureEscapeDispatcher(): () => void {
  if (escapeListenerAttached || typeof window === 'undefined') return () => {}
  escapeListenerAttached = true
  const onKey = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || escapeLayers.size === 0) return
    const top = topEscapeLayer()
    if (!top) return
    event.preventDefault()
    event.stopImmediatePropagation()
    top.close()
  }
  window.addEventListener('keydown', onKey, true)
  return () => {
    window.removeEventListener('keydown', onKey, true)
    escapeListenerAttached = false
  }
}

let detachEscapeDispatcher: (() => void) | null = null
let lockCount = 0
let previousOverflow = ''
let previousPosition = ''
let previousTop = ''
let previousLeft = ''
let previousRight = ''
let previousWidth = ''
let previousHtmlOverflow = ''
let previousHtmlOverscroll = ''
let previousBodyOverscroll = ''
let lockedScrollY = 0
let removeScrollGuards: (() => void) | null = null

export function getBodyScrollLockCount(): number {
  return lockCount
}

export function getLockedScrollY(): number {
  return lockedScrollY
}

function readScrollY(): number {
  if (typeof window === 'undefined') return 0
  return window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0
}

function applyScrollY(top: number): void {
  if (typeof window === 'undefined') return
  document.documentElement.scrollTop = top
  document.body.scrollTop = top
  window.scrollTo(0, top)
}

function isVisuallyLocked(): boolean {
  return (
    document.documentElement.classList.contains('is-overlay-locked') ||
    document.body.style.position === 'fixed'
  )
}

function isInsideOverlayScroller(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  return Boolean(
    target.closest(
      '.rail, .detail-sheet, .add-panel, .album-lightbox, .album-viewer, .account-menu, .theme-menu, .auth-panel, [role="dialog"]',
    ),
  )
}

function scrollYFromLockedTop(): number {
  const raw = Number.parseInt(document.body.style.top || '', 10)
  return Number.isFinite(raw) ? Math.abs(raw) : 0
}

export function lockBodyScroll(): () => void {
  if (typeof document === 'undefined') return () => {}
  if (lockCount === 0) {
    previousOverflow = document.body.style.overflow
    previousPosition = document.body.style.position
    previousTop = document.body.style.top
    previousLeft = document.body.style.left
    previousRight = document.body.style.right
    previousWidth = document.body.style.width
    previousHtmlOverflow = document.documentElement.style.overflow
    previousHtmlOverscroll = document.documentElement.style.overscrollBehavior
    previousBodyOverscroll = document.body.style.overscrollBehavior
    // If a previous lock was released from the counter but the body is still
    // visually fixed, window.scrollY is 0 and must not replace the snapshot.
    lockedScrollY = isVisuallyLocked() ? lockedScrollY || scrollYFromLockedTop() : readScrollY()
    document.documentElement.style.overflow = 'hidden'
    document.documentElement.style.overscrollBehavior = 'none'
    document.documentElement.classList.add('is-overlay-locked')
    document.body.style.overflow = 'hidden'
    document.body.style.position = 'fixed'
    document.body.style.top = `-${lockedScrollY}px`
    document.body.style.left = '0'
    document.body.style.right = '0'
    document.body.style.width = '100%'
    document.body.style.overscrollBehavior = 'none'
    const guard = (event: Event) => {
      if (isInsideOverlayScroller(event.target)) return
      event.preventDefault()
    }
    document.addEventListener('touchmove', guard, { passive: false })
    document.addEventListener('wheel', guard, { passive: false })
    removeScrollGuards = () => {
      document.removeEventListener('touchmove', guard)
      document.removeEventListener('wheel', guard)
    }
  }
  lockCount += 1
  let released = false
  return () => {
    if (released) return
    released = true
    lockCount = Math.max(0, lockCount - 1)
    if (lockCount !== 0 || typeof document === 'undefined') return
    removeScrollGuards?.()
    removeScrollGuards = null
    const restoreTo = lockedScrollY
    document.documentElement.style.overflow = previousHtmlOverflow
    document.documentElement.style.overscrollBehavior = previousHtmlOverscroll
    document.documentElement.classList.remove('is-overlay-locked')
    document.body.style.overflow = previousOverflow
    document.body.style.position = previousPosition
    document.body.style.top = previousTop
    document.body.style.left = previousLeft
    document.body.style.right = previousRight
    document.body.style.width = previousWidth
    document.body.style.overscrollBehavior = previousBodyOverscroll
    applyScrollY(restoreTo)
  }
}

export function useEscapeLayer(
  enabled: boolean,
  onClose: () => void,
  containerRef?: RefObject<HTMLElement | null>,
): void {
  useEffect(() => {
    if (!enabled) return
    if (!detachEscapeDispatcher) detachEscapeDispatcher = ensureEscapeDispatcher()
    const id = nextEscapeId
    nextEscapeId += 1
    escapeLayers.set(id, {
      id,
      close: onClose,
      getNode: () => containerRef?.current ?? null,
    })
    return () => {
      escapeLayers.delete(id)
      if (escapeLayers.size === 0 && detachEscapeDispatcher) {
        detachEscapeDispatcher()
        detachEscapeDispatcher = null
      }
    }
  }, [enabled, onClose, containerRef])
}

function isVisible(element: HTMLElement): boolean {
  return !!(element.offsetWidth || element.offsetHeight || element.getClientRects().length)
}

export function focusableElements(root: HTMLElement): HTMLElement[] {
  const selector = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled]):not([type="hidden"])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
  ].join(',')
  return Array.from(root.querySelectorAll<HTMLElement>(selector)).filter(
    (element) => !element.hasAttribute('disabled') && element.tabIndex !== -1 && isVisible(element),
  )
}

export function useDialogChrome(input: {
  open: boolean
  onClose: () => void
  containerRef: RefObject<HTMLElement | null>
  lockScroll?: boolean
  restoreFocus?: boolean
}): void {
  const { open, onClose, containerRef, lockScroll = true, restoreFocus = true } = input
  useEscapeLayer(open, onClose, containerRef)

  useLayoutEffect(() => {
    if (!open) return
    const unlock = lockScroll ? lockBodyScroll() : () => {}
    const previouslyFocused =
      restoreFocus && document.activeElement instanceof HTMLElement ? document.activeElement : null
    const node = containerRef.current
    if (node) {
      if (!node.hasAttribute('tabindex')) node.tabIndex = -1
      const initial =
        node.querySelector<HTMLElement>('[data-autofocus], [autofocus]') ??
        focusableElements(node)[0] ??
        node
      initial.focus({ preventScroll: true })
    }
    return () => {
      // Restore focus first so it cannot overwrite the unlocked scroll position.
      if (previouslyFocused && previouslyFocused.isConnected) {
        previouslyFocused.focus({ preventScroll: true })
      }
      unlock()
    }
  }, [open, containerRef, lockScroll, restoreFocus])

  useEffect(() => {
    if (!open) return
    const node = containerRef.current
    if (!node) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return
      const list = focusableElements(node)
      if (list.length === 0) {
        event.preventDefault()
        node.focus({ preventScroll: true })
        return
      }
      const first = list[0]
      const last = list[list.length - 1]
      const active = document.activeElement
      if (event.shiftKey && (active === first || !node.contains(active))) {
        event.preventDefault()
        last.focus({ preventScroll: true })
        return
      }
      if (!event.shiftKey && (active === last || !node.contains(active))) {
        event.preventDefault()
        first.focus({ preventScroll: true })
      }
    }
    node.addEventListener('keydown', onKey)
    return () => node.removeEventListener('keydown', onKey)
  }, [open, containerRef])
}
