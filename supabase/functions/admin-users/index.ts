import { createClient, type SupabaseClient, type User } from 'npm:@supabase/supabase-js@2'

const ALLOWED_ORIGINS = new Set([
  'https://violetwzj02.github.io',
  'http://localhost:5173',
  'http://localhost:4173',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:4173',
])

const BAN_DURATION = '876000h'
const LIST_PAGE_CAP = 100

type AdminBody =
  | { action?: 'list'; page?: number; perPage?: number; email?: string }
  | { action: 'ban'; userId: string }
  | { action: 'unban'; userId: string }
  | { action: 'delete'; userId: string }
  | { action: 'setAdmin'; userId: string; admin: boolean }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(req) })
  }
  if (req.method !== 'POST') {
    return json(req, 405, { error: '不支持的请求方法' })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')?.trim()
  const serviceKey =
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')?.trim() || Deno.env.get('SUPABASE_SECRET_KEY')?.trim()
  if (!supabaseUrl || !serviceKey) {
    return json(req, 500, { error: '服务配置不完整' })
  }

  const token = bearerToken(req)
  if (!token) return json(req, 401, { error: '未登录' })

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const { data: authData, error: authError } = await admin.auth.getUser(token)
  if (authError || !authData.user) {
    return json(req, 401, { error: '登录已过期，请重新登录' })
  }

  // Fresh Admin API record — do not trust a stale JWT after role changes.
  const { data: freshData, error: freshError } = await admin.auth.admin.getUserById(authData.user.id)
  const caller = freshData?.user
  if (freshError || !caller) {
    return json(req, 401, { error: '登录已过期，请重新登录' })
  }
  if (!userIsAdmin(caller) || userIsBanned(caller)) {
    return json(req, 403, { error: '这不是管理员账号' })
  }

  let body: AdminBody
  try {
    body = (await req.json()) as AdminBody
  } catch {
    return json(req, 400, { error: '请求格式不正确' })
  }

  const action = body?.action ?? 'list'
  try {
    switch (action) {
      case 'list':
        return json(req, 200, await listUsers(admin, body))
      case 'ban':
        return json(req, 200, await banUser(admin, caller.id, requiredUserId(body)))
      case 'unban':
        return json(req, 200, await unbanUser(admin, caller.id, requiredUserId(body)))
      case 'delete':
        return json(req, 200, await deleteUser(admin, caller.id, requiredUserId(body)))
      case 'setAdmin':
        return json(req, 200, await setAdmin(admin, caller.id, requiredUserId(body), Boolean((body as { admin?: boolean }).admin)))
      default:
        return json(req, 400, { error: '不支持的操作' })
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : '操作失败，请稍后重试'
    const known = message.startsWith('不能') || message.startsWith('缺少') || message.startsWith('找不到') || message.startsWith('无法') || message.endsWith('失败')
    return json(req, known ? 400 : 500, { error: known ? message : '操作失败，请稍后重试' })
  }
})

function corsHeaders(req: Request): HeadersInit {
  const origin = req.headers.get('Origin') ?? ''
  const headers: Record<string, string> = {
    'Access-Control-Allow-Headers':
      'authorization, x-client-info, apikey, content-type, x-supabase-api-version',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  }
  if (ALLOWED_ORIGINS.has(origin)) headers['Access-Control-Allow-Origin'] = origin
  return headers
}

function json(req: Request, status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(req),
      'Content-Type': 'application/json; charset=utf-8',
    },
  })
}

function bearerToken(req: Request): string {
  const header = req.headers.get('Authorization') ?? ''
  if (!header.toLowerCase().startsWith('bearer ')) return ''
  return header.slice(7).trim()
}

function userIsAdmin(user: User): boolean {
  return user.app_metadata?.role === 'admin'
}

function userIsBanned(user: User): boolean {
  const until = (user as User & { banned_until?: string | null }).banned_until
  if (!until) return false
  const ts = Date.parse(until)
  return Number.isFinite(ts) && ts > Date.now()
}

function requiredUserId(body: AdminBody): string {
  const userId = 'userId' in body && typeof body.userId === 'string' ? body.userId.trim() : ''
  if (!userId) throw new Error('缺少用户编号')
  return userId
}

function toRow(user: User) {
  return {
    id: user.id,
    email: user.email ?? null,
    created_at: user.created_at,
    last_sign_in_at: user.last_sign_in_at ?? null,
    email_confirmed: Boolean(user.email_confirmed_at),
    banned: userIsBanned(user),
    isAdmin: userIsAdmin(user),
  }
}

