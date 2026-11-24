import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useEscapeLayer } from '../hooks/useDialogChrome'
import { THEME_OPTIONS, type ThemePref, type ResolvedTheme } from '../hooks/useTheme'

interface Props {
  pref: ThemePref
  resolved: ResolvedTheme
  onChange: (pref: ThemePref) => void
}

export function ThemeToggle({ pref, resolved, onChange }: Props) {
  const [menuOpen, setMenuOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const currentLabel = THEME_OPTIONS.find((o) => o.id === pref)?.label ?? '系统'
  useEscapeLayer(menuOpen, () => setMenuOpen(false), wrapRef)

  useEffect(() => {
    if (!menuOpen) return
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => {
      document.removeEventListener('mousedown', onDoc)
    }
  }, [menuOpen])

  const onSegKey = (e: ReactKeyboardEvent<HTMLButtonElement>, index: number) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
    e.preventDefault()
    const dir = e.key === 'ArrowRight' ? 1 : -1
    const next = THEME_OPTIONS[(index + dir + THEME_OPTIONS.length) % THEME_OPTIONS.length]
    onChange(next.id)
  }

  return (
    <div className="theme-toggle-wrap" ref={wrapRef}>
      <div className="theme-seg" role="radiogroup" aria-label="界面色系">
        {THEME_OPTIONS.map((opt, i) => (
          <button
            key={opt.id}
            type="button"
            role="radio"
            aria-checked={pref === opt.id}
            className={pref === opt.id ? 'is-active' : ''}
            onClick={() => onChange(opt.id)}
            onKeyDown={(e) => onSegKey(e, i)}
          >
            {opt.label}
          </button>
        ))}
      </div>

      <button
        type="button"
        className="theme-menu-btn"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        aria-label={`界面色系，当前为${currentLabel}`}
        onClick={() => setMenuOpen((v) => !v)}
      >
        {currentLabel}
      </button>
      {menuOpen && (
        <div className="theme-menu" role="menu" aria-label="选择界面色系">
          {THEME_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              type="button"
              role="menuitemradio"
              aria-checked={pref === opt.id}
              className={pref === opt.id ? 'is-active' : ''}
              onClick={() => {
                onChange(opt.id)
                setMenuOpen(false)
              }}
            >
              <span>{opt.label}</span>
              {opt.id === 'system' && <em>跟随系统 · 当前{resolved === 'light' ? '浅色' : '深色'}</em>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
