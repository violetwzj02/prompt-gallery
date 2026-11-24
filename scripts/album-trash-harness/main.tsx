import '../../src/index.css'
import '../../src/App.css'
import '../../src/components/account/account.css'
import '../../src/components/account/album.css'
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { createRoot } from 'react-dom/client'
import { CloudAlbum } from '../../src/components/account/CloudAlbum'
import {
  ensureHashNavigationEvents,
  parseAccountRoute,
  type AccountRoute,
} from '../../src/utils/accountRoutes'
import { setDriveImageBlobFetcher } from '../../src/lib/driveImageCache'
import type { useAlbum } from '../../src/hooks/useAlbum'
import { createAlbumTrashMemory, type AlbumTrashMemory } from '../album-trash-memory'

ensureHashNavigationEvents()

function colorPng(color: string, label: string): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = 480
  canvas.height = 300
  const ctx = canvas.getContext('2d')
  if (!ctx) return Promise.resolve(new Blob(['x'], { type: 'image/png' }))
  ctx.fillStyle = color
  ctx.fillRect(0, 0, 480, 300)
  ctx.fillStyle = '#111'
  ctx.font = '28px sans-serif'
  ctx.fillText(label, 20, 52)
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob || new Blob(['x'], { type: 'image/png' })), 'image/png'))
}

const COLORS: Record<string, string> = {
  'file-lake': '#9ad0ec',
  'file-valley': '#c9e4c5',
  'file-folder': '#f6d6ad',
  'file-trash': '#d5c6e0',
  'file-ok': '#f9e79f',
  'file-drive-fail': '#f5b7b1',
  'file-db-fail': '#d5c6e0',
}

setDriveImageBlobFetcher(async ({ fileId }) => colorPng(COLORS[fileId] || '#d5dbdb', fileId))

const originalFetch = window.fetch.bind(window)
window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const href = String(input)
  if (/quyi-cards|quyi-meta|covers\/entries|prompts\.json/i.test(href)) {
    return new Response('blocked', { status: 404, statusText: 'Not Found' })
  }
  return originalFetch(input, init)
}

type AlbumController = ReturnType<typeof useAlbum>

