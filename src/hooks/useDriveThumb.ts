import { useEffect, useState } from 'react'
import { getDriveThumb, peekDriveThumb } from '../lib/driveThumbnails'

/** Preview URL for a Drive file; null until it is known (or when unavailable). */
export function useDriveThumb(token: string | null, fileId: string | null): string | null {
  const [url, setUrl] = useState<string | null>(() => peekDriveThumb(fileId))

  useEffect(() => {
    const cached = peekDriveThumb(fileId)
    if (cached) {
      setUrl(cached)
      return
    }
    setUrl(null)
    if (!token || !fileId) return
    let cancelled = false
    void getDriveThumb(token, fileId).then((next) => {
      if (!cancelled) setUrl(next)
    })
    return () => {
      cancelled = true
    }
  }, [token, fileId])

  return url
}
