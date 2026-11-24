import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ALBUM_CONNECT_FIRST,
  ALBUM_NOT_ENABLED,
  ALBUM_SCHEMA_UNAVAILABLE,
  formatAlbumTime,
  itemHasCategory,
  type AlbumCategory,
  type AlbumItem,
} from '../../lib/album'
import {
  DRIVE_AUTH_READY_RETRY_MESSAGE,
  DRIVE_NETWORK_ERROR,
  clearDriveAccess,
  deleteDriveFile,
  driveFolderAccessible,
  findOrCreateAlbumFolder,
  getDriveUserEmail,
  googleClientId,
  isDriveAuthReady,
  peekAccessToken,
  peekDriveEmail,
  preloadDriveAuth,
  requestDriveAccess,
  sanitizeUploadFilename,
  uploadDriveImage,
  validateAlbumImage,
} from '../../lib/googleDrive'
import { useAlbum } from '../../hooks/useAlbum'
import {
  ALBUM_PRESET_NAMES,
  isAlbumPreset,
  splitAlbumCategories,
  suggestAlbumPresets,
  validateAlbumCategoryName,
} from '../../utils/albumClassify'
import { albumHistoryState, closeAlbumHashLayer, pushHash, replaceHash, toAccountHash, type AccountRoute } from '../../utils/accountRoutes'
import { DownloadOriginalButton } from '../DownloadOriginalButton'
import { extFromMime, sanitizeFilename } from '../../utils/downloadOriginal'
import { albumDisplayTitle } from '../../utils/albumDisplay'
import { type DriveImagePriority } from '../../lib/driveImageCache'
import { useDriveImageSlot } from '../../hooks/useDriveImageSlot'
import { ADULT_CATEGORY } from '../../types'
import { loadQuyiMeta, PENDING_CHARACTER, sortCharacterNames, type QuyiCharacter } from '../../utils/quyiCharacters'
import { AlbumFlipBook } from './AlbumFlipBook'
import './album.css'

interface Props {
  route: AccountRoute
}

interface DraftFile {
  key: string
  file: File
  title: string
  previewUrl: string
  auto: string[]
  custom: string[]
  error?: string
}

interface UploadJob {
  key: string
  title: string
  loaded: number
  total: number
}

