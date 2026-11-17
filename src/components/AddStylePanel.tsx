import { useMemo, useState, type FormEvent } from 'react'
import type { Medium, PromptItem } from '../types'
import { MEDIUMS } from '../types'
import { ADD_STYLE_CATEGORIES, validateCategoryName } from '../utils/category'

const NEW_CATEGORY_VALUE = '__new__'

interface Props {
  open: boolean
  onClose: () => void
  onAdd: (
    item: Omit<PromptItem, 'id' | 'categorySlug' | 'local' | 'ownerId'> & { id?: string },
  ) => PromptItem | Promise<PromptItem>
  onExport: () => void
  synced?: boolean
  customCategories: string[]
}

export function AddStylePanel({
  open,
  onClose,
  onAdd,
  onExport,
  synced = false,
  customCategories,
}: Props) {
  const [title, setTitle] = useState('')
  const [categoryChoice, setCategoryChoice] = useState('')
  const [newCategoryName, setNewCategoryName] = useState('')
  const [usage, setUsage] = useState('')
  const [body, setBody] = useState('')
  const [source, setSource] = useState('')
  const [collection, setCollection] = useState('')
  const [tags, setTags] = useState('')
  const [medium, setMedium] = useState<Medium>('图像')
  const [aspect, setAspect] = useState('')
  const [coverDataUrl, setCoverDataUrl] = useState<string | undefined>()
  const [msg, setMsg] = useState<string | null>(null)

  const existingCategories = useMemo(
    () => [...ADD_STYLE_CATEGORIES, ...customCategories.filter((name) => !ADD_STYLE_CATEGORIES.includes(name))],
    [customCategories],
  )

  if (!open) return null

  const onFile = (file: File | null) => {
    if (!file) {
      setCoverDataUrl(undefined)
      return
    }
    if (file.size > 1.5 * 1024 * 1024) {
      setMsg(synced ? '封面图请小于 1.5MB' : '封面图请小于 1.5MB（会存入 localStorage）')
      return
    }
    const reader = new FileReader()
    reader.onload = () => setCoverDataUrl(String(reader.result))
    reader.readAsDataURL(file)
  }

  const resolveCategory = (): { ok: true; name: string } | { ok: false; error: string } => {
    if (!categoryChoice) return { ok: false, error: '请选择或新建大类' }
    if (categoryChoice !== NEW_CATEGORY_VALUE) return { ok: true, name: categoryChoice }
    return validateCategoryName(newCategoryName, existingCategories)
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!title.trim() || !body.trim()) {
      setMsg('标题与 Prompt 正文为必填')
      return
    }
    const resolved = resolveCategory()
    if (!resolved.ok) {
      setMsg(resolved.error)
      return
    }
    const category = resolved.name
    const tagList = tags
      .split(/[,，]/)
      .map((t) => t.trim())
      .filter(Boolean)
    const col = collection.trim() || null
    await onAdd({
      title: title.trim(),
      category,
      usage: usage.trim() || `${category} · 自定义风格`,
      body: body.trim(),
      source: source.trim(),
      cover: null,
      coverDataUrl,
      parentId: null,
      collection: col,
      collectionIndex: null,
      collectionTotal: null,
      tags: Array.from(new Set([category, medium, ...(aspect.trim() ? [aspect.trim()] : []), ...(col ? [col] : []), ...tagList])),
      medium,
      aspect: aspect.trim() || null,
      promptText: body.trim(),
      duplicateNote: null,
      duplicateOf: null,
    })
    setMsg(synced ? '已加入图鉴，并作为本库风格同步到账号' : '已加入本地图鉴（可导出 JSON）')
    setTitle('')
    setCategoryChoice('')
    setNewCategoryName('')
    setUsage('')
    setBody('')
    setSource('')
    setCollection('')
    setTags('')
    setAspect('')
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
          {synced
            ? '登录后，新风格会加入公共图鉴，其他访客也可以看到；同时会在本机保留一份副本。内置风格仍建议按原仓库流程修改 '
            : '本面板将条目写入浏览器 localStorage，便于快速预览。正式入库仍建议按原仓库流程修改 '}
          <code>cat_*.md</code> 后运行 <code>npm run parse</code>。可随时导出 JSON。
        </p>
        <form className="add-form" onSubmit={submit}>
          <label>
            标题 *
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="风格名称" />
          </label>
          <div className="add-row">
            <label>
              大类 *
              <select value={categoryChoice} onChange={(e) => setCategoryChoice(e.target.value)}>
                <option value="">请选择或新建大类</option>
                {existingCategories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
                <option value={NEW_CATEGORY_VALUE}>新建大类…</option>
              </select>
            </label>
            <label>
              媒介
              <select value={medium} onChange={(e) => setMedium(e.target.value as Medium)}>
                {MEDIUMS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {categoryChoice === NEW_CATEGORY_VALUE && (
            <label>
              新大类名称 *
              <input
                value={newCategoryName}
                onChange={(e) => setNewCategoryName(e.target.value)}
                placeholder="例如：赛博朋克"
                maxLength={20}
                required
              />
            </label>
          )}
          <div className="add-row">
            <label>
              合集（可选）
              <input
                value={collection}
                onChange={(e) => setCollection(e.target.value)}
                placeholder="如：仙侠人物特效"
              />
            </label>
            <label>
              画幅（可选）
              <input
                value={aspect}
                onChange={(e) => setAspect(e.target.value)}
                placeholder="16:9 / 9:16 / 3:4"
              />
            </label>
          </div>
          <label>
            标签（可选，逗号分隔）
            <input
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="人像, Midjourney, 海报"
            />
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
          {coverDataUrl && <img src={coverDataUrl} alt="封面预览" className="add-preview" />}
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