async function listUsers(admin: SupabaseClient, body: AdminBody) {
  const page = Math.max(1, Math.floor(Number((body as { page?: number }).page) || 1))
  const perPage = Math.min(100, Math.max(1, Math.floor(Number((body as { perPage?: number }).perPage) || 50)))
  const query = typeof (body as { email?: string }).email === 'string'
    ? (body as { email: string }).email.trim().toLowerCase()
    : ''

  if (!query) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage })
    if (error) throw new Error('无法加载注册账号')
    const users = (data?.users ?? []).map(toRow)
    return { users, page, perPage, total: null as number | null }
  }

  // listUsers has no search; page through and filter by email.
  const matches: User[] = []
  for (let p = 1; p <= LIST_PAGE_CAP; p++) {
    const { data, error } = await admin.auth.admin.listUsers({ page: p, perPage: 100 })
    if (error) throw new Error('无法加载注册账号')
    const batch = data?.users ?? []
    for (const user of batch) {
      if ((user.email ?? '').toLowerCase().includes(query)) matches.push(user)
    }
    if (batch.length < 100) break
  }

  const total = matches.length
  const start = (page - 1) * perPage
  return {
    users: matches.slice(start, start + perPage).map(toRow),
    page,
    perPage,
    total,
  }
}

async function countActiveAdmins(admin: SupabaseClient): Promise<number> {
  let count = 0
  for (let p = 1; p <= LIST_PAGE_CAP; p++) {
    const { data, error } = await admin.auth.admin.listUsers({ page: p, perPage: 100 })
    if (error) throw new Error('无法核对管理员数量')
    const batch = data?.users ?? []
    for (const user of batch) {
      if (userIsAdmin(user) && !userIsBanned(user)) count += 1
    }
    if (batch.length < 100) break
  }
  return count
}

async function loadUser(admin: SupabaseClient, userId: string): Promise<User> {
  const { data, error } = await admin.auth.admin.getUserById(userId)
  if (error || !data.user) throw new Error('找不到该账号')
  return data.user
}

function guardSelf(callerId: string, userId: string, action: string) {
  if (callerId === userId) throw new Error(action)
}

async function guardLastAdmin(admin: SupabaseClient, target: User) {
  if (!userIsAdmin(target) || userIsBanned(target)) return
  const remaining = await countActiveAdmins(admin)
  if (remaining <= 1) throw new Error('不能删除或取消最后一位管理员')
}

async function banUser(admin: SupabaseClient, callerId: string, userId: string) {
  guardSelf(callerId, userId, '不能停用自己的账号')
  const target = await loadUser(admin, userId)
  await guardLastAdmin(admin, target)
  const { data, error } = await admin.auth.admin.updateUserById(userId, { ban_duration: BAN_DURATION })
  if (error || !data.user) throw new Error('停用账号失败')
  await signOutQuietly(admin, userId)
  return { user: toRow(data.user) }
}

async function unbanUser(admin: SupabaseClient, _callerId: string, userId: string) {
  const { data, error } = await admin.auth.admin.updateUserById(userId, { ban_duration: 'none' })
  if (error || !data.user) throw new Error('恢复账号失败')
  return { user: toRow(data.user) }
}

async function deleteUser(admin: SupabaseClient, callerId: string, userId: string) {
  guardSelf(callerId, userId, '不能删除自己的账号')
  const target = await loadUser(admin, userId)
  await guardLastAdmin(admin, target)
  const { error } = await admin.auth.admin.deleteUser(userId)
  if (error) throw new Error('删除账号失败')
  return { ok: true, id: userId }
}

async function setAdmin(admin: SupabaseClient, _callerId: string, userId: string, makeAdmin: boolean) {
  const target = await loadUser(admin, userId)
  if (!makeAdmin) {
    await guardLastAdmin(admin, target)
  }
  const appMetadata = { ...(target.app_metadata ?? {}) }
  if (makeAdmin) appMetadata.role = 'admin'
  else appMetadata.role = null
  const { data, error } = await admin.auth.admin.updateUserById(userId, { app_metadata: appMetadata })
  if (error || !data.user) throw new Error(makeAdmin ? '授予管理员失败' : '取消管理员失败')
  // A demoted user's JWT may still claim admin until refresh; invalidate sessions.
  if (!makeAdmin) await signOutQuietly(admin, userId)
  return { user: toRow(data.user) }
}

async function signOutQuietly(admin: SupabaseClient, userId: string) {
  try {
    await admin.auth.admin.signOut(userId)
  } catch {
    // Role / ban changes still stand if session revocation fails.
  }
}
