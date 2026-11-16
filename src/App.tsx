import { useEffect, useMemo, useState } from 'react'
import type { PromptItem } from './types'
import { CATEGORIES, MEDIUMS } from './types'
import { usePrompts } from './hooks/usePrompts'
import { useTheme } from './hooks/useTheme'
import { PromptCard } from './components/PromptCard'
import { PromptDetail } from './components/PromptDetail'
import { AddStylePanel } from './components/AddStylePanel'
import { ThemeToggle } from './components/ThemeToggle'
import { FilterRail } from './components/FilterRail'
import {
  EMPTY_FILTERS,
  type GalleryFilters,
  hasActiveFilters,
  itemMatches,
  parseHash,
  toHash,
  toggleIn,
} from './utils/filters'
import './App.css'

export default function App() {
  const { items, loading, error, meta, addItem, removeLocal, exportJson, localCount } =
    usePrompts()
  const [filters, setFilters] = useState<GalleryFilters>(() =>
    typeof window !== 'undefined' ? parseHash(window.location.hash) : EMPTY_FILTERS,
  )
  const { pref: themePref, resolved: themeResolved, setPref: setThemePref } = useTheme()
  const [addOpen, setAddOpen] = useState(false)
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
    const next = toHash(filters)
    if (window.location.hash !== next && (window.location.hash || next !== '#/')) {
      history.replaceState(null, '', next)
    }
  }, [filters])

  const update = (next: GalleryFilters) => setFilters(next)

  const filtered = useMemo(() => items.filter((it) => itemMatches(it, filters)), [items, filters])

  const counts = useMemo(() => {
    const category: Record<string, number> = { 全部: 0 }
    for (const c of CATEGORIES) category[c] = 0
    const collection: Record<string, number> = {}
    const medium: Record<string, number> = {}
    const aspect: Record<string, number> = {}
    const style: Record<string, number> = {}

    const allForCat = items.filter((it) => itemMatches(it, filters, ['category']))
    category['全部'] = allForCat.length
    for (const it of allForCat) category[it.category] = (category[it.category] ?? 0) + 1

    const allForCol = items.filter((it) => itemMatches(it, filters, ['collectionId']))
    for (const it of allForCol) {
      if (it.parentId) collection[it.parentId] = (collection[it.parentId] ?? 0) + 1
    }

    const allForMed = items.filter((it) => itemMatches(it, filters, ['mediums']))
    for (const it of allForMed) medium[it.medium] = (medium[it.medium] ?? 0) + 1

    const allForAsp = items.filter((it) => itemMatches(it, filters, ['aspects']))
    for (const it of allForAsp) {
      if (it.aspect) aspect[it.aspect] = (aspect[it.aspect] ?? 0) + 1
    }

    const allForStyle = items.filter((it) => itemMatches(it, filters, ['styles']))
    for (const it of allForStyle) {
      for (const t of it.tags) style[t] = (style[t] ?? 0) + 1
    }

    return { category, collection, medium, aspect, style }
  }, [items, filters])

  const collections = meta?.collections ?? []
  const mediums = (meta?.tagFacets.medium.map((f) => f.name) ?? MEDIUMS).filter(
    (m) => (counts.medium[m] ?? 0) > 0 || filters.mediums.includes(m),
  )
  const aspects = (meta?.tagFacets.aspect.map((f) => f.name) ?? []).filter(
    (a) => (counts.aspect[a] ?? 0) > 0 || filters.aspects.includes(a),
  )
  const styles = (meta?.tagFacets.style.map((f) => f.name) ?? []).filter(
    (s) => (counts.style[s] ?? 0) > 0 || filters.styles.includes(s),
  )

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
          <button type="button" className="btn btn-primary" onClick={() => setAddOpen(true)}>
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
          active={railOpen}
          onCloseMobile={() => setRailOpen(false)}
        />

        <main className="main">
          {loading && <p className="state">正在载入图鉴…</p>}
          {error && (
            <p className="state state-error">无法载入图鉴数据：{error}。请确认 data/prompts.json 可访问。</p>
          )}
          {!loading && !error && filtered.length === 0 && (
            <div className="state state-empty">
              <p>没有符合条件的提示词。</p>
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
                <PromptCard key={it.id} item={it} onOpen={openItem} />
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
            源库 {meta.masterCount ?? meta.count} 条主条目 · 拆分为 {items.length - localCount} 张卡片
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
        />
      )}
      <AddStylePanel
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onAdd={(item) => {
          const created = addItem(item)
          update({ ...filters, selectedId: created.id })
          return created
        }}
        onExport={exportJson}
      />
    </div>
  )
}
