import { useCallback, useEffect, useState } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import {
  authErrorMessage,
  cleanupAuthParams,
  getSiteUrl,
  hasAuthQueryParams,
  isAuthCallbackHash,
  isSupabaseConfigured,
  supabase,
} from '../lib/supabase'

export function useAuth() {
  const [session, setSession] = useState<Session | null>(null)
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(isSupabaseConfigured)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    if (!supabase) {
      setLoading(false)
      return
    }

    let cancelled = false
    const client = supabase

    client.auth
      .getSession()
      .then(({ data, error: sessionError }) => {
        if (cancelled) return
        if (sessionError) setError(authErrorMessage(sessionError))
        setSession(data.session)
        setUser(data.session?.user ?? null)
        setLoading(false)
        if (hasAuthQueryParams() || isAuthCallbackHash(window.location.hash)) {
          cleanupAuthParams()
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(authErrorMessage(err instanceof Error ? err : null))
        setLoading(false)
      })

    const { data: sub } = client.auth.onAuthStateChange((_event, next) => {
      if (cancelled) return
      setSession(next)
      setUser(next?.user ?? null)
    })

    return () => {
      cancelled = true
      sub.subscription.unsubscribe()
    }
  }, [])

  const signIn = useCallback(async (email: string, password: string) => {
    setError(null)
    setMessage(null)
    if (!supabase) {
      setError('账号服务暂不可用')
      return { ok: false as const }
    }
    const { error: signError } = await supabase.auth.signInWithPassword({ email, password })
    if (signError) {
      setError(authErrorMessage(signError))
      return { ok: false as const }
    }
    return { ok: true as const }
  }, [])

  const signUp = useCallback(async (email: string, password: string) => {
    setError(null)
    setMessage(null)
    if (!supabase) {
      setError('账号服务暂不可用')
      return { ok: false as const }
    }
    const { data, error: signError } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: getSiteUrl() },
    })
    if (signError) {
      setError(authErrorMessage(signError))
      return { ok: false as const }
    }
    if (!data.session) {
      setMessage('请查收邮件并点击确认链接以完成注册。')
    }
    return { ok: true as const, needsConfirm: !data.session }
  }, [])

  const signOut = useCallback(async () => {
    setError(null)
    setMessage(null)
    if (!supabase) return
    const { error: signError } = await supabase.auth.signOut()
    if (signError) setError(authErrorMessage(signError))
  }, [])

  const clearFeedback = useCallback(() => {
    setError(null)
    setMessage(null)
  }, [])

  return {
    session,
    user,
    loading,
    error,
    message,
    signIn,
    signUp,
    signOut,
    clearFeedback,
    configured: isSupabaseConfigured,
  }
}

export type AuthState = ReturnType<typeof useAuth>
