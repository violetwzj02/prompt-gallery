export interface DriveImageRecord {
  fileId: string
  blob: Blob
  url: string
}

export interface DriveImageCache {
  peek: (fileId: string) => DriveImageRecord | null
  acquire: (token: string, fileId: string, priority?: DriveImagePriority) => Promise<DriveImageRecord>
  release: (record: DriveImageRecord) => void
  prefetch: (token: string, fileIds: readonly string[]) => void
  clear: () => void
  stats: () => DriveImageCacheStats
}

export interface DriveImageCacheStats {
  entries: number
  bytes: number
  refs: number
  inflight: number
  generation: number
  active: number
  queued: number
}

export type DriveImagePriority = 'high' | 'low'

export interface CreateDriveImageCacheOptions {
  fetchBlob: (input: { token: string; fileId: string }) => Promise<Blob>
  maxBytes?: number
  maxEntries?: number
  maxConcurrent?: number
  isRetryable?: (error: unknown) => boolean
}

const CACHE_CLEARED = '相册图片缓存已清空'

interface CacheEntry {
  fileId: string
  blob: Blob
  url: string
  refs: number
  size: number
}

interface QueueJob {
  token: string
  fileId: string
  priority: DriveImagePriority
  generation: number
  resolve: (record: DriveImageRecord) => void
  reject: (error: unknown) => void
}

function defaultIsRetryable(error: unknown): boolean {
  if (typeof DOMException !== 'undefined' && error instanceof DOMException && error.name === 'AbortError') {
    return true
  }
  if (!(error instanceof Error)) return false
  const raw = `${error.name} ${error.message}`.toLowerCase()
  if (raw.includes('abort')) return true
  if (raw.includes('failed to fetch') || raw.includes('networkerror') || raw.includes('load failed')) return true
  if (error.message.includes('无法连接 Google 服务')) return true
  return false
}

function toRecord(entry: CacheEntry): DriveImageRecord {
  return { fileId: entry.fileId, blob: entry.blob, url: entry.url }
}

