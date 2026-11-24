/** Display-only album titles. Never write these fallbacks back to stored data. */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const UUID_LOOSE_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const LONG_HEX_RE = /^[0-9a-f]{16,}$/i
const HEX_RUN_RE = /[0-9a-f]{16,}/i

export function formatAlbumImageNumber(index: number): string {
  const safe = Number.isFinite(index) ? Math.max(1, Math.floor(index)) : 1
  return String(safe).padStart(3, '0')
}

export function isOpaqueAlbumTitle(title: string | null | undefined): boolean {
  const raw = title?.trim() ?? ''
  if (!raw) return true
  if (UUID_RE.test(raw) || UUID_LOOSE_RE.test(raw)) return true
  if (LONG_HEX_RE.test(raw)) return true
  const compact = raw.replace(/-/g, '')
  if (LONG_HEX_RE.test(compact) && compact.length >= 32) return true
  // A title that is only a hex/uuid stem plus an extension-like suffix already stripped.
  if (HEX_RUN_RE.test(raw) && raw.replace(HEX_RUN_RE, '') === '') return true
  return false
}

export function albumDisplayTitle(input: { title?: string | null; index: number }): string {
  const fallback = `图片${formatAlbumImageNumber(input.index)}`
  const raw = input.title?.trim() ?? ''
  if (!raw || isOpaqueAlbumTitle(raw)) return fallback
  return raw
}
