import { useCallback, useEffect, useState } from 'react'

export const RAIL_SECTIONS_KEY = 'prompt-gallery-rail-sections'

export const RAIL_SECTION_IDS = [
  'category',
  'collection',
  'medium',
  'aspect',
  'style',
  'likes',
  'favorites',
] as const

export type RailSectionId = (typeof RAIL_SECTION_IDS)[number]

export type RailSectionOpen = Record<RailSectionId, boolean>

export const DEFAULT_RAIL_OPEN: RailSectionOpen = {
  category: true,
  collection: false,
  medium: false,
  aspect: false,
  style: false,
  likes: false,
  favorites: false,
}

function isSectionId(value: string): value is RailSectionId {
  return (RAIL_SECTION_IDS as readonly string[]).includes(value)
}

function loadRailSections(): Partial<RailSectionOpen> {
  try {
    const raw = localStorage.getItem(RAIL_SECTIONS_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return {}
    const out: Partial<RailSectionOpen> = {}
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (isSectionId(key) && typeof value === 'boolean') out[key] = value
    }
    return out
  } catch {
    return {}
  }
}

function mergeOpen(
  stored: Partial<RailSectionOpen>,
  active: Partial<Record<RailSectionId, boolean>>,
): RailSectionOpen {
  const next: RailSectionOpen = { ...DEFAULT_RAIL_OPEN, ...stored }
  for (const id of RAIL_SECTION_IDS) {
    if (active[id]) next[id] = true
  }
  return next
}

export function useRailSections(active: Partial<Record<RailSectionId, boolean>>) {
  const [open, setOpen] = useState<RailSectionOpen>(() =>
    mergeOpen(typeof window === 'undefined' ? {} : loadRailSections(), active),
  )

  useEffect(() => {
    setOpen((prev) => {
      let changed = false
      const next = { ...prev }
      for (const id of RAIL_SECTION_IDS) {
        if (active[id] && !prev[id]) {
          next[id] = true
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [active])

  useEffect(() => {
    try {
      localStorage.setItem(RAIL_SECTIONS_KEY, JSON.stringify(open))
    } catch {
      /* private mode */
    }
  }, [open])

  const toggle = useCallback((id: RailSectionId) => {
    setOpen((prev) => ({ ...prev, [id]: !prev[id] }))
  }, [])

  const isOpen = useCallback((id: RailSectionId) => open[id], [open])

  return { open, isOpen, toggle }
}
