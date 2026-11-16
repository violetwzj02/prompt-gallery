import type { CSSProperties, KeyboardEvent, MouseEvent } from 'react'
import type { PromptItem } from '../types'
import { CATEGORY_ACCENT } from '../types'
import { CoverArt } from './CoverArt'

interface Props {
  item: PromptItem
  onOpen: (item: PromptItem) => void
  favorited?: boolean
  onToggleFavorite?: (item: PromptItem) => void
}

function HeartIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path d="M12 20s-7.15-4.35-9.45-8.4C.6 8.7 2.2 5.8 5.7 5.8c1.95 0 3.25 1.1 3.95 2.25C10.4 6.9 11.7 5.8 13.65 5.8c3.5 0 5.1 2.9 3.15 5.8C19.15 15.65 12 20 12 20z" />
    </svg>
  )
}

export function PromptCard({ item, onOpen, favorited = false, onToggleFavorite }: Props) {
  const accent = CATEGORY_ACCENT[item.category]
  const captionTags = item.tags
    .filter((t) => t !== item.category && t !== item.collection && t !== item.medium)
    .slice(0, 2)

  const stopFav = (e: MouseEvent | KeyboardEvent) => {
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
      {onToggleFavorite && (
        <button
          type="button"
          className={`fav-heart ${favorited ? 'is-on' : ''}`}
          aria-label={favorited ? '取消收藏' : '收藏'}
          aria-pressed={favorited}
          onClick={(e) => {
            stopFav(e)
            onToggleFavorite(item)
          }}
          onPointerDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              stopFav(e)
              onToggleFavorite(item)
            }
          }}
        >
          <HeartIcon />
        </button>
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
          {item.local && <span className="prompt-card__local">本地</span>}
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