function HarnessApp() {
  const [, bump] = useState(0)
  const [schemaMissing, setSchemaMissing] = useState(false)
  const [logs, setLogs] = useState<string[]>(['测试台已就绪：仅使用合成色块，不会读写现网相册。'])
  const [hash, setHash] = useState(() => window.location.hash || '#/me/album')
  const logsRef = useRef(setLogs)
  logsRef.current = setLogs
  const storeRef = useRef<AlbumTrashMemory | null>(null)
  if (!storeRef.current) {
    storeRef.current = createAlbumTrashMemory({
      onChange: () => bump((value) => value + 1),
      log: (line) => {
        logsRef.current((list) =>
          [`${new Date().toLocaleTimeString('zh-CN', { hour12: false })} ${line}`, ...list].slice(0, 14),
        )
      },
    })
  }
  const store = storeRef.current
  const snapshot = store.snapshot()

  useEffect(() => {
    if (!window.location.hash) window.location.hash = '#/me/album'
    const onHash = () => setHash(window.location.hash || '#/me/album')
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const album = useMemo<AlbumController>(() => {
    return {
      settings: {
        driveRootFolderId: 'harness-root',
        connectedGoogleEmail: 'harness@example.com',
        updatedAt: null,
        updatedBy: null,
      },
      categories: [],
      items: snapshot.live,
      trashItems: snapshot.trash,
      loading: false,
      error: null,
      schemaMissing: false,
      trashSchemaMissing: schemaMissing,
      reload: async () => {},
      connectSettings: async (input) => input,
      addCategory: async () => {
        throw new Error('测试台不新建分类')
      },
      editCategory: async () => {
        throw new Error('测试台不重命名分类')
      },
      removeCategory: async () => {},
      addItem: async () => {
        throw new Error('测试台不上传真实文件')
      },
      editItem: async (id, patch) => {
        const current = [...store.snapshot().live, ...store.snapshot().trash].find((item) => item.id === id)
        if (!current) throw new Error('missing')
        return store.deps.updateItem(id, patch)
      },
      softDeleteItem: async (id) => {
        if (schemaMissing) throw new Error('回收站功能尚未就绪，删除和恢复暂时不可用。')
        return store.softDelete(id)
      },
      restoreItem: async (id) => store.restore(id),
      purgeItem: async (id, token) => store.purge(id, token),
      purgeItems: async (ids, token) => store.purgeMany(ids, token),
    }
  }, [schemaMissing, snapshot.live, snapshot.trash, store])

  const route: AccountRoute = parseAccountRoute(hash) ?? {
    view: 'album',
    tab: 'works',
    itemId: null,
    folderId: null,
    cat: null,
    bin: false,
  }

  const reset = (event?: FormEvent) => {
    event?.preventDefault()
    setSchemaMissing(false)
    store.reset({ fixture: 'default' })
    window.location.hash = '#/me/album'
  }

  const loadPartial = () => {
    setSchemaMissing(false)
    store.reset({ fixture: 'partial' })
    window.location.hash = '#/me/album?bin=1'
  }

  const counters = snapshot.counters

  return (
    <div className="harness-app">
      <section className="harness-doc">
        <h1>云端相册回收站测试台（合成图）</h1>
        <p>
          使用真实 CloudAlbum 和真实永久删除执行器，数据只存在内存里，不含现网素材。默认删除只进入回收站。失败入口只影响下一次对应操作，然后自动关掉，便于随后重试。
        </p>
        <ol>
          <li>打开一张图，点「删除图片」，确认后「全部」计数减 1，「回收站」加 1；取消确认后计数与下方「变更次数」都不应变化。</li>
          <li>进入回收站，点「恢复」，图片回到原来的分类。</li>
          <li>在回收站点「永久删除」或「清空回收站」，确认文案须包含「原文件将从谷歌云盘永久删除」；取消后变更次数和云盘/元数据计数都不变。</li>
          <li>打开 18+ → 测试角色抽屉中的唯一一张，删除后应回到 18+ 列表，而不是留在空抽屉。</li>
          <li>勾选「模拟字段尚未就绪」后，删除和回收站应禁用，并出现提示，且不会退回硬删除。</li>
          <li>
            点「载入部分失败夹具」，再点「清空回收站」并确认：相册应提示部分失败；「会成功清除的练习图」消失，「模拟云盘失败的练习图」仍在且可恢复，「模拟记录清理失败的练习图」仍在、状态为 drive_purged、恢复会失败。
          </li>
          <li>
            不要再勾选失败入口，再次「清空回收站」：云盘删除成功只应再增加 1（只重试云盘失败那项），已 purged 的一项只增加元数据删除；回收站应变空。
          </li>
          <li>
            也可单独勾选「模拟Drive失败」或「模拟Drive成功但数据库清理失败」，对单张点「永久删除」观察计数器。
          </li>
        </ol>
        <form className="harness-toolbar" onSubmit={reset}>
          <label>
            <input
              type="checkbox"
              checked={schemaMissing}
              onChange={(event) => setSchemaMissing(event.target.checked)}
            />{' '}
            模拟字段尚未就绪
          </label>
          <label>
            <input
              type="checkbox"
              checked={snapshot.driveFailOnce}
              onChange={(event) => store.setDriveFailOnce(event.target.checked)}
              data-testid="simulate-drive-fail"
            />{' '}
            模拟Drive失败
          </label>
          <label>
            <input
              type="checkbox"
              checked={snapshot.dbCleanupFailOnce}
              onChange={(event) => store.setDbCleanupFailOnce(event.target.checked)}
              data-testid="simulate-db-cleanup-fail"
            />{' '}
            模拟Drive成功但数据库清理失败
          </label>
          <button type="button" className="btn btn-ghost" onClick={loadPartial} data-testid="load-partial-fixture">
            载入部分失败夹具
          </button>
          <button type="submit" className="btn btn-ghost">
            重置合成数据
          </button>
          <a href="#/me/album">返回相册列表</a>
          <a href="#/me/album?bin=1">打开回收站</a>
          <a href="#/me/album?cat=18%2B&folder=%E6%B5%8B%E8%AF%95%E8%A7%92%E8%89%B2&item=live-folder">打开测试角色最后一张</a>
        </form>
        <div className="harness-counters" data-testid="purge-counters">
          <p>
            云盘删除 尝试 {counters.driveAttempts} / 成功 {counters.driveSuccesses}
            {' · '}元数据删除 尝试 {counters.metadataAttempts} / 成功 {counters.metadataSuccesses}
            {' · '}已标记 drive_purged {counters.markSuccesses}（尝试 {counters.markAttempts}）
            {' · '}回收站 {snapshot.trash.length} · 全部 {snapshot.live.length} · 变更次数 {counters.mutations}
          </p>
          {snapshot.trash.length > 0 ? (
            <ul>
              {snapshot.trash.map((item) => (
                <li key={item.id} data-testid={`trash-status-${item.id}`}>
                  {item.title} · 状态 {item.purgeStatus}
                  {item.drivePurgedAt ? ' · 云盘已删除' : ''}
                  {item.purgeError ? ` · ${item.purgeError}` : ''}
                </li>
              ))}
            </ul>
          ) : (
            <p>回收站当前没有条目。</p>
          )}
        </div>
        <pre className="harness-log">{logs.join('\n')}</pre>
      </section>
      <div className="harness-album">
        <CloudAlbum
          route={route}
          test={{ album, accessToken: 'harness-token', googleEnabled: true, confirm: (message) => window.confirm(message) }}
        />
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<HarnessApp />)
