import { useEffect, useState } from 'react'

export type ThemePref = 'dark' | 'light' | 'system'
export type ResolvedTheme = 'dark' | 'light'

export const THEME_KEY = 'prompt-gallery-theme'

export const THEME_OPTIONS: { id: ThemePref; label: string }[] = [
  { id: 'dark', label: '深色' },
  { id: 'light', label: '浅色' },
  { id: 'system', label: '系统' },
]

export function readThemePref(): ThemePref {
  try {
    const raw = localStorage.getItem(THEME_KEY)
    if (raw === 'dark' || raw === 'light' || raw === 'system') return raw
  } catch {
    /* private mode */
  }
  const attr = typeof document !== 'undefined' ? document.documentElement.getAttribute('data-theme-pref') : null
  if (attr === 'dark' || attr === 'light' || attr === 'system') return attr
  return 'system'
}

export function resolveTheme(pref: ThemePref): ResolvedTheme {
  if (pref === 'system') {
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
  }
  return pref
}

export function applyTheme(pref: ThemePref, resolved: ResolvedTheme = resolveTheme(pref)) {
  const root = document.documentElement
  root.setAttribute('data-theme', resolved)
  root.setAttribute('data-theme-pref', pref)
  root.style.colorScheme = resolved
  const themeMeta = document.querySelector('meta[name="theme-color"]')
  if (themeMeta) {
    themeMeta.setAttribute('content', resolved === 'light' ? '#f5f5f7' : '#0a0a0b')
  }
}

export function useTheme() {
  const [pref, setPrefState] = useState<ThemePref>(() =>
    typeof window === 'undefined' ? 'system' : readThemePref(),
  )
  const [resolved, setResolved] = useState<ResolvedTheme>(() =>
    typeof window === 'undefined' ? 'dark' : resolveTheme(readThemePref()),
  )

  useEffect(() => {
    const next = resolveTheme(pref)
    setResolved(next)
    applyTheme(pref, next)
    try {
      localStorage.setItem(THEME_KEY, pref)
    } catch {
      /* ignore */
    }
    const mq = window.matchMedia('(prefers-color-scheme: light)')
    const onChange = () => {
      const r = resolveTheme(pref)
      setResolved(r)
      applyTheme(pref, r)
    }
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [pref])

  const setPref = (next: ThemePref) => setPrefState(next)

  return { pref, resolved, setPref }
}
