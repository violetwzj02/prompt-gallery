import type { CSSProperties } from 'react'
import type { PromptItem } from '../types'
import { CATEGORY_ACCENT } from '../types'
import { CoverArt } from './CoverArt'

interface Props {
  item: PromptItem
  onOpen: (item: PromptItem) => void
}

export function PromptCard({ item, onOpen }: Props) {
  const accent = CATEGORY_ACCENT[item.category]
  const captionTags = item.tags
    .filter((t) => t !== item.category && t !== item.collection && t !== item.medium)
    .slice(0, 2)

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
