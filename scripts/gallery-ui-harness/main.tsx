import { useMemo } from 'react'
import '../../src/index.css'
import { createRoot } from 'react-dom/client'
import App from '../../src/App'
import { AuthControl } from '../../src/components/AuthControl'
import { AccountCenter } from '../../src/components/account/AccountCenter'
import type { AuthState } from '../../src/hooks/useAuth'
import type { ProfileState } from '../../src/hooks/useProfile'
import { FIXTURE_DATA, installGalleryFixtureFetch } from './fixture'
import type { PromptItem } from '../../src/types'

const fetchGate = installGalleryFixtureFetch()

const noUserAuth = (): AuthState => ({
  session: null,
  user: null,
  loading: false,
  error: null,
  message: '测试台不会连接账号服务',
  configured: true,
  signIn: async () => {
    return { ok: false as const }
  },
  signUp: async () => {
    return { ok: false as const }
  },
  signOut: async () => {},
  clearFeedback: () => {},
})

const signedInAuth = (): AuthState => ({
  ...noUserAuth(),
  user: {
    id: 'fixture-user',
    email: 'ui-fixture@example.test',
    app_metadata: {},
    user_metadata: {},
    aud: 'authenticated',
    created_at: '2026-01-01T00:00:00.000Z',
  } as AuthState['user'],
  message: null,
})

const profileState: ProfileState = {
  profile: {
    displayName: '测试台很长的用户名称用来检查菜单溢出与换行',
    bio: '仅用于界面测试的简介。',
    avatarUrl: null,
  } as ProfileState['profile'],
  fieldsReady: true,
  loading: false,
  error: null,
  saveProfile: async () => ({ ok: false as const, error: '测试台不会保存资料' }),
  uploadAvatar: async () => ({ ok: false as const, error: '测试台不会上传头像' }),
  removeAvatar: async () => ({ ok: false as const, error: '测试台不会修改头像' }),
  reload: async () => {},
}

const emptyLikes = {
  idSet: new Set<string>(),
  isLiked: () => false,
  toggle: () => {},
}

const emptyFavorites = {
  folders: [{ id: 'default', name: '默认收藏夹' }],
  items: {} as Record<string, string>,
  defaultFolderId: 'default',
  isFavorited: () => false,
  toggle: () => {},
  createFolder: () => null,
  renameFolder: () => false,
  deleteFolder: () => false,
}

function Shell() {
  const items = useMemo(() => FIXTURE_DATA.items as PromptItem[], [])
  const loggedOut = useMemo(() => noUserAuth(), [])
  const loggedIn = useMemo(() => signedInAuth(), [])
  return (
    <div data-testid="gallery-ui-harness">
      <section className="harness-doc" data-testid="harness-notes">
        <h1>图鉴通用 UI 测试台</h1>
        <p>
          下面的图鉴是真实应用组件，并加载与生产相同的 index.css 主题变量和 App.css。数据来自本地风景/纯色合成图，不会读取生产 prompts.json、quyi 或任何成人素材。账号服务未配置密钥，也不会访问云盘。
        </p>
        <ol>
          <li>确认页面已是完整图鉴样式（深浅主题、顶栏、卡片），不是浏览器默认排版。可在开发者工具查看已加载 /main.css。</li>
          <li>桌面宽度检查顶栏、筛选、搜索、长标题卡片和详情的排版。</li>
          <li>将窗口调到 390 与 320 宽：页面不应出现横向滚动条；长标题在卡片内换行或两行截断，详情内完整换行，不把页面撑宽。</li>
          <li>打开筛选抽屉：背景页面不能滚动；Esc 关闭；关掉后 Tab 不会进入隐藏抽屉。</li>
          <li>打开任意卡片详情：右上角 × 必须在视口内、可用鼠标点到；Esc 和 × 都能关闭；焦点进入对话框，关闭后回到原来卡片；先滚动列表再打开，关闭后滚动位置保持。</li>
          <li>叠层测试请打开「本地构图练习（可编辑）」详情，滚动到操作区点「编辑」（这是生产里本地风格的真实入口，详情里没有「添加风格」按钮）。「添加风格」在首页顶栏，详情打开时会被遮住。点「编辑」后第一次 Esc 只关编辑面板，详情还在。</li>
          <li>用图鉴顶栏的主题按钮切换深浅色，检查文字、按钮和关闭键对比是否可读。</li>
          <li>下方真实账号组件：登录面板、超长用户名菜单、未登录个人中心和已登录个人主页/下载中心。不要打开云端相册。</li>
        </ol>
        <p data-testid="blocked-count">拦截生产资源次数：{fetchGate.blocked.length}</p>
        <p>深浅色请用下面图鉴顶栏里的主题按钮切换。</p>
      </section>
      <div className="harness-app">
        <App />
      </div>
      <section className="harness-account" data-testid="account-fixtures">
        <h2>账号组件（真实组件 + 本地模拟状态）</h2>
        <div className="harness-account__row">
          <div>
            <h3>未登录菜单</h3>
            <div className="harness-toolbar">
              <AuthControl auth={loggedOut} />
            </div>
          </div>
          <div>
            <h3>已登录菜单（长用户名）</h3>
            <div className="harness-toolbar">
              <AuthControl
                auth={loggedIn}
                displayName="测试台很长的用户名称用来检查菜单溢出与换行"
              />
            </div>
          </div>
        </div>
        <h3>未登录个人中心门闸</h3>
        <AccountCenter
          auth={loggedOut}
          profileState={profileState}
          route={{ view: 'home', tab: 'works', itemId: null, folderId: null, cat: null }}
          items={items}
          likes={emptyLikes}
          favorites={emptyFavorites}
          onOpenItem={() => {}}
        />
        <h3>已登录个人主页</h3>
        <AccountCenter
          auth={loggedIn}
          profileState={profileState}
          route={{ view: 'home', tab: 'works', itemId: null, folderId: null, cat: null }}
          items={items}
          likes={emptyLikes}
          favorites={emptyFavorites}
          onOpenItem={() => {}}
        />
        <h3>下载中心</h3>
        <AccountCenter
          auth={loggedIn}
          profileState={profileState}
          route={{ view: 'downloads', tab: 'works', itemId: null, folderId: null, cat: null }}
          items={items}
          likes={emptyLikes}
          favorites={emptyFavorites}
          onOpenItem={() => {}}
        />
      </section>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<Shell />)
