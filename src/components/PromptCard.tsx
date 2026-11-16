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
    >
      <CoverArt item={item} className="prompt-card__cover" />
      <div className="prompt-card__body">
        <div className="prompt-card__meta">
          <span className="tag" style={{ color: accent, borderColor: `${accent}55` }}>
            {item.category}
          </span>
          {item.local && <span className="tag tag--local">本地</span>}
        </div>
        <h3 className="prompt-card__title">{item.title}</h3>
        <p className="prompt-card__usage">{item.usage}</p>
      </div>
    </article>
  )
}
