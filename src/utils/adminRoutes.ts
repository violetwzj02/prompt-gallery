/** Hash-router helpers for the standalone admin console. */

export function normalizeHashPath(hash: string): string {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash
  const pathPart = raw.split('?')[0] || ''
  return pathPart.replace(/^\/+/, '')
}

/** True for `#/admin` and `#/admin/...` (including login). */
export function isAdminHash(hash: string): boolean {
  const path = normalizeHashPath(hash)
  return path === 'admin' || path.startsWith('admin/')
}

export type AdminView = 'login' | 'home'

export function parseAdminView(hash: string): AdminView {
  const path = normalizeHashPath(hash)
  if (path === 'admin/login' || path.startsWith('admin/login/')) return 'login'
  return 'home'
}

export function toAdminHash(view: AdminView = 'home'): string {
  return view === 'login' ? '#/admin/login' : '#/admin'
}

export function setAdminHash(view: AdminView, replace = true): void {
  if (typeof window === 'undefined') return
  const next = toAdminHash(view)
  if (window.location.hash === next) return
  if (replace) history.replaceState(null, '', next)
  else history.pushState(null, '', next)
  window.dispatchEvent(new HashChangeEvent('hashchange'))
}
