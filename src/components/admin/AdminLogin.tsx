import { useState, type FormEvent } from 'react'
import type { AuthState } from '../../hooks/useAuth'
import type { ThemePref, ResolvedTheme } from '../../hooks/useTheme'
import { isAdmin } from '../../lib/admin'
import { authErrorMessage, isSupabaseConfigured, supabase } from '../../lib/supabase'
import { setAdminHash } from '../../utils/adminRoutes'
import { ThemeToggle } from '../ThemeToggle'

interface Props {
  auth: AuthState
  notice: string | null
  themePref: ThemePref
  themeResolved: ResolvedTheme
  onThemeChange: (pref: ThemePref) => void
}

export function AdminLogin({ auth, notice, themePref, themeResolved, onThemeChange }: Props) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const configured = isSupabaseConfigured

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!configured || !supabase) return
    const trimmed = email.trim()
    if (!trimmed || !password) {
      setError('请输入邮箱和密码')
      return
    }
    if (password.length < 6) {
      setError('密码至少需要 6 个字符')
      return
    }
    setBusy(true)
    setError(null)
    auth.clearFeedback()
    try {
      const { data, error: signError } = await supabase.auth.signInWithPassword({
        email: trimmed,
        password,
      })
      if (signError) {
        setError(authErrorMessage(signError))
        return
      }
      if (!isAdmin(data.user)) {
        await supabase.auth.signOut()
        setError('这不是管理员账号')
        return
      }
      setAdminHash('home')
    } catch {
      setError('操作失败，请稍后重试')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="admin-login">
      <div className="admin-login__top">
        <ThemeToggle pref={themePref} resolved={themeResolved} onChange={onThemeChange} />
      </div>
      <form className="admin-login__card" onSubmit={(e) => void onSubmit(e)}>
        <p className="eyebrow">Admin</p>
        <h1>管理员登录</h1>
        <p className="admin-login__lead">请使用管理员账号进入图鉴管理后台。此处不开放注册。</p>
        {!configured && <p className="auth-msg auth-msg--error">账号服务暂不可用</p>}
        {configured && (error || notice) && (
          <p className="auth-msg auth-msg--error">{error || notice}</p>
        )}
        <label>
          邮箱
          <input
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value)
              setError(null)
            }}
            disabled={!configured || busy}
            required
          />
        </label>
        <label>
          密码
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value)
              setError(null)
            }}
            minLength={6}
            disabled={!configured || busy}
            required
          />
        </label>
        <div className="admin-login__actions">
          <button type="submit" className="btn btn-primary" disabled={!configured || busy}>
            {busy ? '登录中…' : '登录'}
          </button>
        </div>
        <a className="admin-login__back" href="#/">
          返回图鉴
        </a>
      </form>
    </div>
  )
}
