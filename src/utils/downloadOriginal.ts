/** Same-origin original-file download, optional folder handle, and local history. */

export const DOWNLOAD_HISTORY_KEY = 'prompt-gallery-download-history'
const HISTORY_LIMIT = 100
const IDB_NAME = 'prompt-gallery-downloads'
const IDB_STORE = 'handles'
const IDB_KEY = 'directory'
const HISTORY_EVENT = 'pg-download-history-changed'

export type DownloadStatus = 'success' | 'fail'

export interface DownloadHistoryItem {
  id: string
  filename: string
  source: string
  url: string
  time: number
  size: number | null
  status: DownloadStatus
  folderName: string | null
  error?: string
}

export interface DownloadRequest {
  url: string
  filename?: string
  source?: string
  blob?: Blob
}

type DirectoryPickerOptions = {
  id?: string
  mode?: 'read' | 'readwrite'
  startIn?: FileSystemHandle | 'desktop' | 'documents' | 'downloads' | 'music' | 'pictures' | 'videos'
}

type PermissionedHandle = FileSystemDirectoryHandle & {
  queryPermission?: (descriptor?: { mode?: 'read' | 'readwrite' }) => Promise<PermissionState>
  requestPermission?: (descriptor?: { mode?: 'read' | 'readwrite' }) => Promise<PermissionState>
}

declare global {
  interface Window {
    showDirectoryPicker?: (options?: DirectoryPickerOptions) => Promise<FileSystemDirectoryHandle>
  }
}

export function canUseDirectoryPicker(): boolean {
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function'
}

export function sanitizeFilename(name: string): string {
  const trimmed = name.replace(/\\/g, '/').split('/').pop() || ''
  const cleaned = trimmed
    .replace(/[\\/:*?"<>|]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+$/, '')
    .slice(0, 120)
  return cleaned || 'image.jpg'
}

export function basenameFromUrl(url: string): string {
  if (!url) return 'image.jpg'
  if (url.startsWith('data:')) {
    const mime = url.slice(5).split(';')[0] || 'image/jpeg'
    const ext = extFromMime(mime)
    return `image.${ext}`
  }
  try {
    const path = url.includes('://') || url.startsWith('//')
      ? new URL(url, typeof window !== 'undefined' ? window.location.href : 'https://example.com').pathname
      : url.split('?')[0].split('#')[0]
    const base = sanitizeFilename(decodeURIComponent(path))
    return base.includes('.') ? base : `${base || 'image'}.jpg`
  } catch {
    return 'image.jpg'
  }
}

export function extFromMime(mime: string): string {
  if (mime.includes('png')) return 'png'
  if (mime.includes('webp')) return 'webp'
  if (mime.includes('gif')) return 'gif'
  if (mime.includes('svg')) return 'svg'
  if (mime.includes('avif')) return 'avif'
  if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg'
  return 'jpg'
}

export function formatBytes(size: number | null | undefined): string {
  if (size == null || !Number.isFinite(size) || size < 0) return '—'
  if (size < 1024) return `${Math.round(size)} B`
  if (size < 1024 * 1024) {
    const kb = size / 1024
    return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`
  }
  const mb = size / (1024 * 1024)
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`
}

export function formatDownloadTime(time: number): string {
  if (!Number.isFinite(time)) return '—'
  return new Date(time).toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
}

export function parseDownloadHistory(raw: string | null | undefined): DownloadHistoryItem[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    const items: DownloadHistoryItem[] = []
    for (const value of parsed) {
      if (!value || typeof value !== 'object') continue
      const rec = value as Record<string, unknown>
      if (typeof rec.id !== 'string' || typeof rec.filename !== 'string') continue
      const status: DownloadStatus = rec.status === 'fail' ? 'fail' : 'success'
      items.push({
        id: rec.id,
        filename: rec.filename,
        source: typeof rec.source === 'string' ? rec.source : '',
        url: typeof rec.url === 'string' ? rec.url : '',
        time: typeof rec.time === 'number' ? rec.time : 0,
        size: typeof rec.size === 'number' ? rec.size : null,
        status,
        folderName: typeof rec.folderName === 'string' ? rec.folderName : null,
        error: typeof rec.error === 'string' ? rec.error : undefined,
      })
    }
    return items.slice(0, HISTORY_LIMIT)
  } catch {
    return []
  }
}

export function loadDownloadHistory(): DownloadHistoryItem[] {
  if (typeof localStorage === 'undefined') return []
  try {
    return parseDownloadHistory(localStorage.getItem(DOWNLOAD_HISTORY_KEY))
  } catch {
    return []
  }
}

export function saveDownloadHistory(items: DownloadHistoryItem[]): void {
  if (typeof localStorage === 'undefined') return
  const next = items.slice(0, HISTORY_LIMIT)
  localStorage.setItem(DOWNLOAD_HISTORY_KEY, JSON.stringify(next))
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(HISTORY_EVENT))
  }
}

