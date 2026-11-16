import { useState, type FormEvent } from 'react'
import type { Category, PromptItem } from '../types'
import { CATEGORIES } from '../types'

interface Props {
  open: boolean
  onClose: () => void
  onAdd: (item: Omit<PromptItem, 'id' | 'categorySlug' | 'local'> & { id?: string }) => PromptItem
  onExport: () => void
}

export function AddStylePanel({ open, onClose, onAdd, onExport }: Props) {
  const [title, setTitle] = useState('')
  const [category, setCategory] = useState<Category>('艺术')
  const [usage, setUsage] = useState('')
  const [body, setBody] = useState('')
  const [source, setSource] = useState('')
  const [coverDataUrl, setCoverDataUrl] = useState<string | undefined>()
  const [msg, setMsg] = useState<string | null>(null)

  if (!open) return null

  const onFile = (file: File | null) => {
    if (!file) {
      setCoverDataUrl(undefined)
      return
    }
    if (file.size > 1.5 * 1024 * 1024) {
      setMsg('封面图请小于 1.5MB（会存入 localStorage）')
      return
    }
    const reader = new FileReader()
    reader.onload = () => setCoverDataUrl(String(reader.result))
    reader.readAsDataURL(file)
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!title.trim() || !body.trim()) {
      setMsg('标题与 Prompt 正文为必填')
      return
    }
    onAdd({
      title: title.trim(),
      category,
      usage: usage.trim() || `${category} · 自定义风格`,
      body: body.trim(),
      source: source.trim(),
      cover: null,
      coverDataUrl,
    })
    setMsg('已加入本地图鉴（可导出 JSON）')
    setTitle('')
    setUsage('')
    setBody('')
    setSource('')
    setCoverDataUrl(undefined)
  }

  return (
    <div className="add-overlay" onClick={onClose} role="presentation">
      <div className="add-panel" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal>
        <div className="add-header">
          <h2>添加风格</h2>
          <button type="button" className="detail-close" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>
        <p className="add-hint">
          本面板将条目写入浏览器 localStorage，便于快速预览。正式入库仍建议按原仓库流程修改{' '}
          <code>cat_*.md</code> 后重新解析。可随时「导出 prompts.json」下载合并结果。
        </p>
        <form className="add-form" onSubmit={submit}>
          <label>
            标题 *
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="风格名称" />
          </label>
          <label>
            大类 *
            <select value={category} onChange={(e) => setCategory(e.target.value as Category)}>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label>
            用途摘要
            <input
              value={usage}
              onChange={(e) => setUsage(e.target.value)}
              placeholder="用途 / 风格 / 适用场景"
            />
          </label>
          <label>
            来源（可选）
            <input value={source} onChange={(e) => setSource(e.target.value)} placeholder="原文件名等" />
          </label>
          <label>
            Prompt 正文 *
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={10}
              placeholder="支持 Markdown；可写 **提示词**：后跟主体描述"
            />
          </label>
          <label>
            封面图（可选，本地上传 → base64）
            <input
              type="file"
              accept="image/*"
              onChange={(e) => onFile(e.target.files?.[0] ?? null)}
            />
          </label>
          {coverDataUrl && (
            <img src={coverDataUrl} alt="封面预览" className="add-preview" />
          )}
          <div className="add-actions">
            <button type="submit" className="btn btn-primary">
              加入图鉴
            </button>
            <button type="button" className="btn btn-ghost" onClick={onExport}>
              导出 prompts.json
            </button>
          </div>
          {msg && <p className="add-msg">{msg}</p>}
        </form>
      </div>
    </div>
  )
}
