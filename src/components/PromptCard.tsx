import type { CSSProperties, KeyboardEvent, MouseEvent } from 'react'
import type { PromptItem } from '../types'
import { categoryAccent } from '../utils/category'
import { styleOriginLabel } from '../utils/styleOrigin'
import { CoverArt } from './CoverArt'

interface Props {
  item: PromptItem
  onOpen: (item: PromptItem) => void
  liked?: boolean
  favorited?: boolean
  onToggleLike?: (item: PromptItem) => void
  onToggleFavorite?: (item: PromptItem) => void
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

export function PromptCard({
  item,
  onOpen,
  liked = false,
  favorited = false,
  onToggleLike,
  onToggleFavorite,
  viewerId = null,
}: Props) {
  const accent = categoryAccent(item.category)
  const originLabel = styleOriginLabel(item, viewerId)
  const captionTags = item.tags
    .filter((t) => t !== item.category && t !== item.collection && t !== item.medium)
    .slice(0, 2)

  const stopMark = (e: MouseEvent | KeyboardEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }

  return (
    <article
      className="prompt-card"
      style={{ '--card-accent': accent } as CSSProperties}
      onClick={() => onOpen(item)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpen(item)
        }
      }}
      role="button"
      tabIndex={0}
      aria-label={item.title}
    >
      <CoverArt item={item} className="prompt-card__cover" />
      {(onToggleLike || onToggleFavorite) && (
        <div className="card-marks">
          {onToggleLike && (
            <button
              type="button"
              className={`card-mark card-mark--like ${liked ? 'is-on' : ''}`}
              aria-label={liked ? '取消喜欢' : '喜欢'}
              aria-pressed={liked}
              onClick={(e) => {
                stopMark(e)
                onToggleLike(item)
              }}
              onPointerDown={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  stopMark(e)
                  onToggleLike(item)
                }
              }}
            >
              <HeartIcon />
            </button>
          )}
          {onToggleFavorite && (
            <button
              type="button"
              className={`card-mark card-mark--save ${favorited ? 'is-on' : ''}`}
              aria-label={favorited ? '取消收藏' : '收藏'}
              aria-pressed={favorited}
              onClick={(e) => {
                stopMark(e)
                onToggleFavorite(item)
              }}
              onPointerDown={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  stopMark(e)
                  onToggleFavorite(item)
                }
              }}
            >
              <BookmarkIcon />
            </button>
          )}
        </div>
      )}
      <div className="prompt-card__caption">
        <div className="prompt-card__caption-top">
          {item.collection && item.collectionIndex && item.collectionTotal ? (
            <span className="prompt-card__series">
              {item.collection} · {item.collectionIndex}/{item.collectionTotal}
            </span>
          ) : (
            <span className="prompt-card__series">{item.category}</span>
          )}
          {originLabel && <span className="prompt-card__local">{originLabel}</span>}
        </div>
        <h3 className="prompt-card__title">{item.title}</h3>
        {captionTags.length > 0 && (
          <p className="prompt-card__tags">
            {captionTags.map((t) => (
              <span key={t}>{t}</span>
            ))}
          </p>
        )}
      </div>
    </article>
  )
}
