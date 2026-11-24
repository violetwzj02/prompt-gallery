import { useEffect, useState, type CSSProperties } from 'react'
import type { PromptItem } from '../types'
import { CATEGORY_SLUG } from '../types'
import { categoryAccent } from '../utils/category'
import { resolveCoverSrc } from '../utils/coverSrc'
import { collectionPalette } from '../utils/hash'

interface Props {
  item: PromptItem
  className?: string
  large?: boolean
  /** Detail hero uses contain so tall/wide covers are not cropped. */
  fit?: 'cover' | 'contain'
}

function SafeImage({
  src,
  className,
  fallbackSrcs,
}: {
  src: string
  className: string
  fallbackSrcs?: string[]
}) {
  const chain = [src, ...(fallbackSrcs ?? [])]
  const chainKey = chain.join('\n')
  const [index, setIndex] = useState(0)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    setIndex(0)
    setFailed(false)
  }, [chainKey])
  const current = chain[index]
  if (failed || !current) return null
  return (
    <img
      src={current}
      alt=""
      className={className}
      onError={() => {
        if (index + 1 < chain.length) {
          setIndex(index + 1)
          return
        }
        setFailed(true)
      }}
    />
  )
}


const BUILTIN_COVER_SLUGS = new Set(Object.values(CATEGORY_SLUG))
const ZIDINGYI_JPG = './covers/categories/zidingyi.jpg'
const ZIDINGYI_SVG = './covers/categories/zidingyi.svg'

function coverFallbacks(slug: string): string[] {
  const svg = `./covers/categories/${slug}.svg`
  if (BUILTIN_COVER_SLUGS.has(slug) && slug !== 'zidingyi') {
    return [svg]
  }
  if (slug === 'zidingyi') return [ZIDINGYI_SVG]
  return [svg, ZIDINGYI_JPG, ZIDINGYI_SVG]
}

