import { useEffect, useRef, useState } from 'react'
import type { AlbumItem } from '../../lib/album'
import { formatAlbumTime } from '../../lib/album'
import {
  acquireDriveImage,
  peekDriveImage,
  prefetchDriveImages,
  releaseDriveImage,
  type DriveImageRecord,
} from '../../lib/driveImageCache'
import { albumDisplayTitle } from '../../utils/albumDisplay'
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
}

export function AlbumFlipBook({ items, token, character, onOpen }: Props) {
  const [index, setIndex] = useState(0)
  const [slot, setSlot] = useState<DriveSlot>({ url: null, blob: null, error: null })
  const startX = useRef<number | null>(null)
  const itemKey = items.map((item) => item.id).join('|')

  useEffect(() => {
    setIndex(0)
  }, [character, itemKey])

  const current = items[index] ?? null
  const displayTitle = current ? albumDisplayTitle({ title: current.title, index: index + 1 }) : ''

  useEffect(() => {
    if (!current) {
      setSlot({ url: null, blob: null, error: null })
      return
    }
    let cancelled = false
    let record: DriveImageRecord | null = null
    const cached = peekDriveImage(current.driveFileId)
    if (cached) {
      setSlot({ url: cached.url, blob: cached.blob, error: null })
    } else {
      setSlot({ url: null, blob: null, error: null })
    }
    void acquireDriveImage(token, current.driveFileId)
      .then((next) => {
        if (cancelled) {
          releaseDriveImage(next)
          return
        }
        record = next
        setSlot({ url: next.url, blob: next.blob, error: null })
      })
      .catch((err) => {
        if (!cancelled) setSlot({ url: null, blob: null, error: err instanceof Error ? err.message : '无法载入图片' })
      })
    const neighbors: string[] = []
    const prev = items[index - 1]
    const nextItem = items[index + 1]
    if (prev) neighbors.push(prev.driveFileId)
    if (nextItem) neighbors.push(nextItem.driveFileId)
    prefetchDriveImages(token, neighbors)
    return () => {
      cancelled = true
      if (record) releaseDriveImage(record)
    }
  }, [current, index, items, token])

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
    ? sanitizeFilename(`${displayTitle || character}.${extFromMime(slot.blob?.type || 'image/jpeg')}`)
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
                  <img src={slot.url} alt={displayTitle || character} />
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
            source={displayTitle || character}
          />
        )}
      </div>

      <div className="album-flip__meta">
        <p className="album-flip__count">
          {character} · {index + 1} / {items.length}
        </p>
        {current && (
          <>
            <h3>{displayTitle}</h3>
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
              aria-label={albumDisplayTitle({ title: item.title, index: i + 1 })}
              className={`album-flip__dot${i === index ? ' is-active' : ''}`}
              onClick={() => go(i)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
