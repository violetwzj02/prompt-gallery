import { useState } from 'react'
import {
  basenameFromUrl,
  downloadOriginal,
  extFromMime,
  resolveGallerySrc,
  sanitizeFilename,
} from '../utils/downloadOriginal'

interface Props {
  url?: string | null
  dataUrl?: string | null
  filename?: string
  source?: string
  blob?: Blob
  className?: string
  onStatus?: (message: string) => void
}

function DownloadIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path
        d="M12 3v11.2M8.2 10.5 12 14.3l3.8-3.8M5 18.5h14"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function DownloadOriginalButton({
  url,
  dataUrl,
  filename,
  source,
  blob,
  className = '',
  onStatus,
}: Props) {
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const href = resolveGallerySrc(url, dataUrl)

  if (!href && !blob) return null

  const run = async () => {
    if (busy) return
    setBusy(true)
    setNote(null)
    try {
      const name =
        filename ||
        (blob ? `image.${extFromMime(blob.type || 'image/jpeg')}` : basenameFromUrl(href || ''))
      const result = await downloadOriginal({
        url: href || '',
        filename: sanitizeFilename(name),
        source,
        blob,
      })
      const message = result.folderName
        ? `已保存到「${result.folderName}」`
        : result.status === 'success'
          ? '已开始下载原图'
          : result.error || '下载失败'
      setNote(message)
      onStatus?.(message)
    } catch (error) {
      const message = error instanceof Error ? error.message : '下载失败'
      setNote(message)
      onStatus?.(message)
    } finally {
      setBusy(false)
      window.setTimeout(() => setNote(null), 2800)
    }
  }

  return (
    <button
      type="button"
      className={`download-original ${className}`.trim()}
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        void run()
      }}
      disabled={busy}
      aria-label="下载原图"
      title="下载原图"
    >
      <DownloadIcon />
      <span>{busy ? '正在下载…' : note || '下载原图'}</span>
    </button>
  )
}
