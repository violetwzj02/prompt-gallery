export const DRIVE_FOLDER_NAME = '风格 Prompt 图鉴·云端相册'
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file'
export const MAX_ALBUM_FILE_BYTES = 50 * 1024 * 1024
export const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const
export type AcceptedImageType = (typeof ACCEPTED_IMAGE_TYPES)[number]

const GIS_SRC = 'https://accounts.google.com/gsi/client'
const TOKEN_STORAGE_KEY = 'prompt-gallery.drive.token.v1'
const TOKEN_SKEW_MS = 60_000
const DRIVE_API = 'https://www.googleapis.com/drive/v3'
const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files'

interface TokenPayload {
  accessToken: string
  expiresAt: number
  email?: string
}

interface TokenClient {
  requestAccessToken: (override?: { prompt?: string }) => void
}

interface GoogleOauth2 {
  initTokenClient: (config: {
    client_id: string
    scope: string
    callback: (response: GoogleTokenResponse) => void
    error_callback?: (error: { type?: string; message?: string }) => void
  }) => TokenClient
}

interface GoogleTokenResponse {
  access_token?: string
  expires_in?: number
  error?: string
  error_description?: string
}

declare global {
  interface Window {
    google?: { accounts?: { oauth2?: GoogleOauth2 } }
  }
}

export interface DriveFileInfo {
  id: string
  name: string
  mimeType: string
  size?: number
}

export function googleClientId(): string | undefined {
  const id = import.meta.env.VITE_GOOGLE_CLIENT_ID?.trim()
  return id || undefined
}

export function isGoogleAlbumEnabled(): boolean {
  return Boolean(googleClientId())
}

let memoryToken: TokenPayload | null = readStoredToken()
let gisLoading: Promise<GoogleOauth2> | null = null
let tokenClient: TokenClient | null = null
let pendingToken: {
  resolve: (value: string) => void
  reject: (error: Error) => void
} | null = null

function readStoredToken(): TokenPayload | null {
  if (typeof sessionStorage === 'undefined') return null
  try {
    const raw = sessionStorage.getItem(TOKEN_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<TokenPayload>
    if (typeof parsed.accessToken !== 'string' || typeof parsed.expiresAt !== 'number') return null
    if (parsed.expiresAt <= Date.now() + TOKEN_SKEW_MS) {
      sessionStorage.removeItem(TOKEN_STORAGE_KEY)
      return null
    }
    return {
      accessToken: parsed.accessToken,
      expiresAt: parsed.expiresAt,
      email: typeof parsed.email === 'string' ? parsed.email : undefined,
    }
  } catch {
    return null
  }
}

function persistToken(payload: TokenPayload): void {
  memoryToken = payload
  if (typeof sessionStorage === 'undefined') return
  try {
    sessionStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify(payload))
  } catch {
    // Private mode may block sessionStorage; memory still holds the token.
  }
}

export function peekAccessToken(): string | null {
  const current = memoryToken ?? readStoredToken()
  memoryToken = current
  if (!current || current.expiresAt <= Date.now() + TOKEN_SKEW_MS) return null
  return current.accessToken
}

export function peekDriveEmail(): string | undefined {
  const current = memoryToken ?? readStoredToken()
  return current?.email
}

export function clearDriveAccess(): void {
  memoryToken = null
  tokenClient = null
  if (typeof sessionStorage !== 'undefined') {
    try {
      sessionStorage.removeItem(TOKEN_STORAGE_KEY)
    } catch {
      /* ignore */
    }
  }
}

export function normalizeImageMime(type: string | null | undefined, filename?: string): AcceptedImageType | null {
  const raw = (type || '').toLowerCase().trim()
  if (raw === 'image/jpg' || raw === 'image/jpeg') return 'image/jpeg'
  if (raw === 'image/png' || raw === 'image/webp' || raw === 'image/gif') return raw
  const name = (filename || '').toLowerCase()
  if (name.endsWith('.jpg') || name.endsWith('.jpeg')) return 'image/jpeg'
  if (name.endsWith('.png')) return 'image/png'
  if (name.endsWith('.webp')) return 'image/webp'
  if (name.endsWith('.gif')) return 'image/gif'
  return null
}

export function extensionForMime(mime: AcceptedImageType): string {
  if (mime === 'image/jpeg') return 'jpg'
  if (mime === 'image/png') return 'png'
  if (mime === 'image/webp') return 'webp'
  return 'gif'
}

export function validateAlbumImage(file: Blob, filename = ''): { ok: true; mime: AcceptedImageType } | { ok: false; error: string } {
  const mime = normalizeImageMime(file.type, filename)
  if (!mime) return { ok: false, error: '仅支持 JPG、PNG、WebP 或 GIF 图片' }
  if (file.size > MAX_ALBUM_FILE_BYTES) return { ok: false, error: '单张图片不能超过 50 MB' }
  if (file.size <= 0) return { ok: false, error: '无法读取这张图片' }
  return { ok: true, mime }
}

