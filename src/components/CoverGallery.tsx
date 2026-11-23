import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import type { PromptItem } from '../types'
import { CoverArt } from './CoverArt'
import { DownloadOriginalButton } from './DownloadOriginalButton'

interface Props {
  item: PromptItem
  images: string[]
}

interface ImageBox {
  left: number
  top: number
  width: number
  height: number
}

/** Painted box of an object-fit:contain image, relative to the gallery. */
function visibleImageBox(img: HTMLImageElement, container: DOMRect): ImageBox | null {
  const elem = img.getBoundingClientRect()
  if (elem.width <= 0 || elem.height <= 0) return null
  const nw = img.naturalWidth
  const nh = img.naturalHeight
  let width = elem.width
  let height = elem.height
  let left = elem.left
  let top = elem.top
  if (nw > 0 && nh > 0) {
    const scale = Math.min(elem.width / nw, elem.height / nh)
    width = nw * scale
    height = nh * scale
    left = elem.left + (elem.width - width) / 2
    top = elem.top + (elem.height - height) / 2
  }
  return {
    left: left - container.left,
    top: top - container.top,
    width,
    height,
  }
}

function sameBox(a: ImageBox | null, b: ImageBox | null) {
  if (a === b) return true
  if (!a || !b) return false
  return (
    Math.abs(a.left - b.left) < 0.5 &&
    Math.abs(a.top - b.top) < 0.5 &&
    Math.abs(a.width - b.width) < 0.5 &&
    Math.abs(a.height - b.height) < 0.5
  )
}

export function CoverGallery({ item, images }: Props) {
  const galleryRef = useRef<HTMLDivElement>(null)
  const scrollerRef = useRef<HTMLDivElement>(null)
  const indexRef = useRef(0)
  const [index, setIndex] = useState(0)
  const [imageBox, setImageBox] = useState<ImageBox | null>(null)
  const imagesKey = images.join('|')

  const measure = useCallback(() => {
    const gallery = galleryRef.current
    const scroller = scrollerRef.current
    if (!gallery || !scroller) return
    const imgs = scroller.querySelectorAll<HTMLImageElement>('img.cover-art__img')
    const img = imgs[indexRef.current]
    if (!img) {
      setImageBox((prev) => (prev ? null : prev))
      return
    }
    const box = visibleImageBox(img, gallery.getBoundingClientRect())
    setImageBox((prev) => (sameBox(prev, box) ? prev : box))
  }, [])

  useEffect(() => {
    indexRef.current = 0
    setIndex(0)
    setImageBox(null)
    scrollerRef.current?.scrollTo({ left: 0 })
  }, [item.id, imagesKey])

  const go = useCallback(
    (next: number) => {
      const count = images.length
      if (count <= 0) return
      const clamped = Math.max(0, Math.min(count - 1, next))
      if (clamped === indexRef.current) return
      const el = scrollerRef.current
      if (el) {
        el.scrollTo({ left: clamped * el.clientWidth, behavior: 'smooth' })
      }
      indexRef.current = clamped
      setIndex(clamped)
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
      measure()
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [images.length, measure])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
      const target = e.target as HTMLElement | null
      const tag = target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return
      const next = e.key === 'ArrowLeft' ? indexRef.current - 1 : indexRef.current + 1
      if (next < 0 || next >= images.length) return
      e.preventDefault()
      go(next)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [go, images.length])

  useEffect(() => {
    const gallery = galleryRef.current
    const scroller = scrollerRef.current
    if (!gallery || !scroller) return

    const run = () => measure()
    run()
    const raf = requestAnimationFrame(run)

    const ro = new ResizeObserver(run)
    ro.observe(gallery)
    ro.observe(scroller)
    for (const img of scroller.querySelectorAll('img.cover-art__img')) {
      ro.observe(img)
    }

    const onLoad = () => run()
    scroller.addEventListener('load', onLoad, true)
    window.addEventListener('resize', run)

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      scroller.removeEventListener('load', onLoad, true)
      window.removeEventListener('resize', run)
    }
  }, [measure, item.id, imagesKey, index])

  const atStart = index <= 0
  const atEnd = index >= images.length - 1
  const measured = Boolean(imageBox)

  const galleryStyle = imageBox
    ? ({
        '--nav-left': `${imageBox.left}px`,
        '--nav-right': `${imageBox.left + imageBox.width}px`,
        '--nav-top': `${imageBox.top}px`,
        '--nav-bottom': `${imageBox.top + imageBox.height}px`,
      } as CSSProperties)
    : undefined

  return (
    <div
      ref={galleryRef}
      className={`cover-gallery${measured ? ' cover-gallery--measured' : ''}`}
      style={galleryStyle}
      aria-roledescription="carousel"
      aria-label={`${item.title} 封面组图`}
    >
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
      {!atStart && (
        <button
          type="button"
          className="cover-gallery__nav cover-gallery__nav--prev"
          aria-label="上一张"
          onClick={() => go(indexRef.current - 1)}
        >
          ‹
        </button>
      )}
      {!atEnd && (
        <button
          type="button"
          className="cover-gallery__nav cover-gallery__nav--next"
          aria-label="下一张"
          onClick={() => go(indexRef.current + 1)}
        >
          ›
        </button>
      )}
      {images[index] && (
        <DownloadOriginalButton
          className="cover-gallery__download"
          url={images[index]}
          dataUrl={index === 0 ? item.coverDataUrl : undefined}
          filename={images[index].split('/').pop() || undefined}
          source={item.title}
        />
      )}
      {images.length > 1 && (
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
      )}
    </div>
  )
}
