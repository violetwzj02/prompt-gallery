import { useMemo, useState, type FormEvent, type ReactNode } from 'react'
import type { Category, CollectionInfo } from '../types'
import { CATEGORIES, CATEGORY_ACCENT } from '../types'
import type { FavoriteFolder } from '../hooks/useFavorites'
import { DEFAULT_FOLDER_NAME } from '../hooks/useFavorites'
import { folderScopeMatches } from '../lib/localStore'
import { useRailSections, type RailSectionId } from '../hooks/useRailSections'
import type { GalleryFilters } from '../utils/filters'
import { toggleIn } from '../utils/filters'

interface Counts {
  category: Record<string, number>
  collection: Record<string, number>
  medium: Record<string, number>
  aspect: Record<string, number>
  style: Record<string, number>
  favoriteAll: number
  favoriteByFolder: Record<string, number>
  likedAll: number
}

interface Props {
  filters: GalleryFilters
  onChange: (next: GalleryFilters) => void
  onClear: () => void
  counts: Counts
  collections: CollectionInfo[]
  mediums: string[]
  aspects: string[]
  styles: string[]
  active: boolean
  onCloseMobile?: () => void
  folders: FavoriteFolder[]
  defaultFolderId: string
  accountSynced?: boolean
  onCreateFolder: (name: string) => FavoriteFolder | null | Promise<FavoriteFolder | null>
  onRenameFolder: (id: string, name: string) => boolean | Promise<boolean>
  onDeleteFolder: (id: string) => boolean | Promise<boolean>
}

function compactHint(names: string[]): string | null {
  const clean = names.filter(Boolean)
  if (clean.length === 0) return null
  if (clean.length === 1) return clean[0]
  return `${clean[0]} · +${clean.length - 1}`
}

function Row({
  label,
  count,
  active,
  onClick,
  swatch,
  trailing,
}: {
  label: string
  count?: number
  active: boolean
  onClick: () => void
  swatch?: string
  trailing?: ReactNode
}) {
  return (
    <div className={`rail-row-wrap ${active ? 'is-active' : ''}`}>
      <button type="button" className={`rail-row ${active ? 'is-active' : ''}`} onClick={onClick}>
        <span className="rail-row__label">
          {swatch && <i className="rail-dot" style={{ background: swatch }} aria-hidden />}
          {label}
        </span>
        {typeof count === 'number' && <span className="rail-row__count">{count}</span>}
      </button>
      {trailing}
    </div>
  )
}

function RailDrawer({
  id,
  title,
  open,
  onToggle,
  hint,
  children,
}: {
  id: RailSectionId
  title: string
  open: boolean
  onToggle: (id: RailSectionId) => void
  hint?: string | null
  children: ReactNode
}) {
  return (
    <section className="rail-section">
      <button
        type="button"
        className="rail-section-toggle"
        aria-expanded={open}
        aria-controls={`rail-panel-${id}`}
        onClick={() => onToggle(id)}
      >
        <h2 className="rail-heading">{title}</h2>
        {!open && hint ? <span className="rail-heading-hint">{hint}</span> : null}
        <span className={`rail-chevron ${open ? 'is-open' : ''}`} aria-hidden />
      </button>
      {open && (
        <div className="rail-section-body" id={`rail-panel-${id}`}>
          {children}
        </div>
      )}
    </section>
  )
}

