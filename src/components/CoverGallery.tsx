import { useCallback, useEffect, useRef, useState } from 'react'
import type { PromptItem } from '../types'
import { CoverArt } from './CoverArt'

interface Props {
  item: PromptItem
  images: string[]
}

export function CoverGallery({ item, images }: Props) {
  const scrollerRef = useRef<HTMLDivElement>(null)
  const indexRef = useRef(0)
  const [index, setIndex] = useState(0)
  const imagesKey = images.join('|')

  useEffect(() => {
    indexRef.current = 0
    setIndex(0)
    scrollerRef.current?.scrollTo({ left: 0 })
  }, [item.id, imagesKey])

  const go = useCallback(
    (next: number) => {
      const count = images.length
      if (count <= 0) return
      const wrapped = ((next % count) + count) % count
      const el = scrollerRef.current
      if (el) {
        el.scrollTo({ left: wrapped * el.clientWidth, behavior: 'smooth' })
      }
      indexRef.current = wrapped
      setIndex(wrapped)
    },
    [images.length],
  )

  useEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    const onScroll = () => {
      const width = el.clientWidth
      if (width <= 0) return
      const next = Math.max(0, Math.min(images.length - 1, Math.round(el.scrollLeft / width)))
      if (next !== indexRef.current) {
        indexRef.current = next
        setIndex(next)
      }
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [images.length])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
      const target = e.target as HTMLElement | null
      const tag = target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return
      e.preventDefault()
      go(e.key === 'ArrowLeft' ? indexRef.current - 1 : indexRef.current + 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [go])

  return (
    <div className="cover-gallery" aria-roledescription="carousel" aria-label={`${item.title} 封面组图`}>
      <div className="cover-gallery__scroller" ref={scrollerRef} tabIndex={0}>
        {images.map((src, i) => (
          <div className="cover-gallery__slide" key={`${src}-${i}`} aria-hidden={i !== index}>
            <CoverArt
              item={{
                ...item,
                cover: src,
                coverDataUrl: i === 0 ? item.coverDataUrl : undefined,
              }}
              large
              fit="contain"
              className="detail-cover"
            />
          </div>
        ))}
      </div>
      <button
        type="button"
        className="cover-gallery__nav cover-gallery__nav--prev"
        aria-label="上一张"
        onClick={() => go(index - 1)}
      >
        ‹
      </button>
      <button
        type="button"
        className="cover-gallery__nav cover-gallery__nav--next"
        aria-label="下一张"
        onClick={() => go(index + 1)}
      >
        ›
      </button>
      <div className="cover-gallery__dots" role="tablist" aria-label="选择封面">
        {images.map((src, i) => (
          <button
            key={`${src}-dot-${i}`}
            type="button"
            role="tab"
            aria-label={`第 ${i + 1} 张`}
            aria-selected={i === index}
            className={i === index ? 'is-active' : ''}
            onClick={() => go(i)}
          />
        ))}
      </div>
    </div>
  )
}
