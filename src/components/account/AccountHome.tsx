import { useMemo, useState, type FormEvent } from 'react'
import type { PromptItem } from '../../types'
import type { FavoriteFolder } from '../../hooks/useFavorites'
import { DEFAULT_FOLDER_NAME } from '../../hooks/useFavorites'
import type { ProfileState } from '../../hooks/useProfile'
import type { User } from '@supabase/supabase-js'
import { formatMemberSince } from '../../lib/profile'
import { folderScopeMatches } from '../../lib/localStore'
import type { AccountHomeTab, AccountRoute } from '../../utils/accountRoutes'
import { toAccountHash, replaceHash } from '../../utils/accountRoutes'
import { Avatar } from '../Avatar'
import { PromptCard } from '../PromptCard'

interface FavoritesApi {
  folders: FavoriteFolder[]
  items: Record<string, string>
  defaultFolderId: string
  isFavorited: (id: string) => boolean
  toggle: (id: string) => void
  createFolder: (name: string) => FavoriteFolder | null | Promise<FavoriteFolder | null>
  renameFolder: (id: string, name: string) => boolean | Promise<boolean>
  deleteFolder: (id: string) => boolean | Promise<boolean>
}

interface LikesApi {
  idSet: ReadonlySet<string>
  isLiked: (id: string) => boolean
  toggle: (id: string) => void
}

interface Props {
  user: User
  profileState: ProfileState
  items: PromptItem[]
  route: AccountRoute
  likes: LikesApi
  favorites: FavoritesApi
  onOpenItem: (item: PromptItem) => void
}

export function worksOf(items: PromptItem[], userId: string | null): PromptItem[] {
  if (!userId) return []
  return items.filter((it) => it.ownerId === userId || Boolean(it.local))
}

export function likedOf(items: PromptItem[], likedIds: ReadonlySet<string>): PromptItem[] {
  return items.filter((it) => likedIds.has(it.id))
}

export function favoritedOf(
  items: PromptItem[],
  favoriteOf: Record<string, string>,
  folderId: string | null,
  defaultFolderId: string,
): PromptItem[] {
  return items.filter((it) => {
    const folder = favoriteOf[it.id]
    if (!folder) return false
    if (!folderId || folderId === 'all') return true
    return folderScopeMatches(folderId, folder, defaultFolderId)
  })
}