function loadGis(): Promise<GoogleOauth2> {
  if (typeof window === 'undefined') return Promise.reject(new Error('当前环境无法连接谷歌云盘'))
  const existing = window.google?.accounts?.oauth2
  if (existing) return Promise.resolve(existing)
  if (gisLoading) return gisLoading
  gisLoading = new Promise((resolve, reject) => {
    const ready = () => {
      const api = window.google?.accounts?.oauth2
      if (api) {
        resolve(api)
        return
      }
      reject(new Error('无法载入谷歌登录组件'))
    }
    const previous = document.querySelector<HTMLScriptElement>(`script[src="${GIS_SRC}"]`)
    if (previous) {
      previous.addEventListener('load', ready, { once: true })
      previous.addEventListener('error', () => reject(new Error('无法载入谷歌登录组件')), { once: true })
      if (window.google?.accounts?.oauth2) ready()
      return
    }
    const script = document.createElement('script')
    script.src = GIS_SRC
    script.async = true
    script.onload = ready
    script.onerror = () => {
      gisLoading = null
      reject(new Error('无法载入谷歌登录组件'))
    }
    document.head.appendChild(script)
  })
  return gisLoading
}

function driveErrorMessage(status: number, fallback = '操作失败，请稍后重试'): string {
  if (status === 401) return '谷歌云盘登录已过期，请重新连接'
  if (status === 403) return '没有权限访问这个云盘文件。请使用原先连接相册的谷歌账号授权。'
  if (status === 404) return '找不到对应的云盘文件'
  if (status === 429) return '谷歌云盘请求过于频繁，请稍后再试'
  return fallback
}

function tokenErrorMessage(error?: string, description?: string): string {
  const raw = `${error || ''} ${description || ''}`.toLowerCase()
  if (raw.includes('popup_closed') || raw.includes('popup_closed_by_user')) return '已取消连接谷歌云盘'
  if (raw.includes('popup_blocked') || raw.includes('popup_failed')) return '请允许浏览器弹出窗口以连接谷歌云盘'
  if (raw.includes('access_denied')) return '未获得谷歌云盘授权'
  return '连接谷歌云盘失败，请稍后重试'
}

async function ensureTokenClient(): Promise<TokenClient> {
  const clientId = googleClientId()
  if (!clientId) throw new Error('云端相册尚未启用')
  const oauth = await loadGis()
  if (tokenClient) return tokenClient
  tokenClient = oauth.initTokenClient({
    client_id: clientId,
    scope: DRIVE_SCOPE,
    callback: (response) => {
      const pending = pendingToken
      pendingToken = null
      if (!pending) return
      if (!response.access_token || response.error) {
        pending.reject(new Error(tokenErrorMessage(response.error, response.error_description)))
        return
      }
      const expiresIn = typeof response.expires_in === 'number' && response.expires_in > 0 ? response.expires_in : 3600
      persistToken({
        accessToken: response.access_token,
        expiresAt: Date.now() + expiresIn * 1000,
        email: memoryToken?.email,
      })
      pending.resolve(response.access_token)
    },
    error_callback: (error) => {
      const pending = pendingToken
      pendingToken = null
      if (!pending) return
      pending.reject(new Error(tokenErrorMessage(error.type, error.message)))
    },
  })
  return tokenClient
}

export async function requestDriveAccess(prompt: '' | 'consent' = ''): Promise<string> {
  const current = peekAccessToken()
  if (current && prompt !== 'consent') return current
  const client = await ensureTokenClient()
  return new Promise<string>((resolve, reject) => {
    if (pendingToken) {
      reject(new Error('正在连接谷歌云盘，请稍候'))
      return
    }
    pendingToken = { resolve, reject }
    try {
      client.requestAccessToken({ prompt })
    } catch (error) {
      pendingToken = null
      reject(error instanceof Error ? error : new Error('连接谷歌云盘失败，请稍后重试'))
    }
  })
}

export async function getDriveAccessToken(): Promise<string> {
  const current = peekAccessToken()
  if (current) return current
  return requestDriveAccess('')
}

async function driveFetch(token: string, url: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers)
  headers.set('Authorization', `Bearer ${token}`)
  const response = await fetch(url, { ...init, headers })
  if (response.status === 401) clearDriveAccess()
  return response
}

export async function getDriveUserEmail(token: string): Promise<string> {
  const response = await driveFetch(token, `${DRIVE_API}/about?fields=user(emailAddress)`)
  if (!response.ok) throw new Error(driveErrorMessage(response.status, '无法读取谷歌账号信息'))
  const data = (await response.json()) as { user?: { emailAddress?: string } }
  const email = data.user?.emailAddress?.trim()
  if (!email) throw new Error('无法读取谷歌账号信息')
  if (memoryToken && memoryToken.accessToken === token) {
    persistToken({ ...memoryToken, email })
  }
  return email
}

