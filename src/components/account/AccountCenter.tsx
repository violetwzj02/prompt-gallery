import type { PromptItem } from '../../types'
import type { AuthState } from '../../hooks/useAuth'
import type { FavoriteFolder } from '../../hooks/useFavorites'
import type { ProfileState } from '../../hooks/useProfile'
import type { AccountRoute } from '../../utils/accountRoutes'
import { isAdmin } from '../../lib/admin'
import { AuthForm } from '../AuthForm'
import { StyleReview } from '../admin/StyleReview'
import { UserManager } from '../admin/UserManager'
import { AccountHome } from './AccountHome'
import { AccountSettings } from './AccountSettings'
import '../admin/admin.css'
import './account.css'

interface Props {
  auth: AuthState
  profileState: ProfileState
  route: AccountRoute
  pendingRedirect?: boolean
  items: PromptItem[]
  likes: {
    idSet: ReadonlySet<string>
    isLiked: (id: string) => boolean
    toggle: (id: string) => void
  }
  favorites: {
    folders: FavoriteFolder[]
    items: Record<string, string>
    defaultFolderId: string
    isFavorited: (id: string) => boolean
    toggle: (id: string) => void
    createFolder: (name: string) => FavoriteFolder | null | Promise<FavoriteFolder | null>
    renameFolder: (id: string, name: string) => boolean | Promise<boolean>
    deleteFolder: (id: string) => boolean | Promise<boolean>
  }
  onOpenItem: (item: PromptItem) => void
}

export function AccountCenter({
  auth,
  profileState,
  route,
  pendingRedirect = false,
  items,
  likes,
  favorites,
  onOpenItem,
}: Props) {
  const { user, loading } = auth
  const admin = isAdmin(user)
  const adminView = route.view === 'admin' || route.view === 'admin-review'

  if (loading || pendingRedirect) {
    return (
      <main className="account-main">
        <p className="state">正在载入个人中心…</p>
      </main>
    )
  }

  if (!user) {
    return (
      <main className="account-main">
        <AccountSubNav route={route} admin={false} />
        <div className="account-gate">
          <h2>请先登录</h2>
          <p>登录后即可查看个人主页、账号设置和收藏作品。</p>
          <AuthForm auth={auth} className="auth-panel auth-panel--page" title="登录或注册" />
        </div>
      </main>
    )
  }

  if (adminView && !admin) {
    return (
      <main className="account-main">
        <AccountSubNav route={route} admin={false} />
        <div className="account-gate">
          <h2>这不是管理员账号</h2>
          <p>当前登录的账号没有管理后台权限，你仍可继续使用图鉴和个人主页。</p>
          <a className="btn btn-primary" href="#/me">
            返回个人主页
          </a>
        </div>
      </main>
    )
  }

  return (
    <main className="account-main">
      <AccountSubNav route={route} admin={admin} />
      {route.view === 'home' && (
        <AccountHome
          user={user}
          profileState={profileState}
          items={items}
          route={route}
          likes={likes}
          favorites={favorites}
          onOpenItem={onOpenItem}
        />
      )}
      {route.view === 'account' && <AccountSettings user={user} profileState={profileState} />}
      {route.view === 'admin' && (
        <div className="account-admin">
          <AdminSubNav view="home" />
          <UserManager self={user} />
        </div>
      )}
      {route.view === 'admin-review' && (
        <div className="account-admin">
          <AdminSubNav view="review" />
          <StyleReview />
        </div>
      )}
    </main>
  )
}

function AccountSubNav({ route, admin }: { route: AccountRoute; admin: boolean }) {
  const view = route.view
  return (
    <nav className="account-subnav" aria-label="个人中心">
      <a className={view === 'home' ? 'is-active' : ''} href="#/me" aria-current={view === 'home' ? 'page' : undefined}>
        个人主页
      </a>
      <a
        className={view === 'account' ? 'is-active' : ''}
        href="#/me/account"
        aria-current={view === 'account' ? 'page' : undefined}
      >
        账号管理
      </a>
      {admin && (
        <a
          className={view === 'admin' || view === 'admin-review' ? 'is-active' : ''}
          href="#/me/admin"
          aria-current={view === 'admin' || view === 'admin-review' ? 'page' : undefined}
        >
          管理后台
        </a>
      )}
    </nav>
  )
}

function AdminSubNav({ view }: { view: 'home' | 'review' }) {
  return (
    <nav className="admin-nav account-admin-nav" aria-label="管理后台">
      <a className={`admin-nav__item ${view === 'home' ? 'is-active' : ''}`} href="#/me/admin" aria-current={view === 'home' ? 'page' : undefined}>
        注册账号
      </a>
      <a
        className={`admin-nav__item ${view === 'review' ? 'is-active' : ''}`}
        href="#/me/admin/review"
        aria-current={view === 'review' ? 'page' : undefined}
      >
        审核风格
      </a>
    </nav>
  )
}
