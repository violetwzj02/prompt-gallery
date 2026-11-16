import { useMemo, useState, type CSSProperties } from 'react'
import type { Category, PromptItem } from './types'
import { CATEGORIES, CATEGORY_ACCENT } from './types'
import { usePrompts } from './hooks/usePrompts'
import { PromptCard } from './components/PromptCard'
import { PromptDetail } from './components/PromptDetail'
import { AddStylePanel } from './components/AddStylePanel'
import './App.css'

export default function App() {
  const { items, loading, error, meta, addItem, removeLocal, exportJson, localCount } =
    usePrompts()
  const [cat, setCat] = useState<Category | '全部'>('全部')
  const [q, setQ] = useState('')
  const [selected, setSelected] = useState<PromptItem | null>(null)
  const [addOpen, setAddOpen] = useState(false)

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase()
    return items.filter((it) => {
      if (cat !== '全部' && it.category !== cat) return false
      if (!query) return true
      return (
        it.title.toLowerCase().includes(query) ||
        it.usage.toLowerCase().includes(query) ||
        it.body.toLowerCase().includes(query) ||
        it.id.toLowerCase().includes(query) ||
        it.source.toLowerCase().includes(query)
      )
    })
  }, [items, cat, q])

  const counts = useMemo(() => {
    const m: Record<string, number> = { 全部: items.length }
    for (const c of CATEGORIES) m[c] = 0
    for (const it of items) m[it.category] = (m[it.category] ?? 0) + 1
    return m
  }, [items])

  return (
    <div className="app">
      <div className="bg-glow" aria-hidden />
      <header className="hero">
        <div className="hero-top">
          <div>
            <p className="eyebrow">PROMPT LIBRARY GALLERY</p>
            <h1>风格 Prompt 图鉴</h1>
            <p className="hero-sub">
              可视化浏览个性化图像生成提示词 · 按风格筛选 · 一键复制 · 可扩展入库
            </p>
          </div>
          <div className="hero-actions">
            <button type="button" className="btn btn-primary" onClick={() => setAddOpen(true)}>
              添加风格
            </button>
            <button type="button" className="btn btn-ghost" onClick={exportJson}>
              导出 JSON
            </button>
          </div>
        </div>

        <div className="toolbar">
          <div className="search-wrap">
            <span className="search-icon" aria-hidden>
              ⌕
            </span>
            <input
              className="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="搜索标题、用途、正文、ID…"
              aria-label="搜索"
            />
          </div>
          <div className="stats">
            <span>
              显示 <strong>{filtered.length}</strong> / {items.length}
            </span>
            {meta && (
              <span className="muted">
                源库 {meta.count} 条
                {localCount > 0 ? ` · 本地 +${localCount}` : ''}
              </span>
            )}
          </div>
        </div>

        <nav className="cat-bar" aria-label="大类筛选">
          <button
            type="button"
            className={`cat-chip ${cat === '全部' ? 'is-active' : ''}`}
            onClick={() => setCat('全部')}
          >
            全部 <em>{counts['全部']}</em>
          </button>
          {CATEGORIES.map((c) => (
            <button
              key={c}
              type="button"
              className={`cat-chip ${cat === c ? 'is-active' : ''}`}
              style={
                {
                  '--chip-accent': CATEGORY_ACCENT[c],
                } as CSSProperties
              }
              onClick={() => setCat(c)}
            >
              {c} <em>{counts[c]}</em>
            </button>
          ))}
        </nav>
      </header>

      <main className="main">
        {loading && <p className="state">加载图鉴数据…</p>}
        {error && <p className="state state-error">加载失败：{error}</p>}
        {!loading && !error && filtered.length === 0 && (
          <p className="state">没有匹配的风格，试试换个关键词。</p>
        )}
        <div className="grid">
          {filtered.map((it) => (
            <PromptCard key={it.id} item={it} onOpen={setSelected} />
          ))}
        </div>
      </main>

      <footer className="footer">
        <span>
          内容源自{' '}
          <a
            href="https://github.com/Nihilist-ZIO/prompt-library"
            target="_blank"
            rel="noreferrer"
          >
            Nihilist-ZIO/prompt-library
          </a>{' '}
          · CC BY 4.0
        </span>
        <span className="muted">本地静态部署友好 · Vite + React</span>
      </footer>

      {selected && (
        <PromptDetail
          item={selected}
          onClose={() => setSelected(null)}
          onRemoveLocal={removeLocal}
        />
      )}
      <AddStylePanel
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onAdd={addItem}
        onExport={exportJson}
      />
    </div>
  )
}
