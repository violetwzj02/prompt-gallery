import { useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { prefetchDriveImages, rebindDriveImageToken, clearDriveImageCache, setDriveImageBlobFetcher } from '../../src/lib/driveImageCache'
import { useDriveImageSlot } from '../../src/hooks/useDriveImageSlot'

function colorPng(color: string): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = 320
  canvas.height = 200
  const ctx = canvas.getContext('2d')
  if (!ctx) return Promise.resolve(new Blob())
  ctx.fillStyle = color
  ctx.fillRect(0, 0, 320, 200)
  ctx.fillStyle = '#111'
  ctx.font = '24px sans-serif'
  ctx.fillText(color, 16, 48)
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob || new Blob()), 'image/png'))
}

const PALETTE = ['#c9e4c5', '#9ad0ec', '#f6d6ad', '#f5b7b1', '#d5c6e0', '#f9e79f', '#a9cce3', '#d5dbdb']
const IDS = Array.from({ length: 12 }, (_, i) => `synth-${i + 1}`)

let latencyMs = 800

setDriveImageBlobFetcher(async ({ fileId }) => {
  const index = Math.max(0, IDS.indexOf(fileId))
  await new Promise((resolve) => setTimeout(resolve, latencyMs))
  return colorPng(PALETTE[index % PALETTE.length])
})

function slotState(slot: { url: string | null; error: string | null; loading: boolean }): 'error' | 'ready' | 'loading' {
  if (slot.loading) return 'loading'
  if (slot.error) return 'error'
  if (slot.url) return 'ready'
  return 'loading'
}

function Thumb({ token, fileId }: { token: string | null; fileId: string }) {
  const slot = useDriveImageSlot({ token, fileId, priority: 'low' })
  const state = slotState(slot)
  return (
    <div className="thumb" data-testid={`thumb-${fileId}`} data-state={state}>
      {slot.url ? <img src={slot.url} alt="" /> : <div className="ph">{slot.error || '载入中…'}</div>}
      {slot.error ? null : <span data-testid={`title-${fileId}`}>{fileId}</span>}
    </div>
  )
}

function Viewer({ token, ids, onClose }: { token: string | null; ids: string[]; onClose: () => void }) {
  const [index, setIndex] = useState(0)
  const fileId = ids[index]
  const slot = useDriveImageSlot({ token, fileId, priority: 'high' })
  const state = slotState(slot)
  useEffect(() => {
    if (token) prefetchDriveImages(token, [ids[index - 1], ids[index + 1]].filter(Boolean) as string[])
  }, [token, ids, index])
  return (
    <div className="viewer" data-testid="viewer" data-state={state}>
      <header>
        <button type="button" onClick={onClose}>
          返回列表
        </button>
        <strong data-testid="viewer-title">{slot.error ? slot.error : `${fileId} (${index + 1}/${ids.length})`}</strong>
        <button type="button" aria-label="关闭" onClick={onClose}>
          ×
        </button>
      </header>
      <div className="stage" data-testid="viewer-stage">
        {slot.url ? <img src={slot.url} alt="" /> : <div className="ph">{slot.error || '载入中…'}</div>}
      </div>
      <div>
        <button type="button" disabled={index <= 0} onClick={() => setIndex((value) => value - 1)}>
          上一张
        </button>
        <button type="button" disabled={index >= ids.length - 1} onClick={() => setIndex((value) => value + 1)}>
          下一张
        </button>
      </div>
    </div>
  )
}

function App() {
  const [open, setOpen] = useState(false)
  const [token, setToken] = useState<string | null>('tok-session-1')
  const [log, setLog] = useState<string[]>([])
  const ids = useMemo(() => IDS, [])
  const note = (line: string) => setLog((lines) => [line, ...lines].slice(0, 8))
  return (
    <div className="shell">
      <header className="toolbar">
        <h1>相册缓存合成测试台</h1>
        <div className="actions">
          <button
            type="button"
            onClick={() => {
              const next = `tok-session-${Date.now()}`
              rebindDriveImageToken(next)
              setToken(next)
              note('已模拟授权刷新：缓存应保留，不应出现“相册图片缓存已清空”')
            }}
          >
            模拟授权刷新
          </button>
          <button
            type="button"
            onClick={() => {
              clearDriveImageCache('logout')
              setToken(null)
              note('已模拟注销：应提示请重新连接，而不是缓存已清空')
            }}
          >
            模拟注销
          </button>
          <button type="button" onClick={() => setOpen(true)}>
            打开翻阅
          </button>
        </div>
      </header>
      <div className="content">
        <main>
          <p>仅使用本地纯色图，无账号、无云盘、无生产数据。延迟 {latencyMs}ms 模拟慢网。</p>
          <section className="grid">
            {ids.map((fileId) => (
              <Thumb key={fileId} token={token} fileId={fileId} />
            ))}
          </section>
          <ul className="log">
            {log.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        </main>
        {open && <Viewer token={token} ids={ids} onClose={() => setOpen(false)} />}
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<App />)
