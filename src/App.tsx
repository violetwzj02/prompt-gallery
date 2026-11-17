import { useEffect, useMemo, useState } from 'react'
import type { PromptItem } from './types'
import { ADULT_CATEGORY, MEDIUMS } from './types'
import { useAuth } from './hooks/useAuth'
import { usePrompts } from './hooks/usePrompts'
import { useTheme } from './hooks/useTheme'
import { useFavorites } from './hooks/useFavorites'
import { useLikes } from './hooks/useLikes'
import { PromptCard } from './components/PromptCard'
import { PromptDetail } from './components/PromptDetail'
import { AddStylePanel } from './components/AddStylePanel'
import { AuthControl } from './components/AuthControl'
import { ThemeToggle } from './components/ThemeToggle'
import { FilterRail } from './components/FilterRail'
import { isAuthCallbackHash } from './lib/supabase'
import { AdminApp } from './components/admin/AdminApp'
import { isAdminHash } from './utils/adminRoutes'
import {
  EMPTY_FILTERS,
  type GalleryFilters,
  hasActiveFilters,
  itemMatches,
  parseHash,
  toHash,
  toggleIn,
} from './utils/filters'
import {
  discoverCustomCategoryNames,
  railCategoryNames,
  styleFacetExclude,
} from './utils/category'
import './App.css'

