import { useCallback, useEffect, useState, type FormEvent } from 'react'
import type { User } from '@supabase/supabase-js'
import {
  formatAdminTime,
  invokeAdminUsers,
  type AdminListResult,
  type AdminUserRow,
} from '../../lib/admin'

interface Props {
  self: User
}

type Pending =
  | { kind: 'ban' | 'unban' | 'grant' | 'revoke'; user: AdminUserRow }
  | { kind: 'delete'; user: AdminUserRow }
  | null

export function UserManager({ self }: Props) {
  const [rows, setRows] = useState<AdminUserRow[]>([])
  const [page, setPage] = useState(1)
  const [perPage] = useState(50)
  const [total, setTotal] = useState<number | null>(null)
  const [query, setQuery] = useState('')
  const [appliedQuery, setAppliedQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState<Pending>(null)

  const load = useCallback(
    async (nextPage: number, email: string) => {
      setLoading(true)
      setError(null)
      try {
        const result = await invokeAdminUsers<AdminListResult>({
          action: 'list',
          page: nextPage,
          perPage,
          email: email.trim() || undefined,
        })
        setRows(result.users)
        setPage(result.page)
        setTotal(result.total)
      } catch (err) {
        setError(err instanceof Error ? err.message : '无法加载注册账号')
        setRows([])
      } finally {
        setLoading(false)
      }
    },
    [perPage],
  )

  useEffect(() => {
    void load(1, '')
  }, [load])

  const onSearch = (e: FormEvent) => {
    e.preventDefault()
    const next = query.trim()
    setAppliedQuery(next)
    void load(1, next)
  }

  const run = async (action: Exclude<Pending, null>) => {
    const user = action.user
    setBusyId(user.id)
    setError(null)
    setPending(null)
    try {
      if (action.kind === 'ban') {
        await invokeAdminUsers({ action: 'ban', userId: user.id })
      } else if (action.kind === 'unban') {
        await invokeAdminUsers({ action: 'unban', userId: user.id })
      } else if (action.kind === 'grant') {
        await invokeAdminUsers({ action: 'setAdmin', userId: user.id, admin: true })
      } else if (action.kind === 'revoke') {
        await invokeAdminUsers({ action: 'setAdmin', userId: user.id, admin: false })
      } else {
        await invokeAdminUsers({ action: 'delete', userId: user.id })
      }
      await load(page, appliedQuery)
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败，请稍后重试')
    } finally {
      setBusyId(null)
    }
  }

  const hasPrev = page > 1
  const hasNext = total != null ? page * perPage < total : rows.length === perPage
  const rangeStart = rows.length === 0 ? 0 : (page - 1) * perPage + 1
  const rangeEnd = (page - 1) * perPage + rows.length

  return (
    <section className="admin-users">
      <div className="admin-users__head">
        <div>
          <h2>注册账号</h2>
          <p className="admin-users__hint">时间均为北京时间。可将已注册账号设为管理员。</p>
        </div>
        <form className="admin-search" onSubmit={onSearch} role="search">
          <label className="visually-hidden" htmlFor="admin-user-search">
            按邮箱搜索
          </label>
          <input
            id="admin-user-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="按邮箱搜索"
            autoComplete="off"
          />
          <button type="submit" className="btn btn-primary" disabled={loading}>
            搜索
          </button>
        </form>
      </div>

      {error && <p className="auth-msg auth-msg--error">{error}</p>}

      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>邮箱</th>
              <th>注册时间</th>
              <th>最近登录</th>
              <th>邮箱确认</th>
              <th>状态</th>
              <th>角色</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {loading && rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="admin-table__empty">
                  正在加载…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="admin-table__empty">
                  {appliedQuery ? '没有符合条件的账号' : '暂无注册账号'}
                </td>
              </tr>
            ) : (
              rows.map((row) => {
                const isSelf = row.id === self.id
                const busy = busyId === row.id
                return (
                  <tr key={row.id} className={row.banned ? 'is-banned' : undefined}>
                    <td className="admin-table__email" data-label="邮箱" title={row.email ?? row.id}>
                      {row.email || '—'}
                      {isSelf && <span className="admin-pill admin-pill--self">当前</span>}
                    </td>
                    <td data-label="注册时间">{formatAdminTime(row.created_at)}</td>
                    <td data-label="最近登录">{formatAdminTime(row.last_sign_in_at)}</td>
                    <td data-label="邮箱确认">{row.email_confirmed ? '已确认' : '未确认'}</td>
                    <td data-label="状态">
                      {row.banned ? (
                        <span className="admin-pill admin-pill--warn">已停用</span>
                      ) : (
                        '正常'
                      )}
                    </td>
                    <td data-label="角色">
                      {row.isAdmin ? <span className="admin-pill">管理员</span> : '用户'}
                    </td>
                    <td data-label="操作">
                      <div className="admin-row-actions">
                        {row.banned ? (
                          <button
                            type="button"
                            className="btn btn-ghost"
                            disabled={busy || isSelf}
                            onClick={() => setPending({ kind: 'unban', user: row })}
                          >
                            恢复
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="btn btn-ghost"
                            disabled={busy || isSelf}
                            onClick={() => setPending({ kind: 'ban', user: row })}
                          >
                            停用
                          </button>
                        )}
                        {row.isAdmin ? (
                          <button
                            type="button"
                            className="btn btn-ghost"
                            disabled={busy}
                            onClick={() => setPending({ kind: 'revoke', user: row })}
                          >
                            取消管理员
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="btn btn-ghost"
                            disabled={busy}
                            onClick={() => setPending({ kind: 'grant', user: row })}
                          >
                            授予管理员
                          </button>
                        )}
                        <button
                          type="button"
                          className="btn btn-danger"
                          disabled={busy || isSelf}
                          onClick={() => setPending({ kind: 'delete', user: row })}
                        >
                          删除
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="admin-pager">
        <span className="admin-pager__meta">
          {loading ? '加载中…' : total != null
            ? `第 ${page} 页，共 ${total} 个账号`
            : rows.length > 0
              ? `第 ${page} 页 · 本页 ${rangeStart}–${rangeEnd}`
              : '第 1 页'}
        </span>
        <div className="admin-pager__btns">
          <button
            type="button"
            className="btn btn-ghost"
            disabled={!hasPrev || loading}
            onClick={() => void load(page - 1, appliedQuery)}
          >
            上一页
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={!hasNext || loading}
            onClick={() => void load(page + 1, appliedQuery)}
          >
            下一页
          </button>
        </div>
      </div>

      {pending && (
        <ConfirmDialog
          pending={pending}
          busy={busyId === pending.user.id}
          onCancel={() => setPending(null)}
          onConfirm={() => void run(pending)}
        />
      )}
    </section>
  )
}

function ConfirmDialog({
  pending,
  busy,
  onCancel,
  onConfirm,
}: {
  pending: Exclude<Pending, null>
  busy: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  const email = pending.user.email || pending.user.id
  const copy = confirmCopy(pending, email)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onCancel()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [busy, onCancel])

  return (
    <div className="admin-dialog-backdrop" role="presentation" onClick={busy ? undefined : onCancel}>
      <div
        className="admin-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="admin-dialog-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="admin-dialog-title">{copy.title}</h3>
        <p>{copy.body}</p>
        <div className="admin-dialog__actions">
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={onCancel}>
            取消
          </button>
          <button
            type="button"
            className={pending.kind === 'delete' || pending.kind === 'ban' ? 'btn btn-danger' : 'btn btn-primary'}
            disabled={busy}
            onClick={onConfirm}
          >
            {copy.confirm}
          </button>
        </div>
      </div>
    </div>
  )
}

function confirmCopy(pending: Exclude<Pending, null>, email: string): {
  title: string
  body: string
  confirm: string
} {
  switch (pending.kind) {
    case 'delete':
      return {
        title: '删除账号',
        body: `确定要删除账号 ${email} 吗？此操作不可恢复，该账号的喜欢、收藏和自定义风格也会一并删除。`,
        confirm: '确认删除',
      }
    case 'ban':
      return {
        title: '停用账号',
        body: `确定要停用账号 ${email} 吗？停用后该账号将无法登录。`,
        confirm: '确认停用',
      }
    case 'unban':
      return {
        title: '恢复账号',
        body: `确定要恢复账号 ${email} 吗？恢复后该账号可以重新登录。`,
        confirm: '确认恢复',
      }
    case 'grant':
      return {
        title: '授予管理员',
        body: `确定将账号 ${email} 设为管理员吗？对方将可以进入管理后台并管理注册账号。`,
        confirm: '确认授予',
      }
    case 'revoke':
      return {
        title: '取消管理员',
        body: `确定取消账号 ${email} 的管理员权限吗？对方的管理会话会被立即退出。`,
        confirm: '确认取消',
      }
  }
}
