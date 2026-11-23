import { useCallback, useEffect, useState } from 'react'
import {
  canUseDirectoryPicker,
  clearDownloadDirectory,
  clearDownloadHistory,
  downloadOriginal,
  formatBytes,
  formatDownloadTime,
  getStoredDirectoryHandle,
  isEphemeralUrl,
  loadDownloadHistory,
  pickDownloadDirectory,
  revealDownloadFolder,
  subscribeDownloadHistory,
  type DownloadHistoryItem,
} from '../../utils/downloadOriginal'

export function DownloadCenter() {
  const pickerOk = canUseDirectoryPicker()
  const [folderName, setFolderName] = useState<string | null>(null)
  const [folderReady, setFolderReady] = useState(false)
  const [history, setHistory] = useState<DownloadHistoryItem[]>(() => loadDownloadHistory())
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const refreshFolder = useCallback(async () => {
    const handle = await getStoredDirectoryHandle()
    setFolderName(handle?.name ?? null)
    setFolderReady(true)
  }, [])

  useEffect(() => {
    void refreshFolder()
    return subscribeDownloadHistory(() => setHistory(loadDownloadHistory()))
  }, [refreshFolder])

  const flash = (text: string) => {
    setMessage(text)
    window.setTimeout(() => setMessage((current) => (current === text ? null : current)), 3200)
  }

  const chooseFolder = async () => {
    if (!pickerOk) {
      flash('当前浏览器不支持选择下载文件夹，将继续使用浏览器的默认下载。')
      return
    }
    setBusy(true)
    try {
      const handle = await pickDownloadDirectory()
      setFolderName(handle.name)
      flash(`已选择文件夹「${handle.name}」`)
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        flash(error instanceof Error ? error.message : '无法选择文件夹')
      }
    } finally {
      setBusy(false)
    }
  }

  const clearFolder = async () => {
    await clearDownloadDirectory()
    setFolderName(null)
    flash('已改回浏览器默认下载位置')
  }

  const openFolder = async () => {
    if (!pickerOk) {
      flash('当前浏览器无法打开已选文件夹。')
      return
    }
    if (!folderName) {
      flash('还没有选择下载文件夹')
      return
    }
    setBusy(true)
    try {
      const result = await revealDownloadFolder()
      if (result === 'denied') flash('没有访问该文件夹的权限，请重新选择。')
      else if (result === 'none') flash('还没有选择下载文件夹')
      else if (result === 'unsupported') flash('当前浏览器无法打开已选文件夹。')
      else {
        const handle = await getStoredDirectoryHandle()
        setFolderName(handle?.name ?? folderName)
      }
    } catch (error) {
      flash(error instanceof Error ? error.message : '无法打开文件夹')
    } finally {
      setBusy(false)
    }
  }

  const redo = async (item: DownloadHistoryItem) => {
    if (!item.url || isEphemeralUrl(item.url)) {
      flash('这条记录的原图地址已失效，请回到图片所在页面重新下载。')
      return
    }
    setBusy(true)
    try {
      const result = await downloadOriginal({
        url: item.url,
        filename: item.filename,
        source: item.source,
      })
      flash(result.folderName ? `已保存到「${result.folderName}」` : '已开始重新下载')
    } catch (error) {
      flash(error instanceof Error ? error.message : '重新下载失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="account-settings download-center">
      <div className="account-card">
        <h2>下载路径</h2>
        {folderReady && folderName ? (
          <p className="account-muted">
            当前文件夹：
            <button type="button" className="download-center__path" onClick={() => void openFolder()} disabled={busy}>
              {folderName}
            </button>
          </p>
        ) : (
          <p className="account-muted">尚未选择文件夹。下载会使用浏览器的默认下载位置。</p>
        )}
        {pickerOk ? (
          <p className="account-hint">
            浏览器出于安全考虑只提供文件夹名称，不会给出完整系统路径。点击名称会再次打开系统的文件夹选择窗口，并尽量定位到已选位置；网页无法像桌面浏览器那样直接打开资源管理器。
          </p>
        ) : (
          <p className="account-hint">
            当前浏览器（例如 Firefox 或 Safari）还不支持网站选择或打开下载文件夹，下载会使用浏览器自己的默认位置。
          </p>
        )}
        <div className="account-form__actions" style={{ marginTop: '0.85rem' }}>
          <button type="button" className="btn btn-primary" onClick={() => void chooseFolder()} disabled={busy || !pickerOk}>
            {folderName ? '更改文件夹' : '选择文件夹'}
          </button>
          {folderName && (
            <button type="button" className="btn btn-ghost" onClick={() => void clearFolder()} disabled={busy}>
              使用浏览器默认下载
            </button>
          )}
        </div>
        {message && <p className="download-center__msg">{message}</p>}
      </div>

      <div className="account-card">
        <div className="download-center__head">
          <h2>下载历史</h2>
          {history.length > 0 && (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                clearDownloadHistory()
                setHistory([])
              }}
            >
              清空历史
            </button>
          )}
        </div>
        {history.length === 0 ? (
          <p className="account-muted">还没有下载记录。</p>
        ) : (
          <ul className="download-center__list">
            {history.map((item) => (
              <li key={item.id} className="download-center__item">
                <div className="download-center__item-main">
                  <p className="download-center__file">{item.filename}</p>
                  <p className="account-hint">
                    {item.source || '图鉴'}
                    {' · '}
                    {formatDownloadTime(item.time)}（上海时间）
                    {' · '}
                    {formatBytes(item.size)}
                    {item.folderName ? ` · 保存到「${item.folderName}」` : ''}
                  </p>
                </div>
                <div className="download-center__item-side">
                  <span className={`download-center__status is-${item.status}`}>
                    {item.status === 'success' ? '已完成' : item.error || '失败'}
                  </span>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={busy || !item.url}
                    onClick={() => void redo(item)}
                  >
                    重新下载
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
