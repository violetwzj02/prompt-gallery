export interface DriveImageRecord {
  fileId: string
  blob: Blob
  url: string
}

export type DriveImageSessionState =
  | { readonly status: 'active' }
  | { readonly status: 'ended'; readonly reason: DriveImageCacheFailureReason }

export type DriveImageSessionListener = (state: DriveImageSessionState) => void

export interface DriveImageCache {
  peek: (fileId: string) => DriveImageRecord | null
  acquire: (token: string, fileId: string, priority?: DriveImagePriority) => Promise<DriveImageRecord>
  release: (record: DriveImageRecord) => void
  prefetch: (token: string, fileIds: readonly string[]) => void
  rebindToken: (token: string) => void
  evict: (fileId: string) => void
  clear: (reason?: DriveImageCacheFailureReason) => void
  session: () => DriveImageSessionState
  subscribe: (listener: DriveImageSessionListener) => () => void
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
  recent: number
  boundToken: string | null
}

export type DriveImagePriority = 'high' | 'low'
export type DriveImageCacheFailureReason = 'logout' | 'account-switch' | 'reset'

export const DRIVE_IMAGE_SESSION_ENDED = '请重新连接谷歌云盘'

export class DriveImageCacheError extends Error {
  readonly reason: DriveImageCacheFailureReason
  readonly retryable: boolean

  constructor(reason: DriveImageCacheFailureReason) {
    super(DRIVE_IMAGE_SESSION_ENDED)
    this.name = 'DriveImageCacheError'
    this.reason = reason
    this.retryable = false
  }
}

export function isDriveImageCacheError(error: unknown): error is DriveImageCacheError {
  return error instanceof DriveImageCacheError
}

export function isDriveImageSessionEndedError(error: unknown): error is DriveImageCacheError {
  return error instanceof DriveImageCacheError && !error.retryable
}