export function CloudAlbum({ route }: Props) {
  const clientId = googleClientId()
  const album = useAlbum(Boolean(clientId))
  const [token, setToken] = useState<string | null>(() => peekAccessToken())
  const [driveEmail, setDriveEmail] = useState<string | undefined>(() => peekDriveEmail())
  const [connecting, setConnecting] = useState(false)
  const [authPreparing, setAuthPreparing] = useState(() => !isDriveAuthReady())
  const [driveError, setDriveError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<DraftFile[]>([])
  const [jobs, setJobs] = useState<UploadJob[]>([])
  const [uploading, setUploading] = useState(false)
  const [dragHot, setDragHot] = useState(false)
  const [manageCats, setManageCats] = useState(false)
  const [newCat, setNewCat] = useState('')
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const folderId = album.settings?.driveRootFolderId ?? null
  const [plannedCharacters, setPlannedCharacters] = useState<QuyiCharacter[]>([])

  useEffect(() => {
    void loadQuyiMeta().then((meta) => setPlannedCharacters(meta?.characters ?? []))
  }, [])

  useEffect(() => {
    let cancelled = false
    if (isDriveAuthReady()) {
      setAuthPreparing(false)
      return
    }
    setAuthPreparing(true)
    void preloadDriveAuth()
      .then(() => {
        if (!cancelled) setAuthPreparing(false)
      })
      .catch((error) => {
        if (cancelled) return
        setAuthPreparing(false)
        setDriveError(error instanceof Error ? error.message : DRIVE_NETWORK_ERROR)
      })
    return () => {
      cancelled = true
    }
  }, [])


  useEffect(() => {
    const current = peekAccessToken()
    setToken(current)
    setDriveEmail(peekDriveEmail() ?? album.settings?.connectedGoogleEmail ?? undefined)
  }, [album.settings?.connectedGoogleEmail])

  const cat = route.cat
  const characterFolder = route.folderId
  const inAdult = cat === ADULT_CATEGORY
  const activeId = route.itemId
  const selected = useMemo(
    () => (activeId ? album.items.find((item) => item.id === activeId) ?? null : null),
    [activeId, album.items],
  )

  const presets = useMemo(
    () =>
      ALBUM_PRESET_NAMES.map(
        (name) => album.categories.find((category) => category.kind === 'preset' && category.name === name) ?? {
          id: name,
          name,
          slug: name,
          kind: 'preset' as const,
          createdAt: '',
          createdBy: null,
        },
      ),
    [album.categories],
  )
  const customs = useMemo(
    () => album.categories.filter((category) => category.kind === 'custom'),
    [album.categories],
  )
  const existingNames = useMemo(() => album.categories.map((category) => category.name), [album.categories])

  const visibleItems = useMemo(
    () =>
      album.items.filter((item) => itemHasCategory(item, cat)).filter((item) => {
        if (!characterFolder) return true
        return itemHasCategory(item, characterFolder)
      }),
    [album.items, cat, characterFolder],
  )

  const adultFolders = useMemo(() => {
    const adultItems = album.items.filter((item) => itemHasCategory(item, ADULT_CATEGORY))
    const countMap: Record<string, number> = {}
    const thumbs: Record<string, AlbumItem> = {}
    for (const item of adultItems) {
      const labels = [...item.autoCategories, ...item.customCategories].filter((name) => name !== ADULT_CATEGORY)
      const unique = labels.length ? labels : [PENDING_CHARACTER]
      for (const label of unique) {
        countMap[label] = (countMap[label] ?? 0) + 1
        if (!thumbs[label]) thumbs[label] = item
      }
    }
    const planned = plannedCharacters.map((character) => character.displayName)
    const extra = Object.keys(countMap).filter((name) => !planned.includes(name))
    const names = sortCharacterNames([...planned, ...extra], countMap)
    return names.map((name) => ({
      name,
      count: countMap[name] ?? 0,
      pending: name === PENDING_CHARACTER,
      thumb: thumbs[name] ?? null,
    }))
  }, [album.items, plannedCharacters])

  const counts = useMemo(() => {
    const map: Record<string, number> = { 全部: album.items.length }
    for (const item of album.items) {
      for (const label of [...item.autoCategories, ...item.customCategories]) {
        map[label] = (map[label] ?? 0) + 1
      }
    }
    return map
  }, [album.items])

  const setAlbumHash = (
    next: { cat?: string | null; itemId?: string | null; folderId?: string | null },
    mode: 'push' | 'replace' = 'replace',
  ) => {
    const nextCat = next.cat === undefined ? cat : next.cat
    const nextFolder = next.folderId === undefined ? characterFolder : next.folderId
    const nextItem = next.itemId === undefined ? activeId : next.itemId
    const hash = toAccountHash({
      view: 'album',
      cat: nextCat,
      itemId: nextItem,
      folderId: nextCat === ADULT_CATEGORY ? nextFolder : null,
    })
    const openedFolder = Boolean(nextCat === ADULT_CATEGORY && nextFolder && nextFolder !== characterFolder)
    const openedItem = Boolean(nextItem && nextItem !== activeId)
    const layer = openedItem ? 'item' : openedFolder ? 'folder' : null
    if (mode === 'push' && layer) {
      pushHash(hash, albumHistoryState(layer))
      return
    }
    replaceHash(hash)
  }

  const closeFolderView = () => {
    closeAlbumHashLayer({
      expected: 'folder',
      fallback: () => setAlbumHash({ cat: ADULT_CATEGORY, folderId: null, itemId: null }),
    })
  }

  const closeItemView = () => {
    closeAlbumHashLayer({
      expected: 'item',
      fallback: () => setAlbumHash({ itemId: null }),
    })
  }

  useEffect(() => {
    if (!inAdult || !characterFolder || selected) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      const tag = (event.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      event.preventDefault()
      closeFolderView()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [inAdult, characterFolder, selected, cat, activeId])

  useEffect(() => {
    if (!characterFolder) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [characterFolder])

  const connect = () => {
    setDriveError(null)
    if (!isDriveAuthReady()) {
      setAuthPreparing(true)
      void preloadDriveAuth()
        .then(() => {
          setAuthPreparing(false)
          setDriveError(DRIVE_AUTH_READY_RETRY_MESSAGE)
        })
        .catch((error) => {
          setAuthPreparing(false)
          setDriveError(error instanceof Error ? error.message : DRIVE_NETWORK_ERROR)
        })
      return
    }

    setConnecting(true)
    const accessPromise = requestDriveAccess(peekAccessToken() ? '' : 'consent')
    void accessPromise
      .then(async (access) => {
        const email = await getDriveUserEmail(access)
        const savedId = album.settings?.driveRootFolderId
        if (savedId) {
          const ok = await driveFolderAccessible(access, savedId)
          if (!ok) {
            const hint = album.settings?.connectedGoogleEmail
              ? `请使用原先连接的谷歌账号（${album.settings.connectedGoogleEmail}）重新授权。`
              : '请使用原先连接相册的谷歌账号重新授权。'
            throw new Error(`无法访问已保存的相册目录。${hint}`)
          }
          await album.connectSettings({ driveRootFolderId: savedId, connectedGoogleEmail: email })
        } else {
          const createdId = await findOrCreateAlbumFolder(access)
          await album.connectSettings({ driveRootFolderId: createdId, connectedGoogleEmail: email })
        }
        setToken(access)
        setDriveEmail(email)
      })
      .catch((error) => {
        setDriveError(error instanceof Error ? error.message : '连接谷歌云盘失败，请稍后重试')
      })
      .finally(() => {
        setConnecting(false)
      })
  }

  const disconnect = () => {
    clearDriveAccess()
    setToken(null)
    setDriveError(null)
  }

  const enqueueFiles = (list: FileList | File[]) => {
    const next: DraftFile[] = []
    for (const file of Array.from(list)) {
      const check = validateAlbumImage(file, file.name)
      const title = file.name.replace(/\.[a-z0-9]+$/i, '')
      next.push({
        key: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(16).slice(2)}`,
        file,
        title,
        previewUrl: URL.createObjectURL(file),
        auto: check.ok
          ? Array.from(
              new Set([
                ...suggestAlbumPresets({
                  title,
                  filename: file.name,
                  promptCategory: inAdult || characterFolder ? ADULT_CATEGORY : null,
                }),
                ...(inAdult || characterFolder ? [ADULT_CATEGORY] : []),
              ]),
            )
          : [],
        custom: characterFolder && !isAlbumPreset(characterFolder) ? [characterFolder] : [],
        error: check.ok ? undefined : check.error,
      })
    }
    if (next.length) setDrafts((current) => [...current, ...next])
  }

  const draftUrlsRef = useRef<string[]>([])
  draftUrlsRef.current = drafts.map((draft) => draft.previewUrl)
  useEffect(() => {
    return () => {
      draftUrlsRef.current.forEach((url) => URL.revokeObjectURL(url))
    }
  }, [])

  const releaseDrafts = (list: DraftFile[]) => {
    list.forEach((draft) => URL.revokeObjectURL(draft.previewUrl))
  }

  const ensureCustomNames = async (names: string[]) => {
    const have = new Set(album.categories.map((category) => category.name))
    for (const name of names) {
      if (have.has(name) || isAlbumPreset(name)) continue
      const created = await album.addCategory(name)
      have.add(created.name)
    }
  }

  const confirmDrafts = async () => {
    if (!token || !folderId) {
      setDriveError(ALBUM_CONNECT_FIRST)
      return
    }
    const ready = drafts.filter((draft) => !draft.error)
    if (!ready.length) return
    setUploading(true)
    setMessage(null)
    setDriveError(null)
    const remaining: DraftFile[] = []
    try {
      for (const draft of ready) {
        const split = splitAlbumCategories([...draft.auto, ...draft.custom])
        const check = validateAlbumImage(draft.file, draft.file.name)
        if (!check.ok) {
          remaining.push({ ...draft, error: check.error })
          continue
        }
        try {
          await ensureCustomNames(split.custom)
          const filename = sanitizeUploadFilename(draft.title || draft.file.name, check.mime)
          setJobs((current) => [...current.filter((job) => job.key !== draft.key), { key: draft.key, title: filename, loaded: 0, total: draft.file.size }])
          const uploaded = await uploadDriveImage(token, folderId, draft.file, filename, (loaded, total) => {
            setJobs((current) =>
              current.map((job) => (job.key === draft.key ? { ...job, loaded, total } : job)),
            )
          })
          try {
            await album.addItem({
              driveFileId: uploaded.id,
              title: draft.title.trim() || uploaded.name,
              source: 'upload',
              mimeType: uploaded.mimeType,
              sizeBytes: uploaded.size ?? draft.file.size,
              autoCategories: split.auto,
              customCategories: split.custom,
            })
            URL.revokeObjectURL(draft.previewUrl)
          } catch (error) {
            try {
              await deleteDriveFile(token, uploaded.id)
            } catch {
              /* keep the metadata error */
            }
            throw error
          }
        } catch (error) {
          remaining.push({
            ...draft,
            error: error instanceof Error ? error.message : '上传失败，请稍后重试',
          })
        }
      }
    } finally {
      setJobs([])
      setUploading(false)
      const rejected = drafts.filter((draft) => draft.error)
      const leftover = [...rejected, ...remaining.filter((draft) => !rejected.includes(draft))]
      const unique = leftover.filter((draft, index, list) => list.findIndex((item) => item.key === draft.key) === index)
      setDrafts(unique)
      if (!unique.length) setMessage('图片已加入云端相册')
    }
  }

  const addCustom = async () => {
    try {
      await album.addCategory(newCat)
      setNewCat('')
      setMessage(null)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '无法创建分类')
    }
  }

  const saveRename = async (category: AlbumCategory) => {
    try {
      await album.editCategory(category.id, renameValue)
      const nextName = renameValue.trim() || category.name
      if (cat === category.name) setAlbumHash({ cat: nextName })
      if (characterFolder === category.name) setAlbumHash({ folderId: nextName })
      setRenamingId(null)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '无法重命名分类')
    }
  }

  const removeCustom = async (category: AlbumCategory) => {
    const ok = window.confirm(`确定删除分类「${category.name}」？已使用该分类的图片会去掉这个标签。`)
    if (!ok) return
    try {
      await album.removeCategory(category.id)
      if (cat === category.name) setAlbumHash({ cat: null })
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '无法删除分类')
    }
  }

  const deleteItem = async (item: AlbumItem) => {
    const label = item.title || '这张图片'
    const ok = window.confirm(`确定删除「${label}」？图片会从谷歌云盘和相册记录中一并移除。`)
    if (!ok) return
    if (!token) {
      setDriveError(ALBUM_CONNECT_FIRST)
      return
    }
    try {
      await deleteDriveFile(token, item.driveFileId)
      await album.removeItem(item.id)
      if (activeId === item.id) setAlbumHash({ itemId: null })
      setMessage('已删除')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '删除失败，请稍后重试')
    }
  }

  if (!clientId) {
    return (
      <div className="account-gate">
        <h2>云端相册尚未启用</h2>
        <p>{ALBUM_NOT_ENABLED}</p>
      </div>
    )
  }

  if (album.schemaMissing) {
    return (
      <div className="account-gate">
        <h2>相册数据尚未就绪</h2>
        <p>{ALBUM_SCHEMA_UNAVAILABLE}</p>
      </div>
    )
  }

  if (album.loading) {
    return <p className="state">正在载入云端相册…</p>
  }

  if (!token) {
    return (
      <div className="album-connect">
        <h2>连接谷歌云盘</h2>
        <p>
          云端相册会把图片存进管理员的谷歌云盘（Google One 5T），并在本站保存分类和标题。文件保持私密，不会生成公开链接。首次连接时，会在云盘中创建或使用文件夹「风格 Prompt 图鉴·云端相册」。
        </p>
        {album.settings?.connectedGoogleEmail && (
          <p>此前已连接到 {album.settings.connectedGoogleEmail}，请使用同一谷歌账号重新授权以查看图片。</p>
        )}
        {driveError && <p className="album__error">{driveError}</p>}
        {album.error && !album.schemaMissing && <p className="album__error">{album.error}</p>}
        <div className="album__actions">
          <button
            type="button"
            className="btn btn-primary"
            onClick={connect}
            disabled={connecting || authPreparing}
          >
            {connecting ? '正在连接…' : authPreparing ? '正在准备连接…' : '连接谷歌云盘'}
          </button>
        </div>
      </div>
    )
  }

  return (
    <section className="album">
      <header className="album__head">
        <div>
          <h2>云端相册</h2>
          <p className="album__status">
            已连接{driveEmail || album.settings?.connectedGoogleEmail ? ` ${driveEmail || album.settings?.connectedGoogleEmail}` : '谷歌云盘'}
            ，图片仅保存在该账号的云盘中。
          </p>
        </div>
        <div className="album__actions">
          <button type="button" className="btn btn-ghost" onClick={() => fileRef.current?.click()}>
            上传图片
          </button>
          <button type="button" className="btn btn-ghost" onClick={disconnect}>
            断开连接
          </button>
        </div>
      </header>

      <input
        ref={fileRef}
        className="account-file"
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        multiple
        onChange={(event) => {
          if (event.target.files) enqueueFiles(event.target.files)
          event.target.value = ''
        }}
      />

      <div
        className={`album-drop ${dragHot ? 'is-hot' : ''}`}
        onDragEnter={(event) => {
          event.preventDefault()
          setDragHot(true)
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={() => setDragHot(false)}
        onDrop={(event) => {
          event.preventDefault()
          setDragHot(false)
          if (event.dataTransfer.files.length) enqueueFiles(event.dataTransfer.files)
        }}
        onClick={() => fileRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            fileRef.current?.click()
          }
        }}
      >
        <strong>拖放图片到这里，或点击选择文件</strong>
        <span>支持 JPG、PNG、WebP、GIF，单张不超过 50 MB。</span>
      </div>

      {drafts.length > 0 && (
        <div className="album-review">
          <h3>确认分类后上传</h3>
          <p className="album__hint">系统已根据文件名给出建议标签，你可以在保存前修改。预设标签会写入自动分类，自己起的名称会作为自定义分类。</p>
          {drafts.map((draft) => (
            <DraftEditor
              key={draft.key}
              draft={draft}
              customs={customs}
              onChange={(next) => setDrafts((list) => list.map((item) => (item.key === draft.key ? next : item)))}
              onRemove={() => {
                URL.revokeObjectURL(draft.previewUrl)
                setDrafts((list) => list.filter((item) => item.key !== draft.key))
              }}
            />
          ))}
          <div className="album__actions">
            <button type="button" className="btn btn-primary" onClick={() => void confirmDrafts()} disabled={uploading}>
              {uploading ? '正在上传…' : '确认并上传'}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={uploading}
              onClick={() => {
                releaseDrafts(drafts)
                setDrafts([])
              }}
            >
              取消
            </button>
          </div>
        </div>
      )}

      {jobs.length > 0 && (
        <p className="album-progress" aria-live="polite">
          {jobs.map((job) => {
            const pct = job.total ? Math.min(100, Math.round((job.loaded / job.total) * 100)) : 0
            return `正在上传「${job.title}」${pct}%`
          }).join(' · ')}
        </p>
      )}

      {driveError && <p className="album__error">{driveError}</p>}
      {album.error && !album.schemaMissing && <p className="album__error">{album.error}</p>}
      {message && <p className="album__hint">{message}</p>}

      <div className="album-chips" role="tablist" aria-label="相册分类">
        <button
          type="button"
          className={`album-chip ${!cat ? 'is-active' : ''}`}
          onClick={() => setAlbumHash({ cat: null, itemId: null, folderId: null })}
        >
          全部 <span>{counts['全部'] ?? 0}</span>
        </button>
        {presets.map((category) => (
          <button
            type="button"
            key={category.id}
            className={`album-chip is-preset ${cat === category.name ? 'is-active' : ''}`}
            onClick={() => setAlbumHash({ cat: category.name, itemId: null, folderId: null })}
          >
            {category.name} <span>{counts[category.name] ?? 0}</span>
          </button>
        ))}
        {customs.map((category) =>
          renamingId === category.id ? (
            <form
              key={category.id}
              className="album-chip-edit"
              onSubmit={(event) => {
                event.preventDefault()
                void saveRename(category)
              }}
            >
              <input
                value={renameValue}
                onChange={(event) => setRenameValue(event.target.value)}
                maxLength={20}
                aria-label="分类新名称"
              />
              <button type="submit" className="btn btn-ghost">
                保存
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => setRenamingId(null)}>
                取消
              </button>
            </form>
          ) : (
            <span key={category.id} className="album-chip-row">
              <button
                type="button"
                className={`album-chip ${cat === category.name || characterFolder === category.name ? 'is-active' : ''}`}
                onClick={() =>
                  inAdult
                    ? setAlbumHash({ cat: ADULT_CATEGORY, folderId: category.name, itemId: null }, 'push')
                    : setAlbumHash({ cat: category.name, itemId: null, folderId: null })
                }
              >
                {category.name} <span>{counts[category.name] ?? 0}</span>
              </button>
              {manageCats && (
                <>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => {
                      setRenamingId(category.id)
                      setRenameValue(category.name)
                    }}
                  >
                    重命名
                  </button>
                  <button type="button" className="btn btn-danger" onClick={() => void removeCustom(category)}>
                    删除
                  </button>
                </>
              )}
            </span>
          ),
        )}
        <button type="button" className="album-chip album-chip--quiet" onClick={() => setManageCats((value) => !value)}>
          {manageCats ? '完成管理' : '管理分类'}
        </button>
        <form
          className="album-newcat"
          onSubmit={(event) => {
            event.preventDefault()
            void addCustom()
          }}
        >
          <input
            value={newCat}
            onChange={(event) => setNewCat(event.target.value)}
            placeholder="新建分类"
            maxLength={20}
            aria-label="新建分类名称"
          />
          <button type="submit" className="btn btn-ghost">
            添加
          </button>
        </form>
      </div>

      {inAdult && (
        <div hidden={Boolean(characterFolder)}>
          <p className="album__hint">在 18+ 下按角色打开抽屉。文件夹里可以翻阅、层层堆叠。角色名与首页 18+ 子导航一致。</p>
          <div className="album-drawers">
            {adultFolders.map((folder) => (
              <button
                type="button"
                key={folder.name}
                className={`album-drawer${folder.pending ? ' is-pending' : ''}`}
                onClick={() => setAlbumHash({ cat: ADULT_CATEGORY, folderId: folder.name, itemId: null }, 'push')}
              >
                <div className="album-drawer__stack" aria-hidden>
                  <div className="album-drawer__layer album-drawer__layer--2" />
                  <div className="album-drawer__layer album-drawer__layer--1" />
                  <div className="album-drawer__front">
                    {folder.thumb && token && !characterFolder ? (
                      <DriveImage token={token} fileId={folder.thumb.driveFileId} title={folder.name} priority="low" />
                    ) : (
                      <div className="album-ph">空文件夹</div>
                    )}
                  </div>
                </div>
                <p className="album-drawer__name">{folder.name}</p>
                <p className="album-drawer__count">{folder.count} 张</p>
              </button>
            ))}
          </div>
        </div>
      )}

      {inAdult && characterFolder && (
        <div className="album-viewer" role="dialog" aria-modal="true" aria-label={characterFolder}>
          <div className="album-viewer__bar">
            <button type="button" className="album-viewer__back" onClick={closeFolderView}>
              返回角色列表
            </button>
            <span className="album-viewer__name">{characterFolder}</span>
          </div>
          <button type="button" className="album-viewer__close" onClick={closeFolderView} aria-label="关闭">
            ×
          </button>
          {token && (
            <AlbumFlipBook
              items={visibleItems}
              token={token}
              character={characterFolder}
              onOpen={(item) => setAlbumHash({ itemId: item.id }, 'push')}
            />
          )}
        </div>
      )}

      {!inAdult && visibleItems.length === 0 && (
        <p className="album__empty">这个分类里还没有图片。可以上传，或从图鉴详情页把封面加入云端相册。</p>
      )}
      {!inAdult && visibleItems.length > 0 && (
        <div className="album-grid">
          {visibleItems.map((item, itemIndex) => (
            <button
              type="button"
              key={item.id}
              className="album-card"
              onClick={() => setAlbumHash({ itemId: item.id }, 'push')}
            >
              <div className="album-card__media">
                <DriveImage token={token} fileId={item.driveFileId} title={albumDisplayTitle({ title: item.title, index: itemIndex + 1 })} priority="low" />
              </div>
              <div className="album-card__body">
                <p className="album-card__title">{albumDisplayTitle({ title: item.title, index: itemIndex + 1 })}</p>
                <p className="album-card__meta">
                  {item.source === 'generated' ? '来自风格' : '上传'}
                  {item.autoCategories.concat(item.customCategories).length
                    ? ` · ${item.autoCategories.concat(item.customCategories).join('、')}`
                    : ''}
                </p>
              </div>
            </button>
          ))}
        </div>
      )}

      {selected && (
        <AlbumLightbox
          item={selected}
          token={token}
          customs={customs}
          existingNames={existingNames}
          onClose={closeItemView}
          onSave={async (patch) => {
            try {
              await ensureCustomNames(patch.customCategories)
              await album.editItem(selected.id, {
                title: patch.title,
                autoCategories: patch.autoCategories,
                customCategories: patch.customCategories,
              })
              setMessage('已更新')
            } catch (error) {
              setMessage(error instanceof Error ? error.message : '无法更新这条记录')
            }
          }}
          onDelete={() => void deleteItem(selected)}
        />
      )}
    </section>
  )
}

function DraftEditor({
  draft,
  customs,
  onChange,
  onRemove,
}: {
  draft: DraftFile
  customs: AlbumCategory[]
  onChange: (draft: DraftFile) => void
  onRemove: () => void
}) {
  const [customName, setCustomName] = useState('')
  const toggle = (name: string) => {
    if (isAlbumPreset(name)) {
      const auto = draft.auto.includes(name) ? draft.auto.filter((item) => item !== name) : [...draft.auto, name]
      onChange({ ...draft, auto: splitAlbumCategories(auto).auto })
      return
    }
    const custom = draft.custom.includes(name) ? draft.custom.filter((item) => item !== name) : [...draft.custom, name]
    onChange({ ...draft, custom })
  }

  return (
    <div className="album-review__item">
      <img src={draft.previewUrl} alt="" className="album-review__thumb" />
      <div className="album-review__fields">
        <input
          type="text"
          value={draft.title}
          onChange={(event) => onChange({ ...draft, title: event.target.value })}
          aria-label="图片标题"
        />
        <div className="album-chip-row">
          {ALBUM_PRESET_NAMES.map((name) => (
            <button
              type="button"
              key={name}
              className={`album-chip is-preset ${draft.auto.includes(name) ? 'is-active' : ''}`}
              onClick={() => toggle(name)}
            >
              {name}
            </button>
          ))}
          {customs.map((category) => (
            <button
              type="button"
              key={category.id}
              className={`album-chip ${draft.custom.includes(category.name) ? 'is-active' : ''}`}
              onClick={() => toggle(category.name)}
            >
              {category.name}
            </button>
          ))}
          {draft.custom
            .filter((name) => !customs.some((category) => category.name === name))
            .map((name) => (
              <button
                type="button"
                key={name}
                className="album-chip is-active"
                onClick={() => toggle(name)}
              >
                {name}
              </button>
            ))}
        </div>
        <form
          className="album-newcat"
          onSubmit={(event) => {
            event.preventDefault()
            const validated = validateAlbumCategoryName(customName, [...ALBUM_PRESET_NAMES, ...draft.custom, ...customs.map((c) => c.name)])
            if (!validated.ok) {
              onChange({ ...draft, error: validated.error })
              return
            }
            if (isAlbumPreset(validated.name)) {
              toggle(validated.name)
            } else if (!draft.custom.includes(validated.name)) {
              onChange({ ...draft, custom: [...draft.custom, validated.name], error: undefined })
            }
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
          <button type="button" className="btn btn-ghost" onClick={onRemove}>
            移除
          </button>
        </form>
        {draft.error && <p className="album__error">{draft.error}</p>}
      </div>
    </div>
  )
}

function DriveImage({
  token,
  fileId,
  title,
  contain = false,
  download = false,
  priority = 'high',
}: {
  token: string | null
  fileId: string
  title?: string | null
  contain?: boolean
  download?: boolean
  priority?: DriveImagePriority
}) {
  const slot = useDriveImageSlot({ token, fileId, priority })
  const url = slot.url
  const blob = slot.blob
  const error = slot.error

  if (error) return <div className="album-ph">{error}</div>
  if (!token) return <div className="album-ph">连接谷歌云盘后可预览</div>
  if (!url) return <div className="album-ph">载入中…</div>
  const filename = sanitizeFilename(`${title || 'album'}.${extFromMime(blob?.type || 'image/jpeg')}`)
  return (
    <>
      <img src={url} alt={title || ''} style={contain ? { objectFit: 'contain' } : undefined} />
      {download && (
        <DownloadOriginalButton
          className="album-lightbox__download"
          url={url}
          blob={blob ?? undefined}
          filename={filename}
          source={title || '云端相册'}
        />
      )}
    </>
  )
}

function AlbumLightbox({
  item,
  token,
  customs,
  existingNames,
  onClose,
  onSave,
  onDelete,
}: {
  item: AlbumItem
  token: string | null
  customs: AlbumCategory[]
  existingNames: string[]
  onClose: () => void
  onSave: (patch: { title: string; autoCategories: string[]; customCategories: string[] }) => Promise<void>
  onDelete: () => void
}) {
  const [title, setTitle] = useState(item.title ?? '')
  const [auto, setAuto] = useState(item.autoCategories)
  const [custom, setCustom] = useState(item.customCategories)
  const [customName, setCustomName] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setTitle(item.title ?? '')
    setAuto(item.autoCategories)
    setCustom(item.customCategories)
  }, [item])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      onClose()
    }
    window.addEventListener('keydown', onKey)
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = previous
    }
  }, [onClose])

  const toggle = (name: string) => {
    if (isAlbumPreset(name)) {
      setAuto((list) => (list.includes(name) ? list.filter((itemName) => itemName !== name) : [...list, name]))
      return
    }
    setCustom((list) => (list.includes(name) ? list.filter((itemName) => itemName !== name) : [...list, name]))
  }

  return (
    <div className="album-lightbox" onClick={onClose} role="presentation">
      <button
        type="button"
        className="album-lightbox__close"
        onClick={(event) => {
          event.stopPropagation()
          onClose()
        }}
        aria-label="关闭"
      >
        ×
      </button>
      <div
        className="album-lightbox__sheet"
        role="dialog"
        aria-modal
        aria-label={albumDisplayTitle({ title: item.title, index: 1 }) || '云端相册图片'}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="album-lightbox__media">
          <DriveImage token={token} fileId={item.driveFileId} title={albumDisplayTitle({ title: item.title, index: 1 })} contain download />
        </div>
        <div className="album-lightbox__body">
          <div className="album-lightbox__top">
            <input
              type="text"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              aria-label="图片标题"
              placeholder={albumDisplayTitle({ title: item.title, index: 1 })}
            />
          </div>
          <p className="album__hint">
            {item.source === 'generated' ? '来自风格' : '上传'}
            {item.promptId ? ` · 风格 ${item.promptId}` : ''}
            {' · '}
            {formatAlbumTime(item.createdAt)}（上海时间）
          </p>
          {item.promptId && (
            <a className="album__hint" href={`#/${item.promptId}`}>
              查看对应风格
            </a>
          )}
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
              const validated = validateAlbumCategoryName(customName, [...existingNames, ...custom])
              if (!validated.ok) return
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
          <div className="album__actions">
            <button
              type="button"
              className="btn btn-primary"
              disabled={saving}
              onClick={() => {
                setSaving(true)
                void onSave({
                  title: title.trim(),
                  autoCategories: splitAlbumCategories(auto).auto,
                  customCategories: splitAlbumCategories(custom).custom,
                }).finally(() => setSaving(false))
              }}
            >
              保存分类
            </button>
            <button type="button" className="btn btn-danger" onClick={onDelete}>
              删除图片
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
