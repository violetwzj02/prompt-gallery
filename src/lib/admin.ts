import type { User } from '@supabase/supabase-js'
import { supabase } from './supabase'

/** Authorization must only read app_metadata. Users can edit user_metadata. */
export function isAdmin(user: User | null | undefined): user is User {
  return user?.app_metadata?.role === 'admin'
}

export interface AdminUserRow {
  id: string
  email: string | null
  created_at: string
  last_sign_in_at: string | null
  email_confirmed: boolean
  banned: boolean
  isAdmin: boolean
}

export interface AdminListResult {
  users: AdminUserRow[]
  page: number
  perPage: number
  total: number | null
}

export type AdminUsersBody =
  | { action: 'list'; page?: number; perPage?: number; email?: string }
  | { action: 'ban'; userId: string }
  | { action: 'unban'; userId: string }
  | { action: 'delete'; userId: string }
  | { action: 'setAdmin'; userId: string; admin: boolean }

interface ErrorPayload {
  error?: string
}

export async function invokeAdminUsers<T>(body: AdminUsersBody): Promise<T> {
  if (!supabase) throw new Error('账号服务暂不可用')
  const { data, error } = await supabase.functions.invoke('admin-users', { body })
  const payload = asErrorPayload(data)
  if (error) throw new Error(adminFunctionError(error, payload))
  if (payload?.error) throw new Error(payload.error)
  return data as T
}

function asErrorPayload(data: unknown): ErrorPayload | null {
  if (data && typeof data === 'object' && 'error' in data) {
    const error = (data as { error: unknown }).error
    if (typeof error === 'string' && error.trim()) return { error }
  }
  return null
}

function adminFunctionError(error: { message?: string; context?: unknown }, payload: ErrorPayload | null): string {
  if (payload?.error) return payload.error
  const status = responseStatus(error.context)
  if (status === 401) return '登录已过期，请重新登录'
  if (status === 403) return '这不是管理员账号'
  if (status === 404) return '管理服务尚未部署，请稍后再试'
  const raw = (error.message || '').toLowerCase()
  if (raw.includes('failed to fetch') || raw.includes('network') || raw.includes('fetch failed')) {
    return '网络连接失败，请稍后重试'
  }
  if (raw.includes('not found') || raw.includes('404')) return '管理服务尚未部署，请稍后再试'
  return '操作失败，请稍后重试'
}

function responseStatus(context: unknown): number | undefined {
  if (context && typeof context === 'object' && 'status' in context) {
    const status = (context as { status: unknown }).status
    if (typeof status === 'number') return status
  }
  return undefined
}

export function formatAdminTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function truncateEmail(email: string, max = 22): string {
  if (email.length <= max) return email
  const at = email.indexOf('@')
  if (at === -1) return `${email.slice(0, max - 1)}…`
  const name = email.slice(0, at)
  const domain = email.slice(at + 1)
  const keep = Math.max(1, max - domain.length - 2)
  return `${name.slice(0, keep)}…@${domain}`
}
