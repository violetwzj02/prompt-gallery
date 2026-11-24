import { useEffect, useRef, useState } from 'react'
import { useEscapeLayer } from '../hooks/useDialogChrome'
import type { AuthState } from '../hooks/useAuth'
import { isAdmin } from '../lib/admin'
import { isReservedHash, replaceHash } from '../utils/accountRoutes'
import { AuthForm } from './AuthForm'
import { Avatar } from './Avatar'

interface Props {
  auth: AuthState
  displayName?: string | null
  avatarUrl?: string | null
}

export function AuthControl({ auth, displayName, avatarUrl }: Props) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const { configured, user, signOut, clearFeedback } = auth
  const admin = isAdmin(user)
  const email = user?.email ?? ''
  const name = displayName?.trim() || ''
  useEscapeLayer(open, () => setOpen(false), wrapRef)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => {
      document.removeEventListener('mousedown', onDoc)
    }
  }, [open])

  useEffect(() => {
    if (user) setOpen(false)
  }, [user])

  if (!configured) return null

  const onSignOut = async () => {
    setOpen(false)
    await signOut()
    if (isReservedHash(window.location.hash)) replaceHash('#/')
  }

  if (user) {
    return (
      <div className="auth-control" ref={wrapRef}>
        <button
          type="button"
          className="account-trigger"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label="个人中心"
          onClick={() => setOpen((v) => !v)}
        >
          <Avatar name={name || null} email={email} src={avatarUrl} size="sm" />
        </button>
        {open && (
          <div className="account-menu" role="menu" aria-label="个人中心">
            <div className="account-menu__header">
              <Avatar name={name || null} email={email} src={avatarUrl} size="md" />
              <div className="account-menu__identity">
                <p className="account-menu__name">{name || email || '已登录'}</p>
                {email ? <p className="account-menu__email">{email}</p> : null}
              </div>
            </div>
            <a className="account-menu__item" role="menuitem" href="#/me" onClick={() => setOpen(false)}>
              个人主页
            </a>
            <a className="account-menu__item" role="menuitem" href="#/me/account" onClick={() => setOpen(false)}>
              账号管理
            </a>
            <a className="account-menu__item" role="menuitem" href="#/me/downloads" onClick={() => setOpen(false)}>
              下载中心
            </a>
            {admin && (
              <a className="account-menu__item" role="menuitem" href="#/me/album" onClick={() => setOpen(false)}>
                云端相册
              </a>
            )}
            {admin && (
              <a className="account-menu__item" role="menuitem" href="#/me/admin" onClick={() => setOpen(false)}>
                管理后台
              </a>
            )}
            <button type="button" className="account-menu__item account-menu__item--danger" role="menuitem" onClick={() => void onSignOut()}>
              退出登录
            </button>
          </div>
        )}
      </div>
    )
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
          if (open) clearFeedback()
        }}
      >
        登录
      </button>
      {open && <AuthForm auth={auth} className="auth-panel" />}
    </div>
  )
}