export function createDriveImageCache(options: CreateDriveImageCacheOptions): DriveImageCache {
  const maxBytes = options.maxBytes ?? 64 * 1024 * 1024
  const maxEntries = options.maxEntries ?? 32
  const maxConcurrent = Math.max(1, options.maxConcurrent ?? 4)
  const isRetryable = options.isRetryable ?? defaultIsRetryable

  let generation = 0
  let active = 0
  const entries = new Map<string, CacheEntry>()
  const inflight = new Map<string, Promise<DriveImageRecord>>()
  const queue: QueueJob[] = []

  function totalBytes(): number {
    let total = 0
    for (const entry of entries.values()) total += entry.size
    return total
  }

  function totalRefs(): number {
    let total = 0
    for (const entry of entries.values()) total += entry.refs
    return total
  }

  function evictIfNeeded(): void {
    const over = () => entries.size > maxEntries || totalBytes() > maxBytes
    if (!over()) return
    for (const [fileId, entry] of entries) {
      if (!over()) return
      if (entry.refs > 0) continue
      URL.revokeObjectURL(entry.url)
      entries.delete(fileId)
    }
  }

  function touch(fileId: string): void {
    const entry = entries.get(fileId)
    if (!entry) return
    entries.delete(fileId)
    entries.set(fileId, entry)
  }

  function retainCached(fileId: string): DriveImageRecord | null {
    const entry = entries.get(fileId)
    if (!entry) return null
    entry.refs += 1
    touch(fileId)
    return toRecord(entry)
  }

  function bumpQueuePriority(fileId: string): void {
    const job = queue.find((item) => item.fileId === fileId)
    if (job) job.priority = 'high'
  }

  function takeNextJob(): QueueJob | undefined {
    const high = queue.findIndex((item) => item.priority === 'high')
    if (high >= 0) {
      const [job] = queue.splice(high, 1)
      return job
    }
    return queue.shift()
  }

  async function fetchWithRetry(token: string, fileId: string, gen: number): Promise<Blob> {
    const attempt = async (): Promise<Blob> => {
      if (gen !== generation) throw new Error(CACHE_CLEARED)
      return options.fetchBlob({ token, fileId })
    }
    try {
      return await attempt()
    } catch (error) {
      if (gen !== generation) throw new Error(CACHE_CLEARED)
      if (!isRetryable(error)) throw error
      return attempt()
    }
  }

  function storeBlob(fileId: string, blob: Blob): DriveImageRecord {
    const existing = entries.get(fileId)
    if (existing) {
      existing.refs += 1
      touch(fileId)
      return toRecord(existing)
    }
    const url = URL.createObjectURL(blob)
    const entry: CacheEntry = { fileId, blob, url, refs: 1, size: blob.size }
    entries.set(fileId, entry)
    evictIfNeeded()
    return toRecord(entry)
  }

  function pump(): void {
    while (active < maxConcurrent) {
      const job = takeNextJob()
      if (!job) return
      if (job.generation !== generation) {
        job.reject(new Error(CACHE_CLEARED))
        continue
      }
      const cached = retainCached(job.fileId)
      if (cached) {
        job.resolve(cached)
        continue
      }
      const gen = job.generation
      active += 1
      const finishJob = () => {
        active -= 1
        inflight.delete(job.fileId)
        pump()
      }
      void fetchWithRetry(job.token, job.fileId, gen)
        .then((blob) => {
          if (gen !== generation) throw new Error(CACHE_CLEARED)
          return storeBlob(job.fileId, blob)
        })
        .then(
          (record) => {
            finishJob()
            job.resolve(record)
          },
          (error) => {
            finishJob()
            job.reject(error)
          },
        )
    }
  }

  function acquire(token: string, fileId: string, priority: DriveImagePriority = 'high'): Promise<DriveImageRecord> {
    const cached = retainCached(fileId)
    if (cached) return Promise.resolve(cached)

    const pending = inflight.get(fileId)
    if (pending) {
      if (priority === 'high') bumpQueuePriority(fileId)
      return pending.then((record) => {
        const again = retainCached(record.fileId)
        if (again) return again
        throw new Error(CACHE_CLEARED)
      })
    }

    const promise = new Promise<DriveImageRecord>((resolve, reject) => {
      queue.push({ token, fileId, priority, generation, resolve, reject })
    })
    inflight.set(fileId, promise)
    pump()
    return promise
  }

  function release(record: DriveImageRecord): void {
    const entry = entries.get(record.fileId)
    if (!entry || entry.url !== record.url) return
    entry.refs = Math.max(0, entry.refs - 1)
    evictIfNeeded()
  }

  function peek(fileId: string): DriveImageRecord | null {
    const entry = entries.get(fileId)
    return entry ? toRecord(entry) : null
  }

  function prefetch(token: string, fileIds: readonly string[]): void {
    const seen = new Set<string>()
    for (const fileId of fileIds) {
      if (!fileId || seen.has(fileId)) continue
      seen.add(fileId)
      void acquire(token, fileId, 'low').then(release, () => {
        /* prefetch failures are ignored */
      })
    }
  }

  function clear(): void {
    generation += 1
    const pending = queue.splice(0, queue.length)
    for (const job of pending) job.reject(new Error(CACHE_CLEARED))
    inflight.clear()
    for (const entry of entries.values()) URL.revokeObjectURL(entry.url)
    entries.clear()
  }

  function stats(): DriveImageCacheStats {
    return {
      entries: entries.size,
      bytes: totalBytes(),
      refs: totalRefs(),
      inflight: inflight.size,
      generation,
      active,
      queued: queue.length,
    }
  }

  return { peek, acquire, release, prefetch, clear, stats }
}

let fetchBlobImpl: CreateDriveImageCacheOptions['fetchBlob'] | null = null

export function setDriveImageBlobFetcher(fetcher: CreateDriveImageCacheOptions['fetchBlob'] | null): void {
  fetchBlobImpl = fetcher
}

const albumDriveImageCache = createDriveImageCache({
  fetchBlob: (input) => {
    if (!fetchBlobImpl) return Promise.reject(new Error('云盘图片读取尚未就绪'))
    return fetchBlobImpl(input)
  },
})

export function peekDriveImage(fileId: string): DriveImageRecord | null {
  return albumDriveImageCache.peek(fileId)
}

export function acquireDriveImage(
  token: string,
  fileId: string,
  priority: DriveImagePriority = 'high',
): Promise<DriveImageRecord> {
  return albumDriveImageCache.acquire(token, fileId, priority)
}

export function releaseDriveImage(record: DriveImageRecord): void {
  albumDriveImageCache.release(record)
}

export function prefetchDriveImages(token: string, fileIds: readonly string[]): void {
  albumDriveImageCache.prefetch(token, fileIds)
}

export function clearDriveImageCache(): void {
  albumDriveImageCache.clear()
}

export function driveImageCacheStats(): DriveImageCacheStats {
  return albumDriveImageCache.stats()
}
