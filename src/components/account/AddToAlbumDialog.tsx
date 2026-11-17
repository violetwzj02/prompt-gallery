import { useEffect, useState } from 'react'
import type { PromptItem } from '../../types'
import {
  ALBUM_CONNECT_FIRST,
  ALBUM_SCHEMA_UNAVAILABLE,
  AlbumSchemaError,
  createAlbumCategory,
  fetchAlbumCategories,
  fetchAlbumItemByPromptId,
  fetchAlbumSettings,
  fetchPromptCoverFile,
  insertAlbumItem,
  resolvePromptCoverUrl,
  type AlbumCategory,
  type AlbumItem,
} from '../../lib/album'
import {
  deleteDriveFile,
  normalizeImageMime,
  peekAccessToken,
  sanitizeUploadFilename,
  uploadDriveImage,
} from '../../lib/googleDrive'
import {
  ALBUM_PRESET_NAMES,
  isAlbumPreset,
  splitAlbumCategories,
  suggestAlbumPresets,
  validateAlbumCategoryName,
} from '../../utils/albumClassify'
import './album.css'

interface Props {
  item: PromptItem
  open: boolean
  onClose: () => void
  onAdded: (item: AlbumItem) => void
}

export function AddToAlbumDialog({ item, open, onClose, onAdded }: Props) {
  const [title, setTitle] = useState(item.title)
  const [auto, setAuto] = useState<string[]>([])
  const [custom, setCustom] = useState<string[]>([])
  const [customName, setCustomName] = useState('')
  const [categories, setCategories] = useState<AlbumCategory[]>([])
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [file, setFile] = useState<File | null>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setTitle(item.title)
    setCustom([])
    setCustomName('')
    setError(null)
    setFile(null)
    setLoading(true)
    const suggested = suggestAlbumPresets({
      title: item.title,
      filename: item.cover,
      promptCategory: item.category,
      tags: item.tags,
    })
    setAuto(suggested)
    const coverUrl = resolvePromptCoverUrl(item)
    setPreviewUrl(coverUrl)
    void (async () => {
      try {
        const existing = await fetchAlbumItemByPromptId(item.id)
        if (cancelled) return
        if (existing) {
          onAdded(existing)
          onClose()
          return
        }
        const [cats, packed] = await Promise.all([fetchAlbumCategories(), fetchPromptCoverFile(item)])
        if (cancelled) return
        setCategories(cats)
        setFile(packed.file)
      } catch (err) {
        if (cancelled) return
        if (err instanceof AlbumSchemaError) setError(ALBUM_SCHEMA_UNAVAILABLE)
        else setError(err instanceof Error ? err.message : '无法准备这张封面')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, item, onAdded, onClose])

  if (!open) return null

  const customs = categories.filter((category) => category.kind === 'custom')
  const toggle = (name: string) => {
    if (isAlbumPreset(name)) {
      setAuto((list) => (list.includes(name) ? list.filter((itemName) => itemName !== name) : [...list, name]))
      return
    }
    setCustom((list) => (list.includes(name) ? list.filter((itemName) => itemName !== name) : [...list, name]))
  }

  const save = async () => {
    const token = peekAccessToken()
    if (!token) {
      setError(ALBUM_CONNECT_FIRST)
      return
    }
    if (!file) {
      setError('这条风格没有可上传的封面图')
      return
    }
    setSaving(true)
    setError(null)
    let uploadedId: string | null = null
    try {
      const settings = await fetchAlbumSettings()
      const folderId = settings?.driveRootFolderId
      if (!folderId) throw new Error(ALBUM_CONNECT_FIRST)
      const split = splitAlbumCategories([...auto, ...custom])
      const existingNames = categories.map((category) => category.name)
      for (const name of split.custom) {
        if (existingNames.includes(name)) continue
        const created = await createAlbumCategory(name, existingNames)
        existingNames.push(created.name)
        setCategories((list) => [...list, created])
      }
      const mime = normalizeImageMime(file.type, file.name)
      if (!mime) throw new Error('仅支持 JPG、PNG、WebP 或 GIF 图片')
      const filename = sanitizeUploadFilename(title || item.title || item.id, mime)
      const uploaded = await uploadDriveImage(token, folderId, file, filename)
      uploadedId = uploaded.id
      const created = await insertAlbumItem({
        driveFileId: uploaded.id,
        title: title.trim() || item.title,
        source: 'generated',
        promptId: item.id,
        mimeType: uploaded.mimeType,
        sizeBytes: uploaded.size ?? file.size,
        autoCategories: split.auto,
        customCategories: split.custom,
      })
      onAdded(created)
      onClose()
    } catch (err) {
      if (uploadedId && peekAccessToken()) {
        try {
          await deleteDriveFile(peekAccessToken() as string, uploadedId)
        } catch {
          /* keep the save error */
        }
      }
      if (err instanceof AlbumSchemaError) setError(ALBUM_SCHEMA_UNAVAILABLE)
      else setError(err instanceof Error ? err.message : '加入云端相册失败，请稍后重试')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="album-lightbox" onClick={(event) => { event.stopPropagation(); onClose() }} role="presentation">
      <div
        className="album-lightbox__sheet"
        role="dialog"
        aria-modal
        aria-label="加入云端相册"
        onClick={(event) => event.stopPropagation()}
      >
        {previewUrl && (
          <div className="album-lightbox__media">
            <img src={previewUrl} alt="" />
          </div>
        )}
        <div className="album-lightbox__body">
          <div className="album-lightbox__top">
            <h3>加入云端相册</h3>
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              关闭
            </button>
          </div>
          <p className="album__hint">系统已根据这条风格给出建议标签，保存前可以修改。封面图将以「来自风格」写入相册。</p>
          <input
            type="text"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            aria-label="图片标题"
            disabled={loading || saving}
          />
          <div className="album-chip-row">
            {ALBUM_PRESET_NAMES.map((name) => (
              <button
                type="button"
                key={name}
                className={`album-chip is-preset ${auto.includes(name) ? 'is-active' : ''}`}
                onClick={() => toggle(name)}
              >
                {name}
              </button>
            ))}
            {customs.map((category) => (
              <button
                type="button"
                key={category.id}
                className={`album-chip ${custom.includes(category.name) ? 'is-active' : ''}`}
                onClick={() => toggle(category.name)}
              >
                {category.name}
              </button>
            ))}
            {custom
              .filter((name) => !customs.some((category) => category.name === name))
              .map((name) => (
                <button type="button" key={name} className="album-chip is-active" onClick={() => toggle(name)}>
                  {name}
                </button>
              ))}
          </div>
          <form
            className="album-newcat"
            onSubmit={(event) => {
              event.preventDefault()
              const validated = validateAlbumCategoryName(customName, [
                ...categories.map((category) => category.name),
                ...custom,
              ])
              if (!validated.ok) {
                setError(validated.error)
                return
              }
              if (isAlbumPreset(validated.name)) toggle(validated.name)
              else if (!custom.includes(validated.name)) setCustom((list) => [...list, validated.name])
              setCustomName('')
            }}
          >
            <input
              value={customName}
              onChange={(event) => setCustomName(event.target.value)}
              placeholder="添加自定义分类"
              maxLength={20}
              aria-label="自定义分类名称"
            />
            <button type="submit" className="btn btn-ghost">
              加上
            </button>
          </form>
          {loading && <p className="album__hint">正在准备封面…</p>}
          {error && <p className="album__error">{error}</p>}
          <div className="album__actions">
            <button type="button" className="btn btn-primary" disabled={loading || saving || !file} onClick={() => void save()}>
              {saving ? '正在加入…' : '确认加入'}
            </button>
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              取消
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

