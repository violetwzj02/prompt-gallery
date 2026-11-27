import type { ReactNode } from 'react'
import type { User } from '@supabase/supabase-js'
import type { ThemePref, ResolvedTheme } from '../../hooks/useTheme'
import { truncateEmail } from '../../lib/admin'
import { ThemeToggle } from '../ThemeToggle'

interface Props {
  user: User
  children: ReactNode
  view: 'home' | 'review'
  themePref: ThemePref
  themeResolved: ResolvedTheme
  onThemeChange: (pref: ThemePref) => void
  onSignOut: () => void
}

export function AdminShell({
  user,
  children,
  view,
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
          <h1>图鉴管理后台</h1>
        </div>
        <nav className="admin-nav" aria-label="管理后台">
          <a
            className={`admin-nav__item ${view === 'home' ? 'is-active' : ''}`}
            href="#/admin"
            aria-current={view === 'home' ? 'page' : undefined}
          >
            注册账号
          </a>
          <a
            className={`admin-nav__item ${view === 'review' ? 'is-active' : ''}`}
            href="#/admin/review"
            aria-current={view === 'review' ? 'page' : undefined}
          >
            审核风格
          </a>
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
