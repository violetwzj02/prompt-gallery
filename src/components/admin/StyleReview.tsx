import { useCallback, useEffect, useMemo, useState } from 'react'
import type { PromptItem } from '../../types'
import { formatAdminTime, truncateEmail } from '../../lib/admin'
import {
  itemFromCustomStyle,
  type CustomStyleRow,
} from '../../lib/accountSync'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'

type ReviewTab = 'pending' | 'approved' | 'rejected' | 'all'

const TABS: { id: ReviewTab; label: string }[] = [
  { id: 'pending', label: '待审核' },
  { id: 'approved', label: '已通过' },
  { id: 'rejected', label: '未通过' },
  { id: 'all', label: '全部' },
]

const STYLE_COLUMNS =
  'id, owner_id, payload, created_at, updated_at, status, reviewed_at, reviewed_by, review_note'

interface ReviewRow {
  row: CustomStyleRow
  item: PromptItem
}

type PendingAction =
  | { kind: 'approve'; entry: ReviewRow }
  | { kind: 'reject'; entry: ReviewRow }
  | null

export function StyleReview() {
  const { user } = useAuth()
  const [tab, setTab] = useState<ReviewTab>('pending')
  const [entries, setEntries] = useState<ReviewRow[]>([])
  const [emails, setEmails] = useState<Record<string, string | null>>({})
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState<PendingAction>(null)
  const [rejectNote, setRejectNote] = useState('')

  const load = useCallback(async () => {
    if (!supabase) {
      setError('账号服务暂不可用')
      setEntries([])
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      let query = supabase
        .from('custom_styles')
        .select(STYLE_COLUMNS)
        .order('created_at', { ascending: false })
      if (tab !== 'all') query = query.eq('status', tab)
      const { data, error: loadErr } = await query
      if (loadErr) throw loadErr
      const next = ((data ?? []) as CustomStyleRow[]).map((row) => ({
        row,
        item: itemFromCustomStyle(row),
      }))
      setEntries(next)

      const ids = [...new Set(next.map((entry) => entry.row.owner_id).filter(Boolean))]
      if (ids.length > 0) {
        const { data: profiles, error: profileErr } = await supabase
          .from('profiles')
          .select('id, email')
          .in('id', ids)
        if (profileErr) {
          setEmails({})
        } else {
          const map: Record<string, string | null> = {}
          for (const profile of profiles ?? []) {
            map[profile.id as string] = (profile.email as string | null) ?? null
          }
          setEmails(map)
        }
      } else {
        setEmails({})
      }
    } catch (err) {
      setError(reviewErrorMessage(err, '无法加载待审核风格'))
      setEntries([])
    } finally {
      setLoading(false)
    }
  }, [tab])

  useEffect(() => {
    void load()
  }, [load])

  const run = async (action: Exclude<PendingAction, null>, note: string) => {
    if (!supabase || !user) return
    const id = action.entry.row.id
    setBusyId(id)
    setError(null)
    setPending(null)
    setRejectNote('')
    try {
      const patch =
        action.kind === 'approve'
          ? {
              status: 'approved',
              reviewed_at: new Date().toISOString(),
              reviewed_by: user.id,
              review_note: null,
            }
          : {
              status: 'rejected',
              reviewed_at: new Date().toISOString(),
              reviewed_by: user.id,
              review_note: note.trim().slice(0, 200) || null,
            }
      const { error: writeErr } = await supabase.from('custom_styles').update(patch).eq('id', id)
      if (writeErr) throw writeErr
      await load()
    } catch (err) {
      setError(reviewErrorMessage(err, '操作失败，请稍后重试'))
    } finally {
      setBusyId(null)
    }
  }

  const emptyCopy = useMemo(() => {
    if (tab === 'pending') return '暂无待审核的风格'
    if (tab === 'approved') return '暂无已通过的风格'
    if (tab === 'rejected') return '暂无未通过的风格'
    return '暂无上传的自定义风格'
  }, [tab])

  return (
    <section className="admin-users admin-review">
      <div className="admin-users__head">
        <div>
          <h2>审核风格</h2>
          <p className="admin-users__hint">
            其他账号上传的自定义 Prompt 需审核通过后才会进入公共图鉴。时间均为北京时间。
          </p>
        </div>
        <button type="button" className="btn btn-ghost" disabled={loading} onClick={() => void load()}>
          刷新
        </button>
      </div>

      <div className="admin-tabs" role="tablist" aria-label="审核状态">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            className={`admin-tab ${tab === item.id ? 'is-active' : ''}`}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {error && <p className="auth-msg auth-msg--error">{error}</p>}

      <div className="admin-table-wrap">
        <table className="admin-table admin-review-table">
          <thead>
            <tr>
              <th>标题</th>
              <th>大类</th>
              <th>上传者</th>
              <th>创建时间</th>
              <th>封面</th>
              <th>Prompt 预览</th>
              <th>状态</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {loading && entries.length === 0 ? (
              <tr>
                <td colSpan={8} className="admin-table__empty">
                  正在加载…
                </td>
              </tr>
            ) : entries.length === 0 ? (
              <tr>
                <td colSpan={8} className="admin-table__empty">
                  {emptyCopy}
                </td>
              </tr>
            ) : (
              entries.map((entry) => {
                const { row, item } = entry
                const status = row.status ?? item.reviewStatus ?? 'pending'
                const email = emails[row.owner_id]
                const ownerLabel = email?.trim() ? email : truncateOwnerId(row.owner_id)
                const cover = item.coverDataUrl || item.cover
                const preview = promptPreview(item)
                const busy = busyId === row.id
                return (
                  <tr key={row.id}>
                    <td className="admin-review__title" data-label="标题" title={item.title}>
                      {item.title}
                    </td>
                    <td data-label="大类">{item.category}</td>
                    <td data-label="上传者" title={email?.trim() || row.owner_id}>
                      {email?.trim() ? truncateEmail(email, 28) : ownerLabel}
                    </td>
                    <td data-label="创建时间">{formatAdminTime(row.created_at)}</td>
                    <td data-label="封面">
                      {cover ? (
                        <img src={cover} alt="" className="admin-review-cover" />
                      ) : (
                        <span className="admin-review__muted">—</span>
                      )}
                    </td>
                    <td className="admin-review-prompt" data-label="Prompt 预览" title={preview}>
                      {preview || '—'}
                    </td>
                    <td data-label="状态">
                      <span className={`admin-pill ${statusClass(status)}`}>{statusLabel(status)}</span>
                      {status === 'rejected' && row.review_note && (
                        <p className="admin-review__note" title={row.review_note}>
                          {row.review_note}
                        </p>
                      )}
                    </td>
                    <td data-label="操作">
                      <div className="admin-row-actions">
                        {status !== 'approved' && (
                          <button
                            type="button"
                            className="btn btn-primary"
                            disabled={busy}
                            onClick={() => setPending({ kind: 'approve', entry })}
                          >
                            通过
                          </button>
                        )}
                        {status !== 'rejected' && (
                          <button
                            type="button"
                            className="btn btn-ghost"
                            disabled={busy}
                            onClick={() => {
                              setRejectNote('')
                              setPending({ kind: 'reject', entry })
                            }}
                          >
                            拒绝
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      {pending && (
        <ReviewDialog
          pending={pending}
          note={rejectNote}
          onNoteChange={setRejectNote}
          busy={busyId === pending.entry.row.id}
          onCancel={() => {
            setPending(null)
            setRejectNote('')
          }}
          onConfirm={() => void run(pending, rejectNote)}
        />
      )}
    </section>
  )
}

function ReviewDialog({
  pending,
  note,
  onNoteChange,
  busy,
  onCancel,
  onConfirm,
}: {
  pending: Exclude<PendingAction, null>
  note: string
  onNoteChange: (value: string) => void
  busy: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  const title = pending.entry.item.title
  const isReject = pending.kind === 'reject'

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
        aria-labelledby="admin-review-dialog-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="admin-review-dialog-title">{isReject ? '拒绝风格' : '通过风格'}</h3>
        <p>
          {isReject
            ? `确定拒绝「${title}」吗？上传者仍可在自己的图鉴中看到，并可以修改后重新提交。`
            : `确定通过「${title}」吗？通过后，这条风格将出现在公共图鉴中。`}
        </p>
        {isReject && (
          <label className="admin-dialog__note">
            审核说明（可选）
            <textarea
              value={note}
              onChange={(e) => onNoteChange(e.target.value.slice(0, 200))}
              rows={3}
              maxLength={200}
              placeholder="简要说明未通过的原因"
            />
          </label>
        )}
        <div className="admin-dialog__actions">
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={onCancel}>
            取消
          </button>
          <button
            type="button"
            className={isReject ? 'btn btn-danger' : 'btn btn-primary'}
            disabled={busy}
            onClick={onConfirm}
          >
            {isReject ? '确认拒绝' : '确认通过'}
          </button>
        </div>
      </div>
    </div>
  )
}

function promptPreview(item: PromptItem): string {
  const raw = (item.promptText || item.body || '').replace(/[`*_#>-]/g, ' ').replace(/\s+/g, ' ').trim()
  if (raw.length <= 160) return raw
  return `${raw.slice(0, 160)}…`
}

function statusLabel(status: string): string {
  if (status === 'approved') return '已通过'
  if (status === 'rejected') return '未通过'
  return '待审核'
}

function statusClass(status: string): string {
  if (status === 'approved') return 'admin-pill--ok'
  if (status === 'rejected') return 'admin-pill--warn'
  return 'admin-pill--pending'
}

function truncateOwnerId(id: string, keep = 8): string {
  if (id.length <= keep + 1) return id
  return `${id.slice(0, keep)}…`
}

function reviewErrorMessage(err: unknown, fallback: string): string {
  const raw = err instanceof Error ? err.message : ''
  const lower = raw.toLowerCase()
  if (
    lower.includes('column') ||
    lower.includes('schema cache') ||
    lower.includes('does not exist') ||
    lower.includes('42703')
  ) {
    return '审核数据尚未就绪，请先在数据库中执行风格审核迁移后再试'
  }
  if (lower.includes('failed to fetch') || lower.includes('network') || lower.includes('fetch failed')) {
    return '网络连接失败，请稍后重试'
  }
  if (lower.includes('row-level security') || lower.includes('permission denied') || lower.includes('42501')) {
    return '没有权限执行此操作，请确认当前是管理员账号'
  }
  return fallback
}
