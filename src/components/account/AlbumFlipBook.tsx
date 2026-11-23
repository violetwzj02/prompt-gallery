import { useEffect, useRef, useState } from 'react'
import type { AlbumItem } from '../../lib/album'
import { formatAlbumTime } from '../../lib/album'
import { DownloadOriginalButton } from '../DownloadOriginalButton'
import { extFromMime, sanitizeFilename } from '../../utils/downloadOriginal'

interface DriveSlot {
  url: string | null
  blob: Blob | null
  error: string | null
}

interface Props {
  items: AlbumItem[]
  token: string
  character: string
  onOpen: (item: AlbumItem) => void
  fetchImage: (token: string, fileId: string) => Promise<Blob>
}

export function AlbumFlipBook({ items, token, character, onOpen, fetchImage }: Props) {
  const [index, setIndex] = useState(0)
  const [slot, setSlot] = useState<DriveSlot>({ url: null, blob: null, error: null })
  const startX = useRef<number | null>(null)

  useEffect(() => {
    setIndex(0)
  }, [character, items.map((item) => item.id).join('|')])

  const current = items[index] ?? null

  useEffect(() => {
    if (!current) {
      setSlot({ url: null, blob: null, error: null })
      return
    }
    let revoked = false
    let objectUrl: string | null = null
    setSlot({ url: null, blob: null, error: null })
    void fetchImage(token, current.driveFileId)
      .then((blob) => {
        if (revoked) return
        objectUrl = URL.createObjectURL(blob)
        setSlot({ url: objectUrl, blob, error: null })
      })
      .catch((err) => {
        if (!revoked) setSlot({ url: null, blob: null, error: err instanceof Error ? err.message : '无法载入图片' })
      })
    return () => {
      revoked = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [current?.id, current?.driveFileId, fetchImage, token])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
      const tag = (event.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      event.preventDefault()
      setIndex((value) => {
        if (event.key === 'ArrowLeft') return Math.max(0, value - 1)
        return Math.min(items.length - 1, value + 1)
      })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [items.length])

  if (items.length === 0) {
    return <p className="album__empty">「{character}」还没有图片。下载完成后可按角色导入。</p>
  }

  const atStart = index <= 0
  const atEnd = index >= items.length - 1
  const depth = Math.min(4, items.length)
  const filename = current
    ? sanitizeFilename(`${current.title || character}.${extFromMime(slot.blob?.type || 'image/jpeg')}`)
    : 'image.jpg'

  const go = (next: number) => {
    setIndex(Math.max(0, Math.min(items.length - 1, next)))
  }

  return (
    <div className="album-flip">
      <div
        className="album-flip__stage"
        onPointerDown={(event) => {
          startX.current = event.clientX
        }}
        onPointerUp={(event) => {
          if (startX.current == null) return
          const delta = event.clientX - startX.current
          startX.current = null
          if (delta > 48) go(index - 1)
          else if (delta < -48) go(index + 1)
        }}
        onPointerCancel={() => {
          startX.current = null
        }}
      >
        {Array.from({ length: depth }, (_, layer) => {
          const offset = depth - 1 - layer
          const isFront = offset === 0
          return (
            <div
              key={`stack-${offset}`}
              className={`album-flip__card${isFront ? ' is-front' : ''}`}
              style={{
                transform: `translate(${offset * 8}px, ${offset * 10}px) scale(${1 - offset * 0.04})`,
                zIndex: depth - offset,
                opacity: 1 - offset * 0.12,
              }}
              aria-hidden={!isFront}
            >
              {isFront ? (
                slot.error ? (
                  <div className="album-ph">{slot.error}</div>
                ) : slot.url ? (
                  <img src={slot.url} alt={current?.title || character} />
                ) : (
                  <div className="album-ph">载入中…</div>
                )
              ) : (
                <div className="album-flip__back" />
              )}
            </div>
          )
        })}
        {!atStart && (
          <button type="button" className="album-flip__nav album-flip__nav--prev" aria-label="上一张" onClick={() => go(index - 1)}>
            ‹
          </button>
        )}
        {!atEnd && (
          <button type="button" className="album-flip__nav album-flip__nav--next" aria-label="下一张" onClick={() => go(index + 1)}>
            ›
          </button>
        )}
        {slot.url && current && (
          <DownloadOriginalButton
            className="album-flip__download"
            url={slot.url}
            blob={slot.blob ?? undefined}
            filename={filename}
            source={current.title || character}
          />
        )}
      </div>

      <div className="album-flip__meta">
        <p className="album-flip__count">
          {character} · {index + 1} / {items.length}
        </p>
        {current && (
          <>
            <h3>{current.title || '未命名图片'}</h3>
            <p className="album__hint">
              {current.source === 'generated' ? '来自风格' : '上传'}
              {current.promptId ? ` · 风格 ${current.promptId}` : ''}
              {' · '}
              {formatAlbumTime(current.createdAt)}（上海时间）
            </p>
            <div className="album__actions">
              <button type="button" className="btn btn-ghost" onClick={() => current && onOpen(current)}>
                打开详情
              </button>
            </div>
          </>
        )}
      </div>

      {items.length > 1 && (
        <div className="album-flip__strip" role="tablist" aria-label="选择图片">
          {items.map((item, i) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={i === index}
              aria-label={item.title || `第 ${i + 1} 张`}
              className={`album-flip__dot${i === index ? ' is-active' : ''}`}
              onClick={() => go(i)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
