/** Drive preview thumbnails, so grids and the flip book never fetch originals. */
import { fetchDriveThumbnailLink } from './googleDrive'

const MAX_CONCURRENT = 6

const thumbs = new Map<string, string>()
const inflight = new Map<string, Promise<string | null>>()
let active = 0
const waiting: Array<() => void> = []

export function peekDriveThumb(fileId: string | null | undefined): string | null {
  if (!fileId) return null
  return thumbs.get(fileId) ?? null
}

export function clearDriveThumbs(): void {
  thumbs.clear()
}

async function withSlot<T>(run: () => Promise<T>): Promise<T> {
  if (active >= MAX_CONCURRENT) await new Promise<void>((resolve) => waiting.push(resolve))
  active += 1
  try {
    return await run()
  } finally {
    active -= 1
    const next = waiting.shift()
    if (next) next()
  }
}

/** Resolves to a preview URL, or null when the file has no preview / the call failed. */
export function getDriveThumb(token: string | null, fileId: string | null): Promise<string | null> {
  if (!token || !fileId) return Promise.resolve(null)
  const cached = thumbs.get(fileId)
  if (cached) return Promise.resolve(cached)
  const pending = inflight.get(fileId)
  if (pending) return pending
  const promise = withSlot(() => fetchDriveThumbnailLink(token, fileId))
    .then((url) => {
      if (url) thumbs.set(fileId, url)
      return url
    })
    .catch(() => null)
    .finally(() => {
      inflight.delete(fileId)
    })
  inflight.set(fileId, promise)
  return promise
}
