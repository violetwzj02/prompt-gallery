import { useEffect, useState, type CSSProperties } from 'react'
import ReactMarkdown from 'react-markdown'
import type { PromptItem } from '../types'
import { CATEGORY_ACCENT } from '../types'
import { extractPurePrompt } from '../utils/promptExtract'
import { CoverArt } from './CoverArt'

interface Props {
  item: PromptItem
  items: PromptItem[]
  siblings: PromptItem[]
  onClose: () => void
  onSelect: (item: PromptItem) => void
  onTag: (tag: string) => void
  onOpenCollection?: (parentId: string) => void
  onRemoveLocal?: (id: string) => void
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const ta = document.createElement('textarea')
    ta.value = text
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  }
}

function purePrompt(item: PromptItem): string {
  return (item.promptText && item.promptText.trim()) || extractPurePrompt(item.body)
}

export function PromptDetail({
  item,
  items,
  siblings,
  onClose,
  onSelect,
  onTag,
  onOpenCollection,
  onRemoveLocal,
}: Props) {
  const [toast, setToast] = useState<string | null>(null)
  const accent = CATEGORY_ACCENT[item.category]
  const indexInList = items.findIndex((i) => i.id === item.id)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
        return
      }
      if (e.key === 'ArrowLeft' && indexInList > 0) {
        e.preventDefault()
        onSelect(items[indexInList - 1])
      }
      if (e.key === 'ArrowRight' && indexInList >= 0 && indexInList < items.length - 1) {
        e.preventDefault()
        onSelect(items[indexInList + 1])
      }
    }
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [onClose, onSelect, items, indexInList])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 1800)
    return () => clearTimeout(t)
  }, [toast])

  const flash = async (label: string, text: string) => {
    const ok = await copyText(text)
    setToast(ok ? label : '复制失败')
  }

  const copyLink = async () => {
    const url = `${window.location.origin}${window.location.pathname}${window.location.hash}`
    await flash('已复制链接', url)
  }

  const visibleTags = item.tags.filter((t) => t && t !== item.category)

  return (
    <div className="detail-overlay" onClick={onClose} role="presentation">
      <div
        className="detail-sheet"
        style={{ '--card-accent': accent } as CSSProperties}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal
        aria-label={item.title}
      >
        <button type="button" className="detail-close" onClick={onClose} aria-label="关闭">
          ×
        </button>

        <div className="detail-hero">
          <CoverArt item={item} large className="detail-cover" />
        </div>

        <div className="detail-content">
          <nav className="detail-crumb" aria-label="位置">
            <button type="button" className="crumb-link" onClick={onClose}>
              {item.category}
            </button>
            {item.collection && item.parentId && (
              <>
                <span className="crumb-sep">/</span>
                <button
                  type="button"
                  className="crumb-link"
                  onClick={() => onOpenCollection?.(item.parentId!)}
                >
                  {item.collection}
                </button>
              </>
            )}
            <span className="crumb-sep">/</span>
            <span className="crumb-current">{item.title}</span>
          </nav>

          <div className="detail-kicker">
            {item.collection && item.collectionIndex && item.collectionTotal ? (
              <span>
                {item.collection} · {item.collectionIndex}/{item.collectionTotal}
              </span>
            ) : (
              <span>{item.category}</span>
            )}
            {indexInList >= 0 && (
              <span className="detail-index">
                筛选结果 {indexInList + 1} / {items.length}
              </span>
            )}
            <span className="detail-id">{item.id}</span>
            {item.local && <span className="pill pill--local">本地新增</span>}
          </div>

          <h2 className="detail-title">{item.title}</h2>
          {item.usage && <p className="detail-usage">{item.usage}</p>}

          {item.duplicateNote && (
            <p className="detail-dup">
              {item.duplicateOf ? (
                <>
                  与{' '}
                  <button
                    type="button"
                    className="crumb-link"
                    onClick={() => {
                      const target = siblings.find((s) => s.id === item.duplicateOf) ??
                        items.find((s) => s.id === item.duplicateOf)
                      if (target) onSelect(target)
                    }}
                  >
                    {item.duplicateOf}
                  </button>{' '}
                  内容相同
                  {item.duplicateNote && item.duplicateNote !== `与 ${item.duplicateOf} 内容相同` ? (
                    <span className="detail-dup__src">（{item.duplicateNote}）</span>
                  ) : null}
                </>
              ) : (
                item.duplicateNote
              )}
            </p>
          )}

          {visibleTags.length > 0 && (
            <div className="detail-tags">
              {visibleTags.map((t) => (
                <button type="button" key={t} className="pill" onClick={() => onTag(t)}>
                  {t}
                </button>
              ))}
            </div>
          )}

          <div className="detail-actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => flash('已复制全文', item.body)}
            >
              复制全文
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => flash('已复制纯提示词', purePrompt(item))}
            >
              复制纯提示词
            </button>
            <button type="button" className="btn btn-ghost" onClick={copyLink}>
              复制链接
            </button>
            {item.local && onRemoveLocal && (
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => {
                  onRemoveLocal(item.id)
                  onClose()
                }}
              >
                删除本地条目
              </button>
            )}
          </div>

          {item.source && <p className="detail-source">原 {item.source}</p>}

          <div className="detail-md">
            <ReactMarkdown>{item.body}</ReactMarkdown>
          </div>

          {siblings.length > 1 && (
            <section className="detail-siblings">
              <h3>同一合集</h3>
              <div className="sibling-row">
                {siblings.map((s) => (
                  <button
                    type="button"
                    key={s.id}
                    className={`sibling-card ${s.id === item.id ? 'is-current' : ''}`}
                    onClick={() => onSelect(s)}
                    title={s.title}
                  >
                    <CoverArt item={s} className="sibling-cover" />
                    <span className="sibling-label">
                      {s.collectionIndex ? `${s.collectionIndex}. ` : ''}
                      {s.title}
                    </span>
                  </button>
                ))}
              </div>
            </section>
          )}

          <p className="detail-keys">
            <kbd>Esc</kbd> 关闭
            {indexInList > 0 && (
              <>
                {' '}
                · <kbd>←</kbd> 上一条
              </>
            )}
            {indexInList >= 0 && indexInList < items.length - 1 && (
              <>
                {' '}
                · <kbd>→</kbd> 下一条
              </>
            )}
          </p>
        </div>

        {toast && <div className="toast">{toast}</div>}
      </div>
    </div>
  )
}
