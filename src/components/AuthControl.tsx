import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { AuthState } from '../hooks/useAuth'

interface Props {
  auth: AuthState
}

function truncateEmail(email: string, max = 22): string {
  if (email.length <= max) return email
  const at = email.indexOf('@')
  if (at === -1) return `${email.slice(0, max - 1)}…`
  const name = email.slice(0, at)
  const domain = email.slice(at + 1)
  const keep = Math.max(1, max - domain.length - 2)
  return `${name.slice(0, keep)}…@${domain}`
}

export function AuthControl({ auth }: Props) {
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const { configured, user, error, message, signIn, signUp, signOut, clearFeedback } = auth

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  useEffect(() => {
    if (user) setOpen(false)
  }, [user])

  if (!configured) return null

  if (user?.email) {
    return (
      <div className="auth-control">
        <span className="auth-email" title={user.email}>
          {truncateEmail(user.email)}
        </span>
        <button type="button" className="btn btn-ghost auth-btn" onClick={() => void signOut()}>
          退出
        </button>
      </div>
    )
  }

  const submit = async (mode: 'in' | 'up') => {
    const trimmed = email.trim()
    if (!trimmed || !password) {
      setFormError('请输入邮箱和密码')
      return
    }
    if (password.length < 6) {
      setFormError('密码至少需要 6 个字符')
      return
    }
    setFormError(null)
    setBusy(true)
    try {
      if (mode === 'in') await signIn(trimmed, password)
      else await signUp(trimmed, password)
    } finally {
      setBusy(false)
    }
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    void submit('in')
  }

  return (
    <div className="auth-control" ref={wrapRef}>
      <button
        type="button"
        className="btn btn-ghost auth-btn"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          setOpen((v) => !v)
          if (open) {
            clearFeedback()
            setFormError(null)
          }
        }}
      >
        登录
      </button>
      {open && (
        <form className="auth-panel" onSubmit={onSubmit} role="dialog" aria-label="登录或注册">
          <p className="auth-panel__title">账号</p>
          <label>
            邮箱
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value)
                clearFeedback()
                setFormError(null)
              }}
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
                clearFeedback()
                setFormError(null)
              }}
              minLength={6}
              required
            />
          </label>
          {(formError || error) && <p className="auth-msg auth-msg--error">{formError || error}</p>}
          {message && <p className="auth-msg">{message}</p>}
          <div className="auth-actions">
            <button type="submit" className="btn btn-primary" disabled={busy}>
              登录
            </button>
            <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void submit('up')}>
              注册
            </button>
          </div>
        </form>
      )}
    </div>
  )
}