export function recordDownload(item: DownloadHistoryItem): DownloadHistoryItem[] {
  const next = [item, ...loadDownloadHistory().filter((entry) => entry.id !== item.id)].slice(0, HISTORY_LIMIT)
  saveDownloadHistory(next)
  return next
}

export function clearDownloadHistory(): void {
  saveDownloadHistory([])
}

export function subscribeDownloadHistory(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined
  const onStorage = (event: StorageEvent) => {
    if (event.key === DOWNLOAD_HISTORY_KEY || event.key === null) listener()
  }
  window.addEventListener('storage', onStorage)
  window.addEventListener(HISTORY_EVENT, listener)
  return () => {
    window.removeEventListener('storage', onStorage)
    window.removeEventListener(HISTORY_EVENT, listener)
  }
}

function openHandleDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(IDB_STORE)) {
        req.result.createObjectStore(IDB_STORE)
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('无法打开下载目录记录'))
  })
}

export async function getStoredDirectoryHandle(): Promise<FileSystemDirectoryHandle | null> {
  if (typeof indexedDB === 'undefined') return null
  try {
    const db = await openHandleDb()
    try {
      const handle = await new Promise<FileSystemDirectoryHandle | null>((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, 'readonly')
        const req = tx.objectStore(IDB_STORE).get(IDB_KEY)
        req.onsuccess = () => resolve((req.result as FileSystemDirectoryHandle | undefined) ?? null)
        req.onerror = () => reject(req.error)
      })
      return handle
    } finally {
      db.close()
    }
  } catch {
    return null
  }
}

export async function storeDirectoryHandle(handle: FileSystemDirectoryHandle | null): Promise<void> {
  const db = await openHandleDb()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite')
      const store = tx.objectStore(IDB_STORE)
      const req = handle ? store.put(handle, IDB_KEY) : store.delete(IDB_KEY)
      req.onsuccess = () => resolve()
      req.onerror = () => reject(req.error)
    })
  } finally {
    db.close()
  }
}

export async function ensureDirectoryPermission(
  handle: FileSystemDirectoryHandle,
  interactive = true,
): Promise<boolean> {
  const h = handle as PermissionedHandle
  const descriptor = { mode: 'readwrite' as const }
  try {
    if (h.queryPermission) {
      const current = await h.queryPermission(descriptor)
      if (current === 'granted') return true
      if (current === 'denied' || !interactive) return false
    }
    if (interactive && h.requestPermission) {
      return (await h.requestPermission(descriptor)) === 'granted'
    }
    return !h.queryPermission
  } catch {
    return false
  }
}

export async function pickDownloadDirectory(): Promise<FileSystemDirectoryHandle> {
  if (!canUseDirectoryPicker() || !window.showDirectoryPicker) {
    throw new Error('当前浏览器不支持选择下载文件夹')
  }
  const existing = await getStoredDirectoryHandle()
  const handle = await window.showDirectoryPicker({
    id: 'prompt-gallery-downloads',
    mode: 'readwrite',
    startIn: existing ?? 'downloads',
  })
  await storeDirectoryHandle(handle)
  return handle
}