export function FilterRail({
  filters,
  onChange,
  onClear,
  counts,
  collections,
  mediums,
  aspects,
  styles,
  active,
  onCloseMobile,
  folders,
  defaultFolderId,
  accountSynced = false,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
}: Props) {
  const visibleCollections = collections.filter(
    (c) => (counts.collection[c.id] ?? 0) > 0 || filters.collectionId === c.id,
  )

  const activeSections = useMemo(
    () => ({
      category: filters.category !== '全部',
      collection: Boolean(filters.collectionId),
      medium: filters.mediums.length > 0,
      aspect: filters.aspects.length > 0,
      style: filters.styles.length > 0,
      likes: filters.likedOnly,
      favorites: Boolean(filters.favoriteScope),
    }),
    [
      filters.category,
      filters.collectionId,
      filters.mediums,
      filters.aspects,
      filters.styles,
      filters.likedOnly,
      filters.favoriteScope,
    ],
  )

  const { isOpen, toggle } = useRailSections(activeSections)

  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')

  const collectionHint = compactHint(
    visibleCollections.filter((c) => c.id === filters.collectionId).map((c) => c.name),
  )
  const favoriteHint =
    filters.favoriteScope === 'all'
      ? '全部收藏'
      : compactHint(
          folders
            .filter((f) => folderScopeMatches(filters.favoriteScope, f.id, defaultFolderId))
            .map((f) => f.name),
        )

  const submitCreate = async (e: FormEvent) => {
    e.preventDefault()
    const created = await onCreateFolder(newName)
    if (created) {
      setNewName('')
      setCreating(false)
    }
  }

  const submitRename = async (e: FormEvent) => {
    e.preventDefault()
    if (renamingId && (await onRenameFolder(renamingId, renameValue))) {
      setRenamingId(null)
      setRenameValue('')
    }
  }

  const confirmDelete = async (folder: FavoriteFolder) => {
    if (folder.id === defaultFolderId) return
    const defaultName = folders.find((f) => f.id === defaultFolderId)?.name ?? DEFAULT_FOLDER_NAME
    const ok = window.confirm(`删除收藏夹「${folder.name}」？其中的条目会移到「${defaultName}」。`)
    if (!ok) return
    if ((await onDeleteFolder(folder.id)) && filters.favoriteScope === folder.id) {
      onChange({ ...filters, favoriteScope: 'all' })
    }
  }

  const selectFavoriteScope = (scope: string) => {
    onChange({
      ...filters,
      favoriteScope: filters.favoriteScope === scope ? null : scope,
    })
  }

  return (
    <aside className={`rail ${active ? 'is-open' : ''}`} aria-label="筛选">
      <div className="rail-mobile-head">
        <span>筛选</span>
        {onCloseMobile && (
          <button type="button" className="icon-btn" onClick={onCloseMobile} aria-label="关闭筛选">
            ×
          </button>
        )}
      </div>

      <RailDrawer
        id="category"
        title="大类"
        open={isOpen('category')}
        onToggle={toggle}
        hint={filters.category !== '全部' ? filters.category : null}
      >
        <Row
          label="全部"
          count={counts.category['全部'] ?? 0}
          active={filters.category === '全部'}
          onClick={() => onChange({ ...filters, category: '全部' })}
        />
        {CATEGORIES.map((c) => (
          <Row
            key={c}
            label={c}
            count={counts.category[c] ?? 0}
            active={filters.category === c}
            swatch={CATEGORY_ACCENT[c]}
            onClick={() =>
              onChange({
                ...filters,
                category: c,
                collectionId:
                  filters.collectionId &&
                  collections.find((col) => col.id === filters.collectionId)?.category !== c
                    ? null
                    : filters.collectionId,
              })
            }
          />
        ))}
      </RailDrawer>

      {visibleCollections.length > 0 && (
        <RailDrawer
          id="collection"
          title="合集"
          open={isOpen('collection')}
          onToggle={toggle}
          hint={collectionHint}
        >
          <Row
            label="全部合集"
            count={visibleCollections.reduce((s, c) => s + (counts.collection[c.id] ?? 0), 0)}
            active={filters.collectionId === null}
            onClick={() => onChange({ ...filters, collectionId: null })}
          />
          {visibleCollections.map((c) => (
            <Row
              key={c.id}
              label={c.name}
              count={counts.collection[c.id] ?? 0}
              active={filters.collectionId === c.id}
              onClick={() =>
                onChange({
                  ...filters,
                  collectionId: filters.collectionId === c.id ? null : c.id,
                  category: c.category as Category,
                })
              }
            />
          ))}
        </RailDrawer>
      )}

      {mediums.length > 0 && (
        <RailDrawer
          id="medium"
          title="媒介"
          open={isOpen('medium')}
          onToggle={toggle}
          hint={compactHint(filters.mediums)}
        >
          {mediums.map((m) => (
            <Row
              key={m}
              label={m}
              count={counts.medium[m] ?? 0}
              active={filters.mediums.includes(m)}
              onClick={() => onChange({ ...filters, mediums: toggleIn(filters.mediums, m) })}
            />
          ))}
        </RailDrawer>
      )}

      {aspects.length > 0 && (
        <RailDrawer
          id="aspect"
          title="画幅"
          open={isOpen('aspect')}
          onToggle={toggle}
          hint={compactHint(filters.aspects)}
        >
          {aspects.map((a) => (
            <Row
              key={a}
              label={a}
              count={counts.aspect[a] ?? 0}
              active={filters.aspects.includes(a)}
              onClick={() => onChange({ ...filters, aspects: toggleIn(filters.aspects, a) })}
            />
          ))}
        </RailDrawer>
      )}

      {styles.length > 0 && (
        <RailDrawer
          id="style"
          title="风格 / 用途"
          open={isOpen('style')}
          onToggle={toggle}
          hint={compactHint(filters.styles)}
        >
          {styles.map((s) => (
            <Row
              key={s}
              label={s}
              count={counts.style[s] ?? 0}
              active={filters.styles.includes(s)}
              onClick={() => onChange({ ...filters, styles: toggleIn(filters.styles, s) })}
            />
          ))}
        </RailDrawer>
      )}

      <RailDrawer
        id="likes"
        title="喜欢"
        open={isOpen('likes')}
        onToggle={toggle}
        hint={filters.likedOnly ? '已喜欢' : null}
      >
        <Row
          label="已喜欢"
          count={counts.likedAll}
          active={filters.likedOnly}
          onClick={() => onChange({ ...filters, likedOnly: !filters.likedOnly })}
        />
      </RailDrawer>

      <RailDrawer
        id="favorites"
        title="收藏"
        open={isOpen('favorites')}
        onToggle={toggle}
        hint={favoriteHint}
      >
        <Row
          label="全部收藏"
          count={counts.favoriteAll}
          active={filters.favoriteScope === 'all'}
          onClick={() => selectFavoriteScope('all')}
        />
        {folders.map((folder) =>
          renamingId === folder.id ? (
            <form key={folder.id} className="rail-inline-form rail-inline-form--block" onSubmit={submitRename}>
              <input
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                aria-label="收藏夹名称"
                autoFocus
              />
              <button type="submit" className="rail-icon-btn">
                保存
              </button>
              <button
                type="button"
                className="rail-icon-btn"
                onClick={() => {
                  setRenamingId(null)
                  setRenameValue('')
                }}
              >
                取消
              </button>
            </form>
          ) : (
            <Row
              key={folder.id}
              label={folder.name}
              count={counts.favoriteByFolder[folder.id] ?? 0}
              active={folderScopeMatches(filters.favoriteScope, folder.id, defaultFolderId)}
              onClick={() => selectFavoriteScope(folder.id)}
              trailing={
                <span className="rail-folder-actions">
                  <button
                    type="button"
                    className="rail-icon-btn"
                    aria-label={`重命名 ${folder.name}`}
                    onClick={() => {
                      setRenamingId(folder.id)
                      setRenameValue(folder.name)
                      setCreating(false)
                    }}
                  >
                    重命名
                  </button>
                  {folder.id !== defaultFolderId && (
                    <button
                      type="button"
                      className="rail-icon-btn rail-icon-btn--danger"
                      aria-label={`删除 ${folder.name}`}
                      onClick={() => confirmDelete(folder)}
                    >
                      删除
                    </button>
                  )}
                </span>
              }
            />
          ),
        )}
        {creating ? (
          <form className="rail-inline-form rail-inline-form--block" onSubmit={submitCreate}>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="收藏夹名称"
              aria-label="新收藏夹名称"
              autoFocus
            />
            <button type="submit" className="rail-icon-btn">
              创建
            </button>
            <button
              type="button"
              className="rail-icon-btn"
              onClick={() => {
                setCreating(false)
                setNewName('')
              }}
            >
              取消
            </button>
          </form>
        ) : (
          <button
            type="button"
            className="rail-row rail-row--action"
            onClick={() => {
              setCreating(true)
              setRenamingId(null)
            }}
          >
            <span className="rail-row__label">新建收藏夹</span>
          </button>
        )}
      </RailDrawer>

      <p className="rail-note">
        大类、合集为单选。媒介与画幅在组内为「或」，风格标签之间为「且」。
        {accountSynced
          ? '已登录时，喜欢与收藏夹会同步到账号，可在其他浏览器查看。'
          : '未登录时，喜欢与收藏夹仅保存在本机浏览器。登录后可同步到账号。'}
      </p>

      <button type="button" className="rail-clear" onClick={onClear}>
        清除全部筛选
      </button>
    </aside>
  )
}
