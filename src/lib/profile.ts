export const AVATAR_BUCKET = 'avatars'
export const DISPLAY_NAME_MAX = 20
export const BIO_MAX = 200
export const AVATAR_SIZE = 512
export const AVATAR_SOURCE_MAX_BYTES = 10 * 1024 * 1024

export interface UserProfile {
  id: string
  email: string | null
  displayName: string | null
  bio: string | null
  avatarUrl: string | null
  createdAt: string
  updatedAt: string | null
}

export const PROFILE_FIELDS_UNAVAILABLE = '个人资料功能尚未启用，请稍后再试。'
export const AVATAR_STORAGE_UNAVAILABLE = '头像存储尚未启用，请稍后再试。'

export function initialsFrom(name?: string | null, email?: string | null): string {
  const text = (name?.trim() || email?.split('@')[0] || '').trim()
  if (!text) return '?'
  const chars = [...text]
  const first = chars[0]
  const isCjk = /[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(first)
  if (isCjk) return first
  const parts = text.split(/\s+/).filter(Boolean)
  if (parts.length >= 2) {
    const a = [...parts[0]][0] ?? ''
    const b = [...parts[1]][0] ?? ''
    return `${a}${b}`.toUpperCase()
  }
  return chars.slice(0, 2).join('').toUpperCase()
}

export function formatMemberSince(iso: string | null | undefined): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  const text = date.toLocaleDateString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
  return `${text}加入`
}

export function withAvatarCacheBust(url: string | null | undefined): string | null {
  if (!url) return null
  const stamp = Date.now()
  return url.includes('?') ? `${url}&t=${stamp}` : `${url}?t=${stamp}`
}

export async function cropSquareImage(file: File, size = AVATAR_SIZE): Promise<{ blob: Blob; contentType: 'image/webp' | 'image/jpeg'; ext: 'webp' | 'jpg' }> {
  const type = file.type.toLowerCase()
  if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(type)) {
    throw new Error('请选择 JPG、PNG、WebP 或 GIF 图片')
  }
  if (file.size > AVATAR_SOURCE_MAX_BYTES) {
    throw new Error('图片不能超过 10 MB')
  }

  const bitmap = await createImageBitmap(file)
  try {
    const side = Math.min(bitmap.width, bitmap.height)
    if (side < 1) throw new Error('无法读取这张图片')
    const sx = Math.floor((bitmap.width - side) / 2)
    const sy = Math.floor((bitmap.height - side) / 2)
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('无法处理这张图片')
    ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, size, size)
    const webp = await canvasToBlob(canvas, 'image/webp', 0.9)
    if (webp && webp.size > 0) return { blob: webp, contentType: 'image/webp', ext: 'webp' }
    const jpeg = await canvasToBlob(canvas, 'image/jpeg', 0.9)
    if (jpeg && jpeg.size > 0) return { blob: jpeg, contentType: 'image/jpeg', ext: 'jpg' }
    throw new Error('无法处理这张图片')
  } finally {
    bitmap.close()
  }
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: 'image/webp' | 'image/jpeg',
  quality: number,
): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), type, quality)
  })
}
