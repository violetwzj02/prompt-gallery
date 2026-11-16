import type { Category, CollectionInfo } from '../types'
import { CATEGORIES, CATEGORY_ACCENT } from '../types'
import type { GalleryFilters } from '../utils/filters'
import { toggleIn } from '../utils/filters'

interface Counts {
  category: Record<string, number>
  collection: Record<string, number>
  medium: Record<string, number>
  aspect: Record<string, number>
  style: Record<string, number>
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
}

function Row({
  label,
  count,
  active,
  onClick,
  swatch,
}: {
  label: string
  count: number
  active: boolean
  onClick: () => void
  swatch?: string
}) {
  return (
    <button type="button" className={`rail-row ${active ? 'is-active' : ''}`} onClick={onClick}>
      <span className="rail-row__label">
        {swatch && (
          <i className="rail-dot" style={{ background: swatch }} aria-hidden />
        )}
        {label}
      </span>
      <span className="rail-row__count">{count}</span>
    </button>
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
}: Props) {
  const visibleCollections = collections.filter((c) => (counts.collection[c.id] ?? 0) > 0 || filters.collectionId === c.id)

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

      <section className="rail-section">
        <h2 className="rail-heading">大类</h2>
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
      </section>

      {visibleCollections.length > 0 && (
        <section className="rail-section">
          <h2 className="rail-heading">合集</h2>
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
        </section>
      )}

      {mediums.length > 0 && (
        <section className="rail-section">
          <h2 className="rail-heading">媒介</h2>
          {mediums.map((m) => (
            <Row
              key={m}
              label={m}
              count={counts.medium[m] ?? 0}
              active={filters.mediums.includes(m)}
              onClick={() => onChange({ ...filters, mediums: toggleIn(filters.mediums, m) })}
            />
          ))}
        </section>
      )}

      {aspects.length > 0 && (
        <section className="rail-section">
          <h2 className="rail-heading">画幅</h2>
          {aspects.map((a) => (
            <Row
              key={a}
              label={a}
              count={counts.aspect[a] ?? 0}
              active={filters.aspects.includes(a)}
              onClick={() => onChange({ ...filters, aspects: toggleIn(filters.aspects, a) })}
            />
          ))}
        </section>
      )}

      {styles.length > 0 && (
        <section className="rail-section">
          <h2 className="rail-heading">风格 / 用途</h2>
          {styles.map((s) => (
            <Row
              key={s}
              label={s}
              count={counts.style[s] ?? 0}
              active={filters.styles.includes(s)}
              onClick={() => onChange({ ...filters, styles: toggleIn(filters.styles, s) })}
            />
          ))}
        </section>
      )}

      <p className="rail-note">
        大类、合集为单选。媒介与画幅在组内为「或」，风格标签之间为「且」。
      </p>

      <button type="button" className="rail-clear" onClick={onClear}>
        清除全部筛选
      </button>
    </aside>
  )
}
