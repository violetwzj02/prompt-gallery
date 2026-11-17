import { useEffect, useRef, useState, type CSSProperties } from 'react'
import ReactMarkdown from 'react-markdown'
import type { PromptItem } from '../types'
import { categoryAccent } from '../utils/category'
import type { FavoriteFolder } from '../hooks/useFavorites'
import { DEFAULT_FOLDER_ID, DEFAULT_FOLDER_NAME } from '../hooks/useFavorites'
import { extractPurePrompt } from '../utils/promptExtract'
import { canRemoveStyle, styleOriginLabel } from '../utils/styleOrigin'
import { CoverArt } from './CoverArt'

interface Props {
  item: PromptItem
  items: PromptItem[]
  siblings: PromptItem[]
  onClose: () => void
  onSelect: (item: PromptItem) => void
  onTag: (tag: string) => void
  onOpenCollection?: (parentId: string) => void
  onRemoveLocal?: (id: string) => void | Promise<void>
  liked?: boolean
  onToggleLike?: (itemId: string) => void
  favorited?: boolean
  favoriteFolderId?: string | null
  folders?: FavoriteFolder[]
  onAddFavorite?: (itemId: string, folderId: string) => void
  onRemoveFavorite?: (itemId: string) => void
  onCreateFolder?: (name: string) => FavoriteFolder | null | Promise<FavoriteFolder | null>
  viewerId?: string | null
}

function HeartIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
    </svg>
  )
}

function BookmarkIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path d="M6.5 3h11A1.5 1.5 0 0 1 19 4.5v16.2l-7-3.7-7 3.7V4.5A1.5 1.5 0 0 1 6.5 3z" />
    </svg>
  )
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
  liked = false,
  onToggleLike,
  favorited = false,
  favoriteFolderId = null,
  folders = [],
  onAddFavorite,
  onRemoveFavorite,
  onCreateFolder,
  viewerId = null,
}: Props) {
  const [toast, setToast] = useState<string | null>(null)
  const [favOpen, setFavOpen] = useState(false)
  const [newFolder, setNewFolder] = useState('')
  const favWrapRef = useRef<HTMLDivElement>(null)
  const accent = categoryAccent(item.category)
  const indexInList = items.findIndex((i) => i.id === item.id)
  const originLabel = styleOriginLabel(item, viewerId)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (favOpen) {
          setFavOpen(false)
          return
        }
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
  }, [onClose, onSelect, items, indexInList, favOpen])

  useEffect(() => {
    setFavOpen(false)
    setNewFolder('')
  }, [item.id])

  useEffect(() => {
    if (!favOpen) return
    const onDoc = (e: MouseEvent) => {
      if (favWrapRef.current && !favWrapRef.current.contains(e.target as Node)) {
        setFavOpen(false)
      }
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [favOpen])

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

  const pickFolder = (folderId: string) => {
    onAddFavorite?.(item.id, folderId)
    setFavOpen(false)
    setToast('已加入收藏')
  }

  const submitNewFolder = async () => {
    const created = await onCreateFolder?.(newFolder)
    if (!created) {
      setToast('请输入收藏夹名称')
      return
    }
    onAddFavorite?.(item.id, created.id)
    setNewFolder('')
    setFavOpen(false)
    setToast(`已收藏到「${created.name}」`)
  }

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
          <CoverArt item={item} large fit="contain" className="detail-cover" />
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
            {originLabel && <span className="pill pill--local">{originLabel}</span>}
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
            {onToggleLike && (
              <button
                type="button"
                className={`btn btn-ghost btn-with-icon ${liked ? 'is-liked' : ''}`}
                aria-pressed={liked}
                onClick={() => {
                  onToggleLike(item.id)
                  setToast(liked ? '已取消喜欢' : '已喜欢')
                }}
              >
                <HeartIcon />
                {liked ? '已喜欢' : '喜欢'}
              </button>
            )}
            {onAddFavorite && (
              <div className="fav-control" ref={favWrapRef}>
                <button
                  type="button"
                  className={`btn btn-ghost btn-with-icon ${favorited ? 'is-fav' : ''}`}
                  aria-expanded={favOpen}
                  aria-haspopup="menu"
                  onClick={() => setFavOpen((v) => !v)}
                >
                  <BookmarkIcon />
                  {favorited ? '已收藏' : '收藏'}
                </button>
                {favOpen && (
                  <div className="fav-menu" role="menu">
                    <p className="fav-menu__label">收藏到</p>
                    {(folders.length ? folders : [{ id: DEFAULT_FOLDER_ID, name: DEFAULT_FOLDER_NAME }]).map((f) => (
                      <button
                        type="button"
                        role="menuitem"
                        key={f.id}
                        className={favorited && favoriteFolderId === f.id ? 'is-active' : ''}
                        onClick={() => pickFolder(f.id)}
                      >
                        {f.name}
                      </button>
                    ))}
                    {onCreateFolder && (
                      <form
                        className="fav-menu__new"
                        onSubmit={(e) => {
                          e.preventDefault()
                          submitNewFolder()
                        }}
                      >
                        <input
                          value={newFolder}
                          onChange={(e) => setNewFolder(e.target.value)}
                          placeholder="新建收藏夹"
                          aria-label="新建收藏夹名称"
                        />
                        <button type="submit" className="btn btn-ghost">
                          创建
                        </button>
                      </form>
                    )}
                    {favorited && onRemoveFavorite && (
                      <button
                        type="button"
                        role="menuitem"
                        className="fav-menu__remove"
                        onClick={() => {
                          onRemoveFavorite(item.id)
                          setFavOpen(false)
                          setToast('已取消收藏')
                        }}
                      >
                        取消收藏
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
            {canRemoveStyle(item, viewerId) && onRemoveLocal && (
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => {
                  if (item.ownerId) {
                    const ok = window.confirm('删除后，这条风格将从公共库中移除。确定删除？')
                    if (!ok) return
                  }
                  void onRemoveLocal(item.id)
                  onClose()
                }}
              >
                {item.ownerId ? '删除此风格' : '删除本地条目'}
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