export function AccountHome({
  user,
  profileState,
  items,
  route,
  likes,
  favorites,
  onOpenItem,
}: Props) {
  const email = profileState.profile?.email || user.email || ''
  const displayName = profileState.profile?.displayName
  const bio = profileState.profile?.bio
  const createdAt = profileState.profile?.createdAt || user.created_at
  const userId = user.id
  const tab = route.tab

  const works = useMemo(() => worksOf(items, userId), [items, userId])
  const liked = useMemo(() => likedOf(items, likes.idSet), [items, likes.idSet])
  const folderId = tab === 'favorites' ? route.folderId : null
  const favorited = useMemo(
    () => favoritedOf(items, favorites.items, folderId, favorites.defaultFolderId),
    [items, favorites.items, folderId, favorites.defaultFolderId],
  )

  const shown = tab === 'likes' ? liked : tab === 'favorites' ? favorited : works
  const emptyCopy =
    tab === 'likes'
      ? '还没有喜欢的风格。点击卡片右上角的心形即可标记为喜欢。'
      : tab === 'favorites'
        ? folderId && folderId !== 'all'
          ? `「${favorites.folders.find((f) => f.id === folderId)?.name ?? '该收藏夹'}」还是空的。可将条目收藏到此夹，或先在卡片上点亮书签。`
          : '还没有收藏。点击卡片右上角的书签即可加入收藏夹。'
        : '还没有上传的风格作品。可在右上角使用「添加风格」。'

  const setTab = (next: AccountHomeTab) => {
    replaceHash(toAccountHash({ view: 'home', tab: next, itemId: null, folderId: next === 'favorites' ? route.folderId : null }))
  }

  const setFolder = (next: string | null) => {
    const current = route.folderId || 'all'
    const target = next ?? 'all'
    replaceHash(
      toAccountHash({
        view: 'home',
        tab: 'favorites',
        itemId: null,
        folderId: current === target || target === 'all' ? (current === target ? null : target === 'all' ? null : target) : target,
      }),
    )
  }

  const selectFolder = (scope: string) => {
    const current = route.folderId || 'all'
    const next = current === scope ? 'all' : scope
    replaceHash(toAccountHash({ view: 'home', tab: 'favorites', itemId: null, folderId: next === 'all' ? null : next }))
  }

  return (
    <div className="account-home">
      <section className="account-profile">
        <Avatar name={displayName} email={email} src={profileState.profile?.avatarUrl} size="lg" />
        <div className="account-profile__text">
          <h2>{displayName?.trim() || email || '我的主页'}</h2>
          {displayName && email ? <p className="account-profile__email">{email}</p> : null}
          {bio ? <p className="account-profile__bio">{bio}</p> : null}
          <p className="account-muted">{formatMemberSince(createdAt)}</p>
        </div>
      </section>

      <div className="account-tabs" role="tablist" aria-label="个人内容">
        <TabButton id="works" label={`作品 ${works.length}`} active={tab === 'works'} onClick={() => setTab('works')} />
        <TabButton id="likes" label={`喜欢 ${liked.length}`} active={tab === 'likes'} onClick={() => setTab('likes')} />
        <TabButton
          id="favorites"
          label={`收藏 ${favoritedOf(items, favorites.items, null, favorites.defaultFolderId).length}`}
          active={tab === 'favorites'}
          onClick={() => setTab('favorites')}
        />
      </div>

      {tab === 'favorites' && (
        <FolderBar
          folders={favorites.folders}
          defaultFolderId={favorites.defaultFolderId}
          items={favorites.items}
          catalog={items}
          activeScope={route.folderId || 'all'}
          onSelect={selectFolder}
          onCreate={favorites.createFolder}
          onRename={favorites.renameFolder}
          onDelete={async (id) => {
            const ok = await favorites.deleteFolder(id)
            if (ok && route.folderId === id) setFolder('all')
            return ok
          }}
        />
      )}

      {shown.length === 0 ? (
        <div className="state state-empty">
          <p>{emptyCopy}</p>
        </div>
      ) : (
        <div className="grid grid--comfortable">
          {shown.map((it) => (
            <PromptCard
              key={it.id}
              item={it}
              onOpen={onOpenItem}
              liked={likes.isLiked(it.id)}
              onToggleLike={(item) => likes.toggle(item.id)}
              favorited={favorites.isFavorited(it.id)}
              onToggleFavorite={(item) => favorites.toggle(item.id)}
              viewerId={userId}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function TabButton({
  id,
  label,
  active,
  onClick,
}: {
  id: string
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      role="tab"
      id={`account-tab-${id}`}
      aria-selected={active}
      className={`account-tab ${active ? 'is-active' : ''}`}
      onClick={onClick}
    >
      {label}
    </button>
  )
}

function FolderBar({
  folders,
  defaultFolderId,
  items,
  catalog,
  activeScope,
  onSelect,
  onCreate,
  onRename,
  onDelete,
}: {
  folders: FavoriteFolder[]
  defaultFolderId: string
  items: Record<string, string>
  catalog: PromptItem[]
  activeScope: string
  onSelect: (scope: string) => void
  onCreate: (name: string) => FavoriteFolder | null | Promise<FavoriteFolder | null>
  onRename: (id: string, name: string) => boolean | Promise<boolean>
  onDelete: (id: string) => boolean | Promise<boolean>
}) {
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')

  const counts = useMemo(() => {
    const live = new Set(catalog.map((it) => it.id))
    let all = 0
    const byFolder: Record<string, number> = {}
    for (const folder of folders) byFolder[folder.id] = 0
    for (const [itemId, folderId] of Object.entries(items)) {
      if (!live.has(itemId)) continue
      all += 1
      byFolder[folderId] = (byFolder[folderId] ?? 0) + 1
    }
    return { all, byFolder }
  }, [catalog, folders, items])

  const submitCreate = async (e: FormEvent) => {
    e.preventDefault()
    const created = await onCreate(newName)
    if (created) {
      setNewName('')
      setCreating(false)
    }
  }

  const submitRename = async (e: FormEvent) => {
    e.preventDefault()
    if (renamingId && (await onRename(renamingId, renameValue))) {
      setRenamingId(null)
      setRenameValue('')
    }
  }

  const confirmDelete = async (folder: FavoriteFolder) => {
    if (folder.id === defaultFolderId) return
    const defaultName = folders.find((f) => f.id === defaultFolderId)?.name ?? DEFAULT_FOLDER_NAME
    const ok = window.confirm(`删除收藏夹「${folder.name}」？其中的条目会移到「${defaultName}」。`)
    if (!ok) return
    await onDelete(folder.id)
  }

  return (
    <div className="account-folders">
      <button
        type="button"
        className={`account-folder ${activeScope === 'all' ? 'is-active' : ''}`}
        onClick={() => onSelect('all')}
      >
        全部收藏
        <span>{counts.all}</span>
      </button>
      {folders.map((folder) =>
        renamingId === folder.id ? (
          <form key={folder.id} className="account-folder-form" onSubmit={(e) => void submitRename(e)}>
            <input value={renameValue} onChange={(e) => setRenameValue(e.target.value)} aria-label="收藏夹名称" autoFocus />
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
          <div key={folder.id} className={`account-folder-wrap ${activeScope === folder.id ? 'is-active' : ''}`}>
            <button
              type="button"
              className={`account-folder ${activeScope === folder.id ? 'is-active' : ''}`}
              onClick={() => onSelect(folder.id)}
            >
              {folder.name}
              <span>{counts.byFolder[folder.id] ?? 0}</span>
            </button>
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
                onClick={() => void confirmDelete(folder)}
              >
                删除
              </button>
            )}
          </div>
        ),
      )}
      {creating ? (
        <form className="account-folder-form" onSubmit={(e) => void submitCreate(e)}>
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
          className="account-folder account-folder--action"
          onClick={() => {
            setCreating(true)
            setRenamingId(null)
          }}
        >
          新建收藏夹
        </button>
      )}
    </div>
  )
}