function escapeDriveQuery(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

export async function findOrCreateAlbumFolder(token: string): Promise<string> {
  const q = `name = '${escapeDriveQuery(DRIVE_FOLDER_NAME)}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`
  const searchUrl = `${DRIVE_API}/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=10&spaces=drive`
  const found = await driveFetch(token, searchUrl)
  if (!found.ok) throw new Error(driveErrorMessage(found.status, '无法查找云盘相册文件夹'))
  const payload = (await found.json()) as { files?: Array<{ id?: string }> }
  const existing = payload.files?.find((file) => typeof file.id === 'string' && file.id)
  if (existing?.id) return existing.id

  const created = await driveFetch(token, `${DRIVE_API}/files?fields=id`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: DRIVE_FOLDER_NAME,
      mimeType: 'application/vnd.google-apps.folder',
    }),
  })
  if (!created.ok) throw new Error(driveErrorMessage(created.status, '无法创建云盘相册文件夹'))
  const body = (await created.json()) as { id?: string }
  if (!body.id) throw new Error('无法创建云盘相册文件夹')
  return body.id
}

export async function driveFolderAccessible(token: string, folderId: string): Promise<boolean> {
  const response = await driveFetch(
    token,
    `${DRIVE_API}/files/${encodeURIComponent(folderId)}?fields=id,mimeType,trashed`,
  )
  if (response.status === 404 || response.status === 403) return false
  if (!response.ok) throw new Error(driveErrorMessage(response.status, '无法访问云盘相册文件夹'))
  const body = (await response.json()) as { id?: string; mimeType?: string; trashed?: boolean }
  return Boolean(body.id) && body.mimeType === 'application/vnd.google-apps.folder' && body.trashed !== true
}

export async function uploadDriveImage(
  token: string,
  folderId: string,
  file: Blob,
  filename: string,
  onProgress?: (loaded: number, total: number) => void,
): Promise<DriveFileInfo> {
  const check = validateAlbumImage(file, filename)
  if (!check.ok) throw new Error(check.error)
  const metadata = {
    name: filename,
    parents: [folderId],
    mimeType: check.mime,
  }
  const boundary = `gallery_${Math.random().toString(16).slice(2)}_${Date.now()}`
  const metaPart = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`
  const mediaHead = `--${boundary}\r\nContent-Type: ${check.mime}\r\n\r\n`
  const tail = `\r\n--${boundary}--\r\n`
  const body = new Blob([metaPart, mediaHead, file, tail])

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${DRIVE_UPLOAD}?uploadType=multipart&fields=id,name,mimeType,size`)
    xhr.setRequestHeader('Authorization', `Bearer ${token}`)
    xhr.setRequestHeader('Content-Type', `multipart/related; boundary=${boundary}`)
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(event.loaded, event.total)
    }
    xhr.onerror = () => reject(new Error('网络连接失败，请稍后重试'))
    xhr.onload = () => {
      if (xhr.status === 401) {
        clearDriveAccess()
        reject(new Error(driveErrorMessage(401)))
        return
      }
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new Error(driveErrorMessage(xhr.status, '上传到谷歌云盘失败，请稍后重试')))
        return
      }
      try {
        const data = JSON.parse(xhr.responseText) as { id?: string; name?: string; mimeType?: string; size?: string }
        if (!data.id) {
          reject(new Error('上传到谷歌云盘失败，请稍后重试'))
          return
        }
        resolve({
          id: data.id,
          name: data.name || filename,
          mimeType: normalizeImageMime(data.mimeType, filename) || check.mime,
          size: data.size ? Number(data.size) : file.size,
        })
      } catch {
        reject(new Error('上传到谷歌云盘失败，请稍后重试'))
      }
    }
    xhr.send(body)
  })
}

export async function deleteDriveFile(token: string, fileId: string): Promise<void> {
  const response = await driveFetch(token, `${DRIVE_API}/files/${encodeURIComponent(fileId)}`, { method: 'DELETE' })
  if (response.status === 404) return
  if (!response.ok) throw new Error(driveErrorMessage(response.status, '无法从谷歌云盘删除这张图片'))
}

export async function fetchDriveImageBlob(token: string, fileId: string): Promise<Blob> {
  const response = await driveFetch(token, `${DRIVE_API}/files/${encodeURIComponent(fileId)}?alt=media`)
  if (!response.ok) throw new Error(driveErrorMessage(response.status, '无法载入云盘图片'))
  return response.blob()
}

export function sanitizeUploadFilename(name: string, mime: AcceptedImageType): string {
  const ext = extensionForMime(mime)
  const base = name
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[\\/:*?"<>|]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
  return `${base || 'album'}.${ext}`
}
