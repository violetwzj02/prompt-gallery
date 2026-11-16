import type { CSSProperties } from 'react'
import type { PromptItem } from '../types'
import { CATEGORY_ACCENT } from '../types'
import { paletteFromId } from '../utils/hash'

interface Props {
  item: PromptItem
  className?: string
  large?: boolean
}

export function CoverArt({ item, className = '', large = false }: Props) {
  if (item.coverDataUrl) {
    return (
      <div className={`cover-art ${className}`}>
        <img src={item.coverDataUrl} alt="" className="cover-art__img" />
      </div>
    )
  }
  if (item.cover) {
    return (
      <div className={`cover-art ${className}`}>
        <img src={`./${item.cover}`} alt="" className="cover-art__img" />
      </div>
    )
  }

  const accent = CATEGORY_ACCENT[item.category]
  const p = paletteFromId(item.id)
  const n = (p.seed % 5) + 3
  const shapes = Array.from({ length: n }, (_, i) => {
    const x = ((p.seed * (i + 3)) % 80) + 10
    const y = ((p.seed * (i + 7)) % 70) + 10
    const r = 8 + ((p.seed >> (i + 2)) % 28)
    const op = 0.08 + ((p.seed >> (i + 4)) % 20) / 100
    return { x, y, r, op, rot: (p.angle + i * 37) % 360 }
  })

  return (
    <div
      className={`cover-art cover-art--generated ${className}`}
      style={
        {
          '--accent': accent,
          '--hue': `${p.hue}deg`,
          '--angle': `${p.angle}deg`,
        } as CSSProperties
      }
    >
      <img
        src={`./covers/categories/${item.categorySlug}.jpg`}
        alt=""
        className="cover-art__base"
      />
      <svg
        className="cover-art__overlay"
        viewBox="0 0 100 100"
        preserveAspectRatio="xMidYMid slice"
        aria-hidden
      >
        <defs>
          <linearGradient id={`lg-${item.id}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={`hsl(${p.hue} ${p.sat}% ${p.light}%)`} stopOpacity="0.35" />
            <stop offset="100%" stopColor={accent} stopOpacity="0.15" />
          </linearGradient>
          <pattern
            id={`grid-${item.id}`}
            width="12"
            height="12"
            patternUnits="userSpaceOnUse"
            patternTransform={`rotate(${p.angle})`}
          >
            <path
              d="M 12 0 L 0 0 0 12"
              fill="none"
              stroke={accent}
              strokeWidth="0.3"
              opacity="0.35"
            />
          </pattern>
        </defs>
        <rect width="100" height="100" fill={`url(#lg-${item.id})`} />
        <rect width="100" height="100" fill={`url(#grid-${item.id})`} />
        {shapes.map((s, i) =>
          i % 2 === 0 ? (
            <circle
              key={i}
              cx={s.x}
              cy={s.y}
              r={s.r / (large ? 1 : 1.2)}
              fill={accent}
              opacity={s.op}
            />
          ) : (
            <rect
              key={i}
              x={s.x - s.r / 2}
              y={s.y - s.r / 2}
              width={s.r}
              height={s.r}
              fill="none"
              stroke={accent}
              strokeWidth="0.6"
              opacity={s.op + 0.1}
              transform={`rotate(${s.rot} ${s.x} ${s.y})`}
            />
          ),
        )}
        <text
          x="6"
          y="94"
          fill="#fff"
          opacity="0.55"
          fontSize="4.5"
          fontFamily="JetBrains Mono, monospace"
        >
          {item.id}
        </text>
      </svg>
    </div>
  )
}
