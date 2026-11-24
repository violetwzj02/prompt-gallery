/** Hash-router helpers for the in-gallery personal center. */

import { isAdminHash, normalizeHashPath } from './adminRoutes'

export type AccountView = 'home' | 'account' | 'downloads' | 'album' | 'admin' | 'admin-review'
export type AccountHomeTab = 'works' | 'likes' | 'favorites'

export interface AccountRoute {
  view: AccountView
  tab: AccountHomeTab
  itemId: string | null
  folderId: string | null
  cat: string | null
}

const ACCOUNT_TABS: readonly AccountHomeTab[] = ['works', 'likes', 'favorites']

export function isAccountHash(hash: string): boolean {
  const path = normalizeHashPath(hash)
  return path === 'me' || path.startsWith('me/')
}

/** Personal-center and legacy admin hashes must not be treated as prompt ids. */
export function isReservedHash(hash: string): boolean {
  return isAccountHash(hash) || isAdminHash(hash)
}

export function parseAccountRoute(hash: string): AccountRoute | null {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash
  const queryPart = raw.split('?')[1] || ''
  const path = normalizeHashPath(hash)
  if (path !== 'me' && !path.startsWith('me/')) return null

  const params = new URLSearchParams(queryPart)
  const tabRaw = (params.get('tab') || '').trim()
  const tab: AccountHomeTab = ACCOUNT_TABS.includes(tabRaw as AccountHomeTab)
    ? (tabRaw as AccountHomeTab)
    : 'works'
  const item = (params.get('item') || '').trim()
  const folder = (params.get('folder') || '').trim()

  if (path === 'me/album' || path.startsWith('me/album/')) {
    const catRaw = (params.get('cat') || '').trim()
    return { view: 'album', tab: 'works', itemId: item || null, folderId: folder || null, cat: catRaw || null }
  }
  if (path === 'me/account' || path.startsWith('me/account/')) {
    return { view: 'account', tab: 'works', itemId: item || null, folderId: null, cat: null }
  }
  if (path === 'me/downloads' || path.startsWith('me/downloads/')) {
    return { view: 'downloads', tab: 'works', itemId: item || null, folderId: null, cat: null }
  }
  if (path === 'me/admin/review' || path.startsWith('me/admin/review/')) {
    return { view: 'admin-review', tab: 'works', itemId: null, folderId: null, cat: null }
  }
  if (path === 'me/admin' || path.startsWith('me/admin/')) {
    return { view: 'admin', tab: 'works', itemId: null, folderId: null, cat: null }
  }

  return {
    view: 'home',
    tab,
    itemId: item || null,
    folderId: folder || null,
    cat: null,
  }
}

export function toAccountHash(route: Pick<AccountRoute, 'view'> & Partial<AccountRoute>): string {
  if (route.view === 'account') return '#/me/account'
  if (route.view === 'downloads') return '#/me/downloads'
  if (route.view === 'admin') return '#/me/admin'
  if (route.view === 'admin-review') return '#/me/admin/review'
  if (route.view === 'album') {
    const albumParams = new URLSearchParams()
    if (route.cat) albumParams.set('cat', route.cat)
    if (route.folderId) albumParams.set('folder', route.folderId)
    if (route.itemId) albumParams.set('item', route.itemId)
    const albumQs = albumParams.toString()
    return albumQs ? `#/me/album?${albumQs}` : '#/me/album'
  }
  const params = new URLSearchParams()
  const tab = route.tab && route.tab !== 'works' ? route.tab : null
  if (tab) params.set('tab', tab)
  if (tab === 'favorites' && route.folderId) params.set('folder', route.folderId)
  if (route.itemId) params.set('item', route.itemId)
  const qs = params.toString()
  return qs ? `#/me?${qs}` : '#/me'
}

export type AlbumHistoryLayer = 'folder' | 'item'

export interface AlbumHistoryState {
  promptGalleryAlbum: AlbumHistoryLayer
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function albumLayerFromHistoryState(state: unknown): AlbumHistoryLayer | null {
  if (!isRecord(state)) return null
  const value = state.promptGalleryAlbum
  if (value === 'folder' || value === 'item') return value
  return null
}

export function albumHistoryState(layer: AlbumHistoryLayer): AlbumHistoryState {
  return { promptGalleryAlbum: layer }
}

function dispatchHashChange(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new HashChangeEvent('hashchange'))
}

export function replaceHash(next: string, state: unknown = null): void {
  if (typeof window === 'undefined') return
  if (window.location.hash === next) return
  history.replaceState(state ?? null, '', next)
  dispatchHashChange()
}

export function pushHash(next: string, state: unknown = null): void {
  if (typeof window === 'undefined') return
  if (window.location.hash === next) return
  history.pushState(state, '', next)
  dispatchHashChange()
}

export function closeAlbumHashLayer(input: { expected: AlbumHistoryLayer; fallback: () => void }): void {
  if (typeof window === 'undefined') {
    input.fallback()
    return
  }
  if (albumLayerFromHistoryState(window.history.state) === input.expected) {
    window.history.back()
    return
  }
  input.fallback()
}

let hashNavigationInstalled = false

/** Browsers fire popstate on Back after pushState; hashchange is not guaranteed in every path. */
export function ensureHashNavigationEvents(): void {
  if (typeof window === 'undefined' || hashNavigationInstalled) return
  hashNavigationInstalled = true
  window.addEventListener('popstate', () => {
    dispatchHashChange()
  })
}

export function resetHashNavigationEventsForTests(): void {
  hashNavigationInstalled = false
}

/**
 * Map leftover `#/admin...` links into the personal center.
 * `#/admin/login` waits until auth is ready: admins go to the admin page,
 * everyone else returns to the gallery (they sign in from the top bar).
 */
export function redirectLegacyAdminHash(
  hash: string,
  options: { authReady: boolean; isAdmin: boolean },
): string | null {
  if (!isAdminHash(hash)) return null
  const path = normalizeHashPath(hash)
  if (path === 'admin/login' || path.startsWith('admin/login/')) {
    if (!options.authReady) return null
    return options.isAdmin ? '#/me/admin' : '#/'
  }
  if (path === 'admin/review' || path.startsWith('admin/review/')) return '#/me/admin/review'
  return '#/me/admin'
}