export default function App() {
  const [adminRoute, setAdminRoute] = useState(() =>
    typeof window !== 'undefined' ? isAdminHash(window.location.hash) : false,
  )

  useEffect(() => {
    const onHash = () => setAdminRoute(isAdminHash(window.location.hash))
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  if (adminRoute) return <AdminApp />
  return <GalleryApp />
}

function GalleryApp() {
  const auth = useAuth()
  const userId = auth.user?.id ?? null
  const { items, loading, error, syncError, meta, addItem, updateItem, removeLocal, exportJson, localCount, baseCount } =
    usePrompts(userId, auth.loading)
  const favorites = useFavorites(userId, auth.loading)
  const likes = useLikes(userId, auth.loading)
  const [filters, setFilters] = useState<GalleryFilters>(() =>
    typeof window !== 'undefined' ? parseHash(window.location.hash) : EMPTY_FILTERS,
  )
  const { pref: themePref, resolved: themeResolved, setPref: setThemePref } = useTheme()
  const [addOpen, setAddOpen] = useState(false)
  const [editing, setEditing] = useState<PromptItem | null>(null)
  const [railOpen, setRailOpen] = useState(false)

  const selected = useMemo(
    () => (filters.selectedId ? items.find((i) => i.id === filters.selectedId) ?? null : null),
    [filters.selectedId, items],
  )

  useEffect(() => {
    const onHash = () => setFilters(parseHash(window.location.hash))
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  useEffect(() => {
    if (isAuthCallbackHash(window.location.hash)) return
    if (isAdminHash(window.location.hash)) return
    const next = toHash(filters)
    if (window.location.hash !== next && (window.location.hash || next !== '#/')) {
      history.replaceState(null, '', next)
    }
  }, [filters])

  const update = (next: GalleryFilters) => setFilters(next)

  const filterCtx = useMemo(
    () => ({ favoriteOf: favorites.items, likedIds: likes.idSet, defaultFolderId: favorites.defaultFolderId }),
    [favorites.items, likes.idSet, favorites.defaultFolderId],
  )

  const filtered = useMemo(
    () => items.filter((it) => itemMatches(it, filters, undefined, filterCtx)),
    [items, filters, filterCtx],
  )

  const rawCategoryCounts = useMemo(() => {
    const map: Record<string, number> = {}
    for (const it of items) map[it.category] = (map[it.category] ?? 0) + 1
    return map
  }, [items])

  const customCategoryNames = useMemo(() => discoverCustomCategoryNames(items), [items])
  const railCategories = useMemo(() => railCategoryNames(items), [items])
  const styleExclude = useMemo(() => styleFacetExclude(customCategoryNames), [customCategoryNames])

  const counts = useMemo(() => {
    const category: Record<string, number> = { 全部: 0 }
    for (const c of railCategories) category[c] = 0
    const collection: Record<string, number> = {}
    const medium: Record<string, number> = {}
    const aspect: Record<string, number> = {}
    const style: Record<string, number> = {}

    const allForCat = items.filter((it) => itemMatches(it, filters, ['category'], filterCtx))
    category['全部'] = allForCat.length
    for (const it of allForCat) category[it.category] = (category[it.category] ?? 0) + 1

    const allForCol = items.filter((it) => itemMatches(it, filters, ['collectionId'], filterCtx))
    for (const it of allForCol) {
      if (it.parentId) collection[it.parentId] = (collection[it.parentId] ?? 0) + 1
    }

    const allForMed = items.filter((it) => itemMatches(it, filters, ['mediums'], filterCtx))
    for (const it of allForMed) medium[it.medium] = (medium[it.medium] ?? 0) + 1

    const allForAsp = items.filter((it) => itemMatches(it, filters, ['aspects'], filterCtx))
    for (const it of allForAsp) {
      if (it.aspect) aspect[it.aspect] = (aspect[it.aspect] ?? 0) + 1
    }

    const allForStyle = items.filter((it) => itemMatches(it, filters, ['styles'], filterCtx))
    for (const it of allForStyle) {
      for (const t of it.tags) style[t] = (style[t] ?? 0) + 1
    }

    const allForFav = items.filter((it) => itemMatches(it, filters, ['favoriteScope'], filterCtx))
    let favoriteAll = 0
    const favoriteByFolder: Record<string, number> = {}
    for (const folder of favorites.folders) favoriteByFolder[folder.id] = 0
    for (const it of allForFav) {
      const folderId = favorites.items[it.id]
      if (!folderId) continue
      favoriteAll += 1
      favoriteByFolder[folderId] = (favoriteByFolder[folderId] ?? 0) + 1
    }

    const allForLiked = items.filter((it) => itemMatches(it, filters, ['likedOnly'], filterCtx))
    let likedAll = 0
    for (const it of allForLiked) {
      if (likes.idSet.has(it.id)) likedAll += 1
    }

    return { category, collection, medium, aspect, style, favoriteAll, favoriteByFolder, likedAll }
  }, [items, filters, filterCtx, favorites.folders, favorites.items, likes.idSet, railCategories])

  const collections = meta?.collections ?? []
  const mediums = (meta?.tagFacets.medium.map((f) => f.name) ?? MEDIUMS).filter(
    (m) => (counts.medium[m] ?? 0) > 0 || filters.mediums.includes(m),
  )
  const aspects = (meta?.tagFacets.aspect.map((f) => f.name) ?? []).filter(
    (a) => (counts.aspect[a] ?? 0) > 0 || filters.aspects.includes(a),
  )
  const styles = (() => {
    const seen = new Set<string>()
    const list: string[] = []
    const candidates = [
      ...(meta?.tagFacets.style.map((f) => f.name) ?? []),
      ...Object.keys(counts.style),
      ...filters.styles,
    ]
    for (const s of candidates) {
      if (!s || seen.has(s) || styleExclude.has(s)) continue
      if ((counts.style[s] ?? 0) > 0 || filters.styles.includes(s)) {
        seen.add(s)
        list.push(s)
      }
    }
    return list
  })()

  const clearFilters = () =>
    update({
      ...EMPTY_FILTERS,
      density: filters.density,
      selectedId: filters.selectedId,
    })

  const openItem = (item: PromptItem) => update({ ...filters, selectedId: item.id })
  const closeItem = () => update({ ...filters, selectedId: null })

  const siblings = useMemo(() => {
    if (!selected?.parentId) return []
    return items
      .filter((i) => i.parentId === selected.parentId)
      .sort((a, b) => (a.collectionIndex ?? 0) - (b.collectionIndex ?? 0))
  }, [selected, items])

  const onTagFromDetail = (tag: string) => {
    const isMedium = MEDIUMS.includes(tag as (typeof MEDIUMS)[number])
    const isAspect = /^\d+:\d+$/.test(tag)
    const isCollection = collections.some((c) => c.name === tag)
    if (isMedium) {
      update({ ...filters, mediums: toggleIn(filters.mediums, tag) })
      return
    }
    if (isAspect) {
      update({ ...filters, aspects: toggleIn(filters.aspects, tag) })
      return
    }
    if (isCollection) {
      const col = collections.find((c) => c.name === tag)
      if (col) update({ ...filters, collectionId: col.id, category: col.category as GalleryFilters['category'] })
      return
    }
    update({ ...filters, styles: toggleIn(filters.styles, tag) })
  }

  const emptyCopy = (() => {
    const liveFavoriteIds = items.filter((it) => favorites.items[it.id]).map((it) => it.id)
    const liveLikedIds = items.filter((it) => likes.idSet.has(it.id)).map((it) => it.id)
    if (filters.likedOnly && liveLikedIds.length === 0) {
      return '还没有喜欢的风格。点击卡片右上角的心形即可标记为喜欢。'
    }
    if (filters.favoriteScope === 'all' && liveFavoriteIds.length === 0) {
      return '还没有收藏。点击卡片右上角的书签即可加入收藏夹。'
    }
    if (filters.favoriteScope && filters.favoriteScope !== 'all') {
      const inFolder = liveFavoriteIds.filter((id) => favorites.items[id] === filters.favoriteScope)
      if (inFolder.length === 0) {
        const name =
          favorites.folders.find((f) => f.id === filters.favoriteScope)?.name ?? '该收藏夹'
        return `「${name}」还是空的。可将条目收藏到此夹，或先在卡片上点亮书签。`
      }
    }
    if (filters.category === ADULT_CATEGORY && (rawCategoryCounts[ADULT_CATEGORY] ?? 0) === 0) {
      return '「18+」分类暂无风格，后续可在添加风格时选择此大类。'
    }
    return '没有符合条件的提示词。'
  })()

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar__brand">
          <p className="eyebrow">Prompt Library</p>
          <h1>风格 Prompt 图鉴</h1>
        </div>

        <div className="topbar__search">
          <span className="search-icon" aria-hidden>
            ⌕
          </span>
          <input
            className="search"
            value={filters.q}
            onChange={(e) => update({ ...filters, q: e.target.value })}
            placeholder="搜索标题、合集、标签、正文…"
            aria-label="搜索"
          />
        </div>

        <div className="topbar__meta">
          <p className="shot-count" aria-live="polite">
            <strong>{loading ? '—' : filtered.length}</strong>
            <span>条</span>
          </p>
          {localCount > 0 && <span className="topbar-note">本地 +{localCount}</span>}
          {(syncError || favorites.error || likes.error) && (
            <span className="topbar-note topbar-note--error">
              {syncError || favorites.error || likes.error}
            </span>
          )}
        </div>

        <div className="topbar__actions">
          <button
            type="button"
            className="icon-btn rail-toggle"
            onClick={() => setRailOpen(true)}
            aria-label="打开筛选"
          >
            筛选
          </button>
          <AuthControl auth={auth} />
          <ThemeToggle pref={themePref} resolved={themeResolved} onChange={setThemePref} />
          <div className="density" role="group" aria-label="网格密度">
            <button
              type="button"
              className={filters.density === 'comfortable' ? 'is-active' : ''}
              onClick={() => update({ ...filters, density: 'comfortable' })}
            >
              疏
            </button>
            <button
              type="button"
              className={filters.density === 'dense' ? 'is-active' : ''}
              onClick={() => update({ ...filters, density: 'dense' })}
            >
              密
            </button>
          </div>
          <button type="button" className="btn btn-primary" onClick={() => { setEditing(null); setAddOpen(true) }}>
            添加风格
          </button>
          <button type="button" className="btn btn-ghost" onClick={exportJson}>
            导出 JSON
          </button>
        </div>
      </header>

      <div className="shell">
        {railOpen && (
          <button type="button" className="rail-backdrop" aria-label="关闭筛选面板" onClick={() => setRailOpen(false)} />
        )}
        <FilterRail
          filters={filters}
          onChange={(next) => {
            update(next)
          }}
          onClear={clearFilters}
          counts={counts}
          collections={collections}
          mediums={mediums}
          aspects={aspects}
          styles={styles}
          categories={railCategories}
          active={railOpen}
          onCloseMobile={() => setRailOpen(false)}
          folders={favorites.folders}
          defaultFolderId={favorites.defaultFolderId}
          accountSynced={Boolean(userId)}
          onCreateFolder={favorites.createFolder}
          onRenameFolder={favorites.renameFolder}
          onDeleteFolder={favorites.deleteFolder}
        />

        <main className="main">
          {loading && <p className="state">正在载入图鉴…</p>}
          {error && (
            <p className="state state-error">无法载入图鉴数据：{error}。请确认 data/prompts.json 可访问。</p>
          )}
          {!loading && !error && filtered.length === 0 && (
            <div className="state state-empty">
              <p>{emptyCopy}</p>
              {hasActiveFilters(filters) && (
                <button type="button" className="btn btn-ghost" onClick={clearFilters}>
                  清除筛选
                </button>
              )}
            </div>
          )}
          {!loading && !error && filtered.length > 0 && (
            <div className={`grid grid--${filters.density}`}>
              {filtered.map((it) => (
                <PromptCard
                  key={it.id}
                  item={it}
                  onOpen={openItem}
                  liked={likes.isLiked(it.id)}
                  onToggleLike={(item) => likes.toggle(item.id)}
                  favorited={favorites.isFavorited(it.id)}
                  onToggleFavorite={(item) => favorites.toggle(item.id)}
                  viewerId={userId}
                />
              ))}
            </div>
          )}
        </main>
      </div>

      <footer className="footer">
        <span>
          内容源自{' '}
          <a href="https://github.com/Nihilist-ZIO/prompt-library" target="_blank" rel="noreferrer">
            Nihilist-ZIO/prompt-library
          </a>{' '}
          · CC BY 4.0
        </span>
        {meta && (
          <span className="muted">
            源库 {meta.masterCount ?? meta.count} 条主条目 · 拆分为 {baseCount} 张卡片
          </span>
        )}
      </footer>

      {selected && (
        <PromptDetail
          item={selected}
          items={filtered}
          siblings={siblings}
          onClose={closeItem}
          onSelect={openItem}
          onTag={onTagFromDetail}
          onOpenCollection={(parentId) => {
            const col = collections.find((c) => c.id === parentId)
            update({
              ...filters,
              collectionId: parentId,
              category: (col?.category as GalleryFilters['category']) ?? filters.category,
              selectedId: selected.id,
            })
          }}
          onRemoveLocal={removeLocal}
          onEdit={(item) => {
            setEditing(item)
            setAddOpen(true)
          }}
          liked={likes.isLiked(selected.id)}
          onToggleLike={likes.toggle}
          favorited={favorites.isFavorited(selected.id)}
          favoriteFolderId={favorites.folderOf(selected.id)}
          folders={favorites.folders}
          onAddFavorite={favorites.addToFolder}
          onRemoveFavorite={favorites.unfavorite}
          onCreateFolder={favorites.createFolder}
          viewerId={userId}
        />
      )}
      <AddStylePanel
        open={addOpen}
        editing={editing}
        onClose={() => {
          setAddOpen(false)
          setEditing(null)
        }}
        onAdd={async (item) => {
          const created = await addItem(item)
          update({ ...filters, selectedId: created.id })
          return created
        }}
        onUpdate={async (item) => {
          const saved = await updateItem(item)
          update({ ...filters, selectedId: saved.id })
          return saved
        }}
        onExport={exportJson}
        synced={Boolean(userId)}
        customCategories={customCategoryNames}
      />
    </div>
  )
}
