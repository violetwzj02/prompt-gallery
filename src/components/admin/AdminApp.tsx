import { useEffect, useState } from 'react'
import { useAuth } from '../../hooks/useAuth'
import { useTheme } from '../../hooks/useTheme'
import { isAdmin } from '../../lib/admin'
import { isSupabaseConfigured, supabase } from '../../lib/supabase'
import { isAdminConsoleView, isAdminHash, parseAdminView, setAdminHash } from '../../utils/adminRoutes'
import { AdminLogin } from './AdminLogin'
import { AdminShell } from './AdminShell'
import { StyleReview } from './StyleReview'
import { UserManager } from './UserManager'
import './admin.css'

export function AdminApp() {
  const auth = useAuth()
  const { pref: themePref, resolved: themeResolved, setPref: setThemePref } = useTheme()
  const [view, setView] = useState(() =>
    typeof window !== 'undefined' ? parseAdminView(window.location.hash) : 'home',
  )
  const [gateError, setGateError] = useState<string | null>(null)
  const [gateBusy, setGateBusy] = useState(false)

  useEffect(() => {
    const prev = document.title
    document.title = '图鉴管理后台'
    return () => {
      document.title = prev
    }
  }, [])

  useEffect(() => {
    const onHash = () => {
      if (!isAdminHash(window.location.hash)) return
      setView(parseAdminView(window.location.hash))
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  useEffect(() => {
    if (auth.loading || gateBusy) return

    if (isAdminConsoleView(view) && !auth.user) {
      setAdminHash('login')
      return
    }

    if (auth.user && !isAdmin(auth.user)) {
      if (isAdminConsoleView(view)) {
        setGateBusy(true)
        void (async () => {
          try {
            if (supabase) await supabase.auth.signOut()
          } finally {
            setGateError('这不是管理员账号')
            setGateBusy(false)
            setAdminHash('login')
          }
        })()
        return
      }
    }

    if (view === 'login' && isAdmin(auth.user)) {
      setGateError(null)
      setAdminHash('home')
    }
  }, [auth.loading, auth.user, view, gateBusy])

  const signOutToLogin = async () => {
    setGateError(null)
    await auth.signOut()
    setAdminHash('login')
  }

  if (auth.loading || gateBusy) {
    return (
      <div className="admin-loading">
        <p>正在核对管理员身份…</p>
      </div>
    )
  }

  if (view === 'login' || !isAdmin(auth.user)) {
    return (
      <AdminLogin
        auth={auth}
        notice={!isSupabaseConfigured ? null : gateError}
        themePref={themePref}
        themeResolved={themeResolved}
        onThemeChange={setThemePref}
      />
    )
  }

  return (
    <AdminShell
      user={auth.user}
      view={view === 'review' ? 'review' : 'home'}
      themePref={themePref}
      themeResolved={themeResolved}
      onThemeChange={setThemePref}
      onSignOut={() => void signOutToLogin()}
    >
      {view === 'review' ? <StyleReview /> : <UserManager self={auth.user} />}
    </AdminShell>
  )
}