export interface CreateDriveImageCacheOptions {
  fetchBlob: (input: { token: string; fileId: string }) => Promise<Blob>
  maxBytes?: number
  maxEntries?: number
  maxConcurrent?: number
  reservedHigh?: number
  recentPins?: number
  isRetryable?: (error: unknown) => boolean
}

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
  if (isDriveImageSessionEndedError(error)) return false
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
  const maxEntries = options.maxEntries ?? 48
  const maxConcurrent = Math.max(1, options.maxConcurrent ?? 4)
  const reservedHigh = Math.max(1, Math.min(options.reservedHigh ?? 2, maxConcurrent))
  const recentLimit = Math.max(0, options.recentPins ?? 8)
  const isRetryable = options.isRetryable ?? defaultIsRetryable

  let generation = 0
  let lastClearReason: DriveImageCacheFailureReason = 'reset'
  let activeHigh = 0
  let activeLow = 0
  let boundToken: string | null = null
  let sessionState: DriveImageSessionState = { status: 'active' }
  const sessionListeners = new Set<DriveImageSessionListener>()
  const entries = new Map<string, CacheEntry>()
  const inflight = new Map<string, Promise<DriveImageRecord>>()
  const queue: QueueJob[] = []
  const recent: string[] = []

  function activeTotal(): number {
    return activeHigh + activeLow
  }

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

  function setSessionState(next: DriveImageSessionState): void {
    sessionState = next
    for (const listener of sessionListeners) listener(next)
  }

  function noteRecent(fileId: string): void {
    if (recentLimit <= 0) return
    const index = recent.indexOf(fileId)
    if (index >= 0) recent.splice(index, 1)
    recent.push(fileId)
    if (recent.length > recentLimit) recent.shift()
  }

  const evicted = new Set<string>()

  function evictEntry(fileId: string, entry: CacheEntry): void {
    URL.revokeObjectURL(entry.url)
    entries.delete(fileId)
    const index = recent.indexOf(fileId)
    if (index >= 0) recent.splice(index, 1)
  }

  function evictIfNeeded(): void {
    const over = () => entries.size > maxEntries || totalBytes() > maxBytes
    if (!over()) return
    // Never evict in-use or recently viewed/prefetched images. Overflow is allowed
    // when those protected entries are what keep the cache over budget.
    for (const [fileId, entry] of entries) {
      if (!over()) return
      if (entry.refs > 0) continue
      if (recent.includes(fileId)) continue
      evictEntry(fileId, entry)
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
    noteRecent(fileId)
    return toRecord(entry)
  }

  function bumpQueuePriority(fileId: string): void {
    const job = queue.find((item) => item.fileId === fileId)
    if (job) job.priority = 'high'
  }

  function hasQueuedHigh(): boolean {
    return queue.some((item) => item.priority === 'high')
  }

  function canStart(priority: DriveImagePriority): boolean {
    if (priority === 'high') {
      if (activeTotal() < maxConcurrent) return true
      // Leave room for a foreground image even when low-priority thumbs filled the cap.
      return activeHigh < reservedHigh
    }
    if (activeTotal() >= maxConcurrent) return false
    const lowCap = Math.max(0, maxConcurrent - reservedHigh)
    if (hasQueuedHigh() && activeLow >= lowCap) return false
    return true
  }

  function takeNextJob(): QueueJob | undefined {
    const high = queue.findIndex((item) => item.priority === 'high')
    if (high >= 0 && canStart('high')) {
      const [job] = queue.splice(high, 1)
      return job
    }
    const low = queue.findIndex((item) => item.priority === 'low')
    if (low >= 0 && canStart('low')) {
      const [job] = queue.splice(low, 1)
      return job
    }
    return undefined
  }

  function resolveToken(fallback: string): string {
    return boundToken || fallback
  }

  async function fetchWithRetry(token: string, fileId: string, gen: number): Promise<Blob> {
    const attempt = async (): Promise<Blob> => {
      if (gen !== generation) throw new DriveImageCacheError(lastClearReason)
      return options.fetchBlob({ token: resolveToken(token), fileId })
    }
    try {
      return await attempt()
    } catch (error) {
      if (gen !== generation) {
        throw error instanceof DriveImageCacheError ? error : new DriveImageCacheError(lastClearReason)
      }
      if (!isRetryable(error)) throw error
      return attempt()
    }
  }

  function storeBlob(fileId: string, blob: Blob): DriveImageRecord {
    if (evicted.has(fileId)) {
      evicted.delete(fileId)
      throw new Error('图片已从缓存移除')
    }
    const existing = entries.get(fileId)
    if (existing) {
      existing.refs += 1
      touch(fileId)
      noteRecent(fileId)
      return toRecord(existing)
    }
    const url = URL.createObjectURL(blob)
    const entry: CacheEntry = { fileId, blob, url, refs: 1, size: blob.size }
    entries.set(fileId, entry)
    noteRecent(fileId)
    evictIfNeeded()
    return toRecord(entry)
  }

  function finishJob(priority: DriveImagePriority, fileId: string): void {
    if (priority === 'high') activeHigh -= 1
    else activeLow -= 1
    inflight.delete(fileId)
    pump()
  }

  function pump(): void {
    while (true) {
      const job = takeNextJob()
      if (!job) return
      if (job.generation !== generation) {
        job.reject(new DriveImageCacheError(lastClearReason))
        continue
      }
      const cached = retainCached(job.fileId)
      if (cached) {
        job.resolve(cached)
        continue
      }
      const gen = job.generation
      if (job.priority === 'high') activeHigh += 1
      else activeLow += 1
      void fetchWithRetry(job.token, job.fileId, gen)
        .then((blob) => {
          if (gen !== generation) throw new DriveImageCacheError(lastClearReason)
          return storeBlob(job.fileId, blob)
        })
        .then(
          (record) => {
            finishJob(job.priority, job.fileId)
            job.resolve(record)
          },
          (error) => {
            finishJob(job.priority, job.fileId)
            job.reject(error)
          },
        )
    }
  }

  function acquire(token: string, fileId: string, priority: DriveImagePriority = 'high'): Promise<DriveImageRecord> {
    if (sessionState.status === 'ended') return Promise.reject(new DriveImageCacheError(sessionState.reason))
    if (!boundToken) boundToken = token
    const cached = retainCached(fileId)
    if (cached) return Promise.resolve(cached)

    const pending = inflight.get(fileId)
    if (pending) {
      if (priority === 'high') bumpQueuePriority(fileId)
      return pending.then((record) => {
        const again = retainCached(record.fileId)
        if (again) return again
        throw new DriveImageCacheError(lastClearReason)
      })
    }

    const promise = new Promise<DriveImageRecord>((resolve, reject) => {
      queue.push({ token: resolveToken(token), fileId, priority, generation, resolve, reject })
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
    if (sessionState.status === 'ended') return
    const seen = new Set<string>()
    for (const fileId of fileIds) {
      if (!fileId || seen.has(fileId)) continue
      seen.add(fileId)
      void acquire(token, fileId, 'low').then(release, () => {
        /* prefetch failures are ignored */
      })
    }
  }

  function rebindToken(token: string): void {
    boundToken = token
    for (const job of queue) job.token = token
    if (sessionState.status === 'ended') setSessionState({ status: 'active' })
  }

  function evict(fileId: string): void {
    evicted.add(fileId)
    for (let index = queue.length - 1; index >= 0; index -= 1) {
      if (queue[index].fileId !== fileId) continue
      const job = queue.splice(index, 1)[0]
      job.reject(new Error('图片已从缓存移除'))
    }
    const entry = entries.get(fileId)
    if (entry) evictEntry(fileId, entry)
    if (!inflight.has(fileId)) evicted.delete(fileId)
  }

  function clear(reason: DriveImageCacheFailureReason = 'reset'): void {
    lastClearReason = reason
    generation += 1
    boundToken = null
    setSessionState({ status: 'ended', reason })
    const pending = queue.splice(0, queue.length)
    for (const job of pending) job.reject(new DriveImageCacheError(reason))
    inflight.clear()
    evicted.clear()
    for (const entry of entries.values()) URL.revokeObjectURL(entry.url)
    entries.clear()
    recent.splice(0, recent.length)
  }

  function stats(): DriveImageCacheStats {
    return {
      entries: entries.size,
      bytes: totalBytes(),
      refs: totalRefs(),
      inflight: inflight.size,
      generation,
      active: activeTotal(),
      queued: queue.length,
      recent: recent.length,
      boundToken,
    }
  }

  function session(): DriveImageSessionState {
    return sessionState
  }

  function subscribe(listener: DriveImageSessionListener): () => void {
    sessionListeners.add(listener)
    return () => {
      sessionListeners.delete(listener)
    }
  }

  return { peek, acquire, release, prefetch, rebindToken, evict, clear, session, subscribe, stats }
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

export function rebindDriveImageToken(token: string): void {
  albumDriveImageCache.rebindToken(token)
}

export function evictDriveImage(fileId: string): void {
  albumDriveImageCache.evict(fileId)
}

export function clearDriveImageCache(reason: DriveImageCacheFailureReason = 'reset'): void {
  albumDriveImageCache.clear(reason)
}

export function peekDriveImageSession(): DriveImageSessionState {
  return albumDriveImageCache.session()
}

export function subscribeDriveImageSession(listener: DriveImageSessionListener): () => void {
  return albumDriveImageCache.subscribe(listener)
}

export function driveImageCacheStats(): DriveImageCacheStats {
  return albumDriveImageCache.stats()
}
