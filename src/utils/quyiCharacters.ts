import { ADULT_CATEGORY } from '../types'

export const PENDING_CHARACTER = '待归类'
export const QUYI_CARDS_URL = './data/quyi-cards.json'
export const QUYI_META_URL = './data/quyi-meta.json'

export interface QuyiCharacter {
  displayName: string
  franchise: string | null
  slug: string
  collectionId: string
  cardCount: number
  imagineItemCount: number
  pending: boolean
}

export interface QuyiMeta {
  generatedFrom?: string
  pendingName: string
  priorityDisplay: string[]
  characters: QuyiCharacter[]
  stats?: Record<string, number>
}

const PRIORITY_DISPLAY = ['甘雨', '申鹤', '蒂法', '雷神'] as const

export function isAdultCategory(name: string | null | undefined): boolean {
  return name === ADULT_CATEGORY
}

export function sortCharacterNames(names: string[], counts: Record<string, number> = {}): string[] {
  const named = names.filter((name) => name !== PENDING_CHARACTER)
  const pending = names.filter((name) => name === PENDING_CHARACTER)
  const sorted = [...named].sort((a, b) => {
    const pa = PRIORITY_DISPLAY.indexOf(a as (typeof PRIORITY_DISPLAY)[number])
    const pb = PRIORITY_DISPLAY.indexOf(b as (typeof PRIORITY_DISPLAY)[number])
    const ia = pa === -1 ? PRIORITY_DISPLAY.length : pa
    const ib = pb === -1 ? PRIORITY_DISPLAY.length : pb
    if (ia !== ib) return ia - ib
    if (ia < PRIORITY_DISPLAY.length) return 0
    const ca = counts[a] ?? 0
    const cb = counts[b] ?? 0
    if (ca !== cb) return cb - ca
    return a.localeCompare(b, 'zh-CN')
  })
  return [...sorted, ...pending]
}

export async function loadQuyiMeta(): Promise<QuyiMeta | null> {
  try {
    const res = await fetch(`${QUYI_META_URL}?t=${Date.now()}`, { cache: 'no-store' })
    if (!res.ok) return null
    const data = (await res.json()) as Partial<QuyiMeta>
    if (!Array.isArray(data.characters)) return null
    return {
      pendingName: data.pendingName || PENDING_CHARACTER,
      priorityDisplay: data.priorityDisplay ?? [...PRIORITY_DISPLAY],
      characters: data.characters,
      generatedFrom: data.generatedFrom,
      stats: data.stats,
    }
  } catch {
    return null
  }
}