export function CoverArt({ item, className = '', large = false, fit = 'cover' }: Props) {
  const hasPhoto = Boolean(item.coverDataUrl || item.cover)
  const contain = fit === 'contain' && hasPhoto
  const wrapClass = `cover-art ${contain ? 'cover-art--contain' : ''} ${className}`.trim()

  if (item.coverDataUrl) {
    return (
      <div className={wrapClass}>
        <SafeImage src={item.coverDataUrl} className="cover-art__img" />
      </div>
    )
  }
  if (item.cover) {
    return (
      <div className={wrapClass}>
        <SafeImage src={resolveCoverSrc(item.cover)} className="cover-art__img" />
      </div>
    )
  }

  const accent = categoryAccent(item.category)
  const key = item.parentId || item.collection || item.categorySlug
  const p = collectionPalette(key, item.id)
  const motif = item.collectionIndex ? (item.collectionIndex - 1 + p.motif) % 4 : p.motif
  const posX = 32 + (p.seed % 36)
  const posY = 32 + ((p.seed >> 6) % 36)
  const zoom = 1.08 + ((p.seed >> 3) % 16) / 50
  const hueRot = item.parentId
    ? ((item.collectionIndex ?? 1) * 53 + (p.seed % 24)) % 360
    : p.hue
  const n = 4 + (p.seed % 4)
  const shapes = Array.from({ length: n }, (_, i) => {
    const x = ((p.seed * (i + 5)) % 86) + 6
    const y = ((p.seed * (i + 11)) % 78) + 6
    const r = 9 + ((p.seed >> (i + 1)) % 32)
    const op = 0.1 + ((p.seed >> (i + 3)) % 22) / 100
    return { x, y, r, op, rot: (p.angle + i * 47) % 360 }
  })
  const uid = item.id.replace(/[^a-zA-Z0-9_-]/g, '_')
  const indexLabel =
    item.collectionIndex != null
      ? String(item.collectionIndex).padStart(2, '0')
      : ''

  return (
    <div
      className={`cover-art cover-art--generated ${className}`.trim()}
      style={
        {
          '--accent': accent,
          '--hue': `${p.hue}deg`,
          '--angle': `${p.angle}deg`,
          '--pos-x': `${posX}%`,
          '--pos-y': `${posY}%`,
          '--zoom': String(zoom),
          '--hue-rot': `${hueRot}deg`,
        } as CSSProperties
      }
    >
      <SafeImage
        src={`./covers/categories/${item.categorySlug}.jpg`}
        fallbackSrcs={coverFallbacks(item.categorySlug)}
        className="cover-art__base"
      />
      <svg
        className="cover-art__overlay"
        viewBox="0 0 100 100"
        preserveAspectRatio="xMidYMid slice"
        aria-hidden
      >
        <defs>
          <linearGradient id={`lg-${uid}`} x1="0" y1="0" x2="1" y2="1">
            <stop
              offset="0%"
              stopColor={`hsl(${hueRot} ${p.sat + 8}% ${p.light + 6}%)`}
              stopOpacity="0.55"
            />
            <stop offset="50%" stopColor={accent} stopOpacity="0.16" />
            <stop
              offset="100%"
              stopColor={`hsl(${(hueRot + 80) % 360} ${p.sat}% 16%)`}
              stopOpacity="0.5"
            />
          </linearGradient>
          <radialGradient id={`vg-${uid}`} cx={`${posX}%`} cy={`${posY}%`} r="75%">
            <stop offset="0%" stopColor="transparent" stopOpacity="0" />
            <stop offset="100%" stopColor="#000" stopOpacity="0.5" />
          </radialGradient>
          <pattern
            id={`grid-${uid}`}
            width={motif === 1 ? 7 : 16}
            height={motif === 1 ? 7 : 16}
            patternUnits="userSpaceOnUse"
            patternTransform={`rotate(${p.angle})`}
          >
            {motif === 1 ? (
              <path d="M 0 0 L 0 7" fill="none" stroke="#fff" strokeWidth="0.35" opacity="0.32" />
            ) : (
              <path
                d="M 16 0 L 0 0 0 16"
                fill="none"
                stroke="#fff"
                strokeWidth="0.28"
                opacity="0.26"
              />
            )}
          </pattern>
        </defs>
        <rect width="100" height="100" fill={`url(#lg-${uid})`} />
        <rect width="100" height="100" fill={`url(#grid-${uid})`} />
        <rect width="100" height="100" fill={`url(#vg-${uid})`} />

        {motif === 0 &&
          shapes.map((s, i) => (
            <circle key={i} cx={s.x} cy={s.y} r={s.r / (large ? 0.9 : 1.05)} fill={accent} opacity={s.op + 0.06} />
          ))}

        {motif === 1 &&
          shapes.map((s, i) => (
            <rect
              key={i}
              x={s.x - 1.4}
              y={4}
              width="2.6"
              height={70 + (s.r % 24)}
              fill="#fff"
              opacity={s.op + 0.08}
              transform={`rotate(${s.rot * 0.2} ${s.x} 50)`}
            />
          ))}

        {motif === 2 &&
          shapes.map((s, i) => (
            <polygon
              key={i}
              points={`${s.x},${s.y - s.r / 1.2} ${s.x + s.r / 1.4},${s.y + s.r / 1.8} ${s.x - s.r / 1.4},${s.y + s.r / 1.8}`}
              fill="none"
              stroke="#fff"
              strokeWidth="0.55"
              opacity={s.op + 0.18}
              transform={`rotate(${s.rot} ${s.x} ${s.y})`}
            />
          ))}

        {motif === 3 &&
          shapes.map((s, i) => (
            <circle
              key={i}
              cx={s.x}
              cy={s.y}
              r={s.r / (large ? 0.85 : 1)}
              fill="none"
              stroke={accent}
              strokeWidth="0.9"
              opacity={s.op + 0.2}
            />
          ))}

        {indexLabel && (
          <text
            x="6"
            y="28"
            fill="#fff"
            opacity="0.18"
            fontSize="22"
            fontWeight="600"
            fontFamily="PingFang SC, Noto Sans SC, system-ui, sans-serif"
          >
            {indexLabel}
          </text>
        )}
      </svg>
    </div>
  )
}
