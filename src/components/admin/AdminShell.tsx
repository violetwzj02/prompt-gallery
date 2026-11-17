import type { ReactNode } from 'react'
import type { User } from '@supabase/supabase-js'
import type { ThemePref, ResolvedTheme } from '../../hooks/useTheme'
import { truncateEmail } from '../../lib/admin'
import { ThemeToggle } from '../ThemeToggle'

interface Props {
  user: User
  children: ReactNode
  themePref: ThemePref
  themeResolved: ResolvedTheme
  onThemeChange: (pref: ThemePref) => void
  onSignOut: () => void
}

export function AdminShell({
  user,
  children,
  themePref,
  themeResolved,
  onThemeChange,
  onSignOut,
}: Props) {
  const email = user.email ?? ''

  return (
    <div className="admin-app">
      <header className="admin-topbar">
        <div className="admin-topbar__brand">
          <p className="eyebrow">Admin</p>
          <h1>图鉴管理后台</h1>
        </div>
        <nav className="admin-nav" aria-label="管理后台">
          <a className="admin-nav__item is-active" href="#/admin" aria-current="page">
            注册账号
          </a>
          <span className="admin-nav__item is-disabled" title="即将推出" aria-disabled="true">
            审核风格（即将推出）
          </span>
        </nav>
        <div className="admin-topbar__actions">
          <ThemeToggle pref={themePref} resolved={themeResolved} onChange={onThemeChange} />
          {email && (
            <span className="auth-email" title={email}>
              {truncateEmail(email)}
            </span>
          )}
          <button type="button" className="btn btn-ghost" onClick={onSignOut}>
            退出
          </button>
        </div>
      </header>
      <main className="admin-main">{children}</main>
    </div>
  )
}
