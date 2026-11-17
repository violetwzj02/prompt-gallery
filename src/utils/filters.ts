import type { Category, Density, PromptItem } from '../types'

export interface FilterContext {
  /** item id → folder id */
  favoriteOf?: Record<string, string>
  likedIds?: ReadonlySet<string>
  /** Cloud UUID when logged in; otherwise 'default' */
  defaultFolderId?: string
}

export interface GalleryFilters {
  category: Category | '全部'
  collectionId: string | null
  mediums: string[]
  aspects: string[]
  styles: string[]
  q: string
  density: Density
  selectedId: string | null
  /** null = no favorites filter; 'all' = every favorited item; otherwise a folder id */
  favoriteScope: string | null
  /** true = only liked items */
  likedOnly: boolean
}

export const EMPTY_FILTERS: GalleryFilters = {
  category: '全部',
  collectionId: null,
  mediums: [],
  aspects: [],
  styles: [],
  q: '',
  density: 'comfortable',
  selectedId: null,
  favoriteScope: null,
  likedOnly: false,
}

export function normalizeItem(item: PromptItem): PromptItem {
  return {
    ...item,
    parentId: item.parentId ?? null,
    collection: item.collection ?? null,
    collectionIndex: item.collectionIndex ?? null,
    collectionTotal: item.collectionTotal ?? null,
    tags: Array.isArray(item.tags) ? item.tags : [],
    medium: item.medium ?? '图像',
    aspect: item.aspect ?? null,
    promptText: item.promptText ?? '',
    duplicateNote: item.duplicateNote ?? null,
    duplicateOf: item.duplicateOf ?? null,
  }
}

export function itemMatches(
  item: PromptItem,
  f: GalleryFilters,
  skip?: (keyof GalleryFilters)[],
  ctx?: FilterContext,
): boolean {
  const ignore = new Set(skip ?? [])
  if (!ignore.has('likedOnly') && f.likedOnly && !ctx?.likedIds?.has(item.id)) return false
  if (!ignore.has('favoriteScope') && f.favoriteScope) {
    const folder = ctx?.favoriteOf?.[item.id]
    if (!folder) return false
    if (f.favoriteScope !== 'all') {
      const fallback = ctx?.defaultFolderId ?? 'default'
      const wanted = f.favoriteScope === 'default' ? fallback : f.favoriteScope
      if (folder !== wanted) return false
    }
  }
  if (!ignore.has('category') && f.category !== '全部' && item.category !== f.category) return false
  if (!ignore.has('collectionId') && f.collectionId && item.parentId !== f.collectionId) return false
  if (!ignore.has('mediums') && f.mediums.length > 0 && !f.mediums.includes(item.medium)) return false
  if (
    !ignore.has('aspects') &&
    f.aspects.length > 0 &&
    (!item.aspect || !f.aspects.includes(item.aspect))
  ) {
    return false
  }
  if (!ignore.has('styles') && f.styles.length > 0 && !f.styles.every((s) => item.tags.includes(s))) {
    return false
  }
  if (!ignore.has('q')) {
    const query = f.q.trim().toLowerCase()
    if (query) {
      const blob = [
        item.title,
        item.usage,
        item.body,
        item.id,
        item.source,
        item.collection ?? '',
        item.promptText,
        ...(item.tags ?? []),
      ]
        .join('\n')
        .toLowerCase()
      if (!blob.includes(query)) return false
    }
  }
  return true
}

export function hasActiveFilters(f: GalleryFilters): boolean {
  return (
    f.category !== '全部' ||
    f.collectionId !== null ||
    f.mediums.length > 0 ||
    f.aspects.length > 0 ||
    f.styles.length > 0 ||
    f.q.trim() !== '' ||
    f.favoriteScope !== null ||
    f.likedOnly
  )
}

export function parseHash(hash: string): GalleryFilters {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash
  // Do not treat implicit-auth tokens as a selected item id.
  if (raw && !raw.startsWith('/') && /(?:^|&)(access_token|refresh_token|error)=/.test(raw)) {
    return { ...EMPTY_FILTERS }
  }
  const [pathPart, queryPart] = raw.split('?')
  const path = (pathPart || '').replace(/^\/+/, '')
  // Admin console routes are not prompt ids.
  if (path === 'admin' || path.startsWith('admin/')) {
    return { ...EMPTY_FILTERS }
  }
  const selectedId = path && !path.startsWith('?') ? decodeURIComponent(path) : null
  const params = new URLSearchParams(queryPart || '')
  const cat = (params.get('cat') || '').trim()
  const category: Category | '全部' = cat && cat !== '全部' ? cat : '全部'
  const fav = params.get('fav')
  return {
    category,
    collectionId: params.get('col') || null,
    mediums: params.getAll('medium').filter(Boolean),
    aspects: params.getAll('aspect').filter(Boolean),
    styles: params.getAll('tag').filter(Boolean),
    q: params.get('q') || '',
    density: params.get('d') === 'dense' ? 'dense' : 'comfortable',
    selectedId,
    favoriteScope: fav && fav.trim() ? fav : null,
    likedOnly: params.get('liked') === '1',
  }
}

export function toHash(f: GalleryFilters): string {
  const params = new URLSearchParams()
  if (f.category !== '全部') params.set('cat', f.category)
  if (f.collectionId) params.set('col', f.collectionId)
  if (f.favoriteScope) params.set('fav', f.favoriteScope)
  if (f.likedOnly) params.set('liked', '1')
  for (const m of f.mediums) params.append('medium', m)
  for (const a of f.aspects) params.append('aspect', a)
  for (const s of f.styles) params.append('tag', s)
  if (f.q.trim()) params.set('q', f.q.trim())
  if (f.density === 'dense') params.set('d', 'dense')
  const qs = params.toString()
  const path = f.selectedId ? `/${f.selectedId}` : '/'
  return qs ? `#${path}?${qs}` : `#${path === '/' ? '/' : path}`
}

export function toggleIn(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value]
}