export async function clearDownloadDirectory(): Promise<void> {
  await storeDirectoryHandle(null)
}

export type RevealFolderResult = 'opened' | 'unsupported' | 'none' | 'denied'

export async function revealDownloadFolder(): Promise<RevealFolderResult> {
  if (!canUseDirectoryPicker() || !window.showDirectoryPicker) return 'unsupported'
  const handle = await getStoredDirectoryHandle()
  if (!handle) return 'none'
  const allowed = await ensureDirectoryPermission(handle, true)
  if (!allowed) return 'denied'
  try {
    const next = await window.showDirectoryPicker({
      id: 'prompt-gallery-downloads',
      mode: 'readwrite',
      startIn: handle,
    })
    await storeDirectoryHandle(next)
    return 'opened'
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return 'opened'
    throw error
  }
}

async function resolveBlob(request: DownloadRequest): Promise<{ blob: Blob; url: string }> {
  if (request.blob) return { blob: request.blob, url: request.url }
  const url = request.url
  if (!url) throw new Error('没有可下载的原图地址')
  const response = await fetch(url)
  if (!response.ok) throw new Error(`无法读取原图（${response.status}）`)
  return { blob: await response.blob(), url }
}

function triggerBrowserDownload(blob: Blob, filename: string, fallbackUrl: string): void {
  const objectUrl = URL.createObjectURL(blob)
  try {
    const a = document.createElement('a')
    a.href = objectUrl
    a.download = filename
    a.rel = 'noopener'
    a.style.display = 'none'
    document.body.appendChild(a)
    a.click()
    a.remove()
  } catch {
    const a = document.createElement('a')
    a.href = fallbackUrl
    a.download = filename
    a.rel = 'noopener'
    a.target = '_blank'
    document.body.appendChild(a)
    a.click()
    a.remove()
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000)
  }
}

async function writeToDirectory(handle: FileSystemDirectoryHandle, filename: string, blob: Blob): Promise<void> {
  const fileHandle = await handle.getFileHandle(filename, { create: true })
  const writable = await fileHandle.createWritable()
  try {
    await writable.write(blob)
  } finally {
    await writable.close()
  }
}

export function isEphemeralUrl(url: string): boolean {
  return url.startsWith('blob:') || url.startsWith('data:')
}

export async function downloadOriginal(request: DownloadRequest): Promise<DownloadHistoryItem> {
  const filename = sanitizeFilename(request.filename || basenameFromUrl(request.url))
  const source = (request.source || '').trim()
  const started: DownloadHistoryItem = {
    id: `dl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    filename,
    source,
    url: isEphemeralUrl(request.url) ? '' : request.url,
    time: Date.now(),
    size: request.blob?.size ?? null,
    status: 'fail',
    folderName: null,
  }

  try {
    const { blob, url } = await resolveBlob(request)
    started.size = blob.size
    if (!started.url && !isEphemeralUrl(url)) started.url = url

    const handle = await getStoredDirectoryHandle()
    if (handle && (await ensureDirectoryPermission(handle, true))) {
      await writeToDirectory(handle, filename, blob)
      started.folderName = handle.name
      started.status = 'success'
      recordDownload(started)
      return started
    }

    if (typeof document === 'undefined') throw new Error('当前环境无法开始下载')
    triggerBrowserDownload(blob, filename, url)
    started.status = 'success'
    if (handle) started.folderName = null
    recordDownload(started)
    return started
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      started.error = '已取消下载'
      recordDownload(started)
      return started
    }
    started.error = error instanceof Error ? error.message : '下载失败'
    recordDownload(started)
    throw Object.assign(error instanceof Error ? error : new Error(started.error), { record: started })
  }
}

export function resolveGallerySrc(src: string | null | undefined, dataUrl?: string | null): string | null {
  if (dataUrl) return dataUrl
  const value = src?.trim()
  if (!value) return null
  if (/^(data:|blob:|https?:\/\/|\/\/)/i.test(value)) return value
  return `./${value.replace(/^\.\//, '')}`
}
