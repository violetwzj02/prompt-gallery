import { useState, type FormEvent } from 'react'
import type { AuthState } from '../hooks/useAuth'

interface Props {
  auth: AuthState
  className?: string
  title?: string
}

export function AuthForm({ auth, className = 'auth-panel', title = '账号' }: Props) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const { error, message, signIn, signUp, clearFeedback, configured } = auth

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
    <form className={className} onSubmit={onSubmit} aria-label="登录或注册">
      <p className="auth-panel__title">{title}</p>
      {!configured && <p className="auth-msg auth-msg--error">账号服务暂不可用</p>}
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
            clearFeedback()
            setFormError(null)
          }}
          minLength={6}
          disabled={!configured || busy}
          required
        />
      </label>
      {(formError || error) && <p className="auth-msg auth-msg--error">{formError || error}</p>}
      {message && <p className="auth-msg">{message}</p>}
      <div className="auth-actions">
        <button type="submit" className="btn btn-primary" disabled={!configured || busy}>
          登录
        </button>
        <button type="button" className="btn btn-ghost" disabled={!configured || busy} onClick={() => void submit('up')}>
          注册
        </button>
      </div>
    </form>
  )
}
