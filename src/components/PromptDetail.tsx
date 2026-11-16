import { useEffect, useState, type CSSProperties } from 'react'
import ReactMarkdown from 'react-markdown'
import type { PromptItem } from '../types'
import { CATEGORY_ACCENT } from '../types'
import { extractPurePrompt } from '../utils/promptExtract'
import { CoverArt } from './CoverArt'

interface Props {
  item: PromptItem
  onClose: () => void
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

export function PromptDetail({ item, onClose, onRemoveLocal }: Props) {
  const [toast, setToast] = useState<string | null>(null)
  const accent = CATEGORY_ACCENT[item.category]

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [onClose])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 1800)
    return () => clearTimeout(t)
  }, [toast])

  const flash = async (label: string, text: string) => {
    const ok = await copyText(text)
    setToast(ok ? label : '复制失败')
  }

  return (
    <div className="detail-overlay" onClick={onClose} role="presentation">
      <div
        className="detail-panel"
        style={{ '--card-accent': accent } as CSSProperties}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal
        aria-label={item.title}
      >
        <button type="button" className="detail-close" onClick={onClose} aria-label="关闭">
          ×
        </button>

        <CoverArt item={item} large className="detail-cover" />

        <div className="detail-content">
          <div className="detail-meta">
            <span className="tag" style={{ color: accent, borderColor: `${accent}55` }}>
              {item.category}
            </span>
            <span className="detail-id">{item.id}</span>
            {item.source && <span className="detail-source">原 {item.source}</span>}
            {item.local && <span className="tag tag--local">本地新增</span>}
          </div>
          <h2 className="detail-title">{item.title}</h2>
          <p className="detail-usage">{item.usage}</p>

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
              onClick={() => flash('已复制纯提示词', extractPurePrompt(item.body))}
            >
              复制纯提示词
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

          <div className="detail-md">
            <ReactMarkdown>{item.body}</ReactMarkdown>
          </div>
        </div>

        {toast && <div className="toast">{toast}</div>}
      </div>
    </div>
  )
}
