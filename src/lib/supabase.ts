import { createClient, type SupabaseClient } from '@supabase/supabase-js'

export const PRODUCTION_SITE_URL = 'https://violetwzj02.github.io/prompt-gallery/'

/** Gallery root used for emailRedirectTo (confirm / recovery). */
export function getSiteUrl(): string {
  if (typeof window === 'undefined') return PRODUCTION_SITE_URL
  const { origin, hostname } = window.location
  if (hostname === 'violetwzj02.github.io') return PRODUCTION_SITE_URL
  return `${origin}/`
}

function pickKey(): string | undefined {
  const publishable = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()
  const anon = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim()
  // supabase-js 2.119+ sends sb_publishable_ keys only as `apikey`, never as Bearer.
  if (publishable?.startsWith('sb_publishable_')) return publishable
  if (anon) return anon
  return publishable || undefined
}

const url = import.meta.env.VITE_SUPABASE_URL?.trim()
const key = pickKey()

export const isSupabaseConfigured = Boolean(url && key)

export const supabase: SupabaseClient | null =
  url && key
    ? createClient(url, key, {
        auth: {
          flowType: 'pkce',
          detectSessionInUrl: true,
          persistSession: true,
          autoRefreshToken: true,
        },
      })
    : null

/** Implicit-flow tokens in the hash would collide with this app's hash router. */
export function isAuthCallbackHash(hash: string): boolean {
  const h = hash.startsWith('#') ? hash.slice(1) : hash
  if (!h || h.startsWith('/')) return false
  return /(?:^|&)(access_token|refresh_token|provider_token|provider_refresh_token|token_type|expires_in|expires_at|error|error_code|error_description)=/.test(
    h,
  )
}

export function hasAuthQueryParams(
  search = typeof window !== 'undefined' ? window.location.search : '',
): boolean {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
  return params.has('code') || params.has('error') || params.has('error_description') || params.has('error_code')
}

/**
 * After supabase-js has exchanged the session, strip auth params.
 * Keeps any remaining app hash (`#/id`, `#/?fav=`).
 * Legacy `#access_token=` is replaced with `#/` (or `fallbackHash` if provided).
 */
export function cleanupAuthParams(fallbackHash = '#/'): void {
  if (typeof window === 'undefined') return
  const url = new URL(window.location.href)
  const hash = window.location.hash
  const legacy = isAuthCallbackHash(hash)

  if (legacy) {
    const next = `${url.pathname}${url.search}${fallbackHash}`
    history.replaceState(null, '', next)
    window.dispatchEvent(new HashChangeEvent('hashchange'))
    return
  }

  if (
    url.searchParams.has('code') ||
    url.searchParams.has('error') ||
    url.searchParams.has('error_description') ||
    url.searchParams.has('error_code')
  ) {
    url.searchParams.delete('code')
    url.searchParams.delete('error')
    url.searchParams.delete('error_description')
    url.searchParams.delete('error_code')
    const qs = url.searchParams.toString()
    const next = `${url.pathname}${qs ? `?${qs}` : ''}${url.hash}`
    history.replaceState(null, '', next)
  }
}

export function authErrorMessage(error: { message?: string; code?: string } | Error | null | undefined): string {
  if (!error) return '操作失败，请稍后重试'
  const message = 'message' in error ? error.message || '' : ''
  const code = 'code' in error && typeof error.code === 'string' ? error.code : ''
  const raw = message.toLowerCase()
  if (code === 'invalid_credentials' || raw.includes('invalid login credentials')) return '邮箱或密码不正确'
  if (
    code === 'user_already_exists' ||
    raw.includes('user already registered') ||
    raw.includes('already been registered')
  ) {
    return '该邮箱已注册，请直接登录'
  }
  if (raw.includes('email not confirmed')) return '请先查收邮件并确认账号后再登录'
  if (raw.includes('signup requires a valid password') || (raw.includes('password') && raw.includes('at least 6'))) {
    return '密码至少需要 6 个字符'
  }
  if (raw.includes('unable to validate email') || raw.includes('invalid email')) {
    return '请输入有效的邮箱地址'
  }
  if (raw.includes('rate limit') || raw.includes('too many requests') || raw.includes('over_request')) {
    return '尝试次数过多，请稍后再试'
  }
  if (raw.includes('failed to fetch') || raw.includes('network') || raw.includes('fetch failed')) {
    return '网络连接失败，请稍后重试'
  }
  if (raw.includes('signup is disabled')) return '当前未开放注册'
  return '操作失败，请稍后重试'
}

export function syncErrorMessage(action: string): string {
  return `${action}失败，请稍后重试`
}
