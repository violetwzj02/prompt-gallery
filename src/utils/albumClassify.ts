export const ALBUM_PRESET_NAMES = ['真人', 'CG', '电影', '3D', '2D', '场景', '18+'] as const

export type AlbumPresetName = (typeof ALBUM_PRESET_NAMES)[number]

const PRESET_SET = new Set<string>(ALBUM_PRESET_NAMES)

const PROMPT_CATEGORY_TO_PRESET: Record<string, AlbumPresetName> = {
  人物: '真人',
  场景: '场景',
  '18+': '18+',
  eighteen: '18+',
  特效: 'CG',
}

const RESERVED_NAMES = new Set(['全部', '自定义', 'admin'])

function hasAsciiWord(haystack: string, word: string): boolean {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:$|[^a-z0-9])`, 'i').test(haystack)
}

/**
 * Conservative auto-tags for album items.
 *
 * Preset mapping from a linked prompt's category (only these):
 *   人物 → 真人, 场景 → 场景, 18+ / eighteen → 18+, 特效 → CG
 * 艺术 / 构图 / 周边 / 自定义 are not mapped — 艺术 is not guessed as 2D or CG.
 *
 * Additional presets come from explicit filename, title, or tag keywords:
 *   真人, 实拍, 场景, 电影, movie, film, 3d, 3-d, 三维, 2d, 2-d, 二维,
 *   cg, cgi, 18+, r18, r-18, eighteen
 * English tokens use word boundaries. "cinematic", "art", and "illustration"
 * are ignored to avoid over-tagging.
 *
 * Returned names stay in preset order and are unique. User-created labels
 * belong in custom_categories, not here.
 */
export function suggestAlbumPresets(input: {
  title?: string | null
  filename?: string | null
  promptCategory?: string | null
  tags?: string[] | null
}): AlbumPresetName[] {
  const found = new Set<AlbumPresetName>()
  const category = (input.promptCategory ?? '').trim()
  if (category) {
    const mapped = PROMPT_CATEGORY_TO_PRESET[category] ?? PROMPT_CATEGORY_TO_PRESET[category.toLowerCase()]
    if (mapped) found.add(mapped)
  }

  const haystack = [input.title, input.filename, ...(input.tags ?? [])]
    .filter((part): part is string => Boolean(part && part.trim()))
    .join('\n')
  if (haystack) {
    const lower = haystack.toLowerCase()
    if (haystack.includes('真人') || haystack.includes('实拍')) found.add('真人')
    if (haystack.includes('场景')) found.add('场景')
    if (haystack.includes('电影') || hasAsciiWord(lower, 'movie') || hasAsciiWord(lower, 'film')) {
      found.add('电影')
    }
    if (hasAsciiWord(lower, '3d') || hasAsciiWord(lower, '3-d') || haystack.includes('三维')) found.add('3D')
    if (hasAsciiWord(lower, '2d') || hasAsciiWord(lower, '2-d') || haystack.includes('二维')) found.add('2D')
    if (hasAsciiWord(lower, 'cg') || hasAsciiWord(lower, 'cgi')) found.add('CG')
    if (
      haystack.includes('18+') ||
      hasAsciiWord(lower, '18+') ||
      hasAsciiWord(lower, 'r18') ||
      hasAsciiWord(lower, 'r-18') ||
      hasAsciiWord(lower, 'eighteen')
    ) {
      found.add('18+')
    }
  }

  return ALBUM_PRESET_NAMES.filter((name) => found.has(name))
}

export function isAlbumPreset(name: string): name is AlbumPresetName {
  return PRESET_SET.has(name)
}

export function splitAlbumCategories(names: string[]): { auto: AlbumPresetName[]; custom: string[] } {
  const auto: AlbumPresetName[] = []
  const custom: string[] = []
  const seen = new Set<string>()
  for (const raw of names) {
    const name = raw.trim()
    if (!name || seen.has(name)) continue
    seen.add(name)
    if (isAlbumPreset(name)) auto.push(name)
    else custom.push(name)
  }
  auto.sort((a, b) => ALBUM_PRESET_NAMES.indexOf(a) - ALBUM_PRESET_NAMES.indexOf(b))
  return { auto, custom }
}

export function validateAlbumCategoryName(
  raw: string,
  existing: string[] = [],
): { ok: true; name: string } | { ok: false; error: string } {
  const name = raw.trim()
  if (!name) return { ok: false, error: '请输入分类名称' }
  if ([...name].length > 20) return { ok: false, error: '分类名称请控制在 1–20 个字符' }
  if (RESERVED_NAMES.has(name) || name.toLowerCase() === 'admin') {
    return { ok: false, error: '该名称不可用作分类' }
  }
  if (/[/\\]/.test(name)) {
    return { ok: false, error: '分类名称不能包含路径字符' }
  }
  const match = existing.find((item) => item === name || item.toLowerCase() === name.toLowerCase())
  if (match && match !== name) {
    return { ok: false, error: '已有相同名称的分类' }
  }
  return { ok: true, name: match ?? name }
}

export function albumCategorySlug(name: string): string {
  if (name === '真人') return 'zhenren'
  if (name === 'CG') return 'cg'
  if (name === '电影') return 'dianying'
  if (name === '3D') return '3d'
  if (name === '2D') return '2d'
  if (name === '场景') return 'changjing'
  if (name === '18+') return 'eighteen'
  const ascii = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24)
  if (ascii && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(ascii)) return ascii
  let hash = 2166136261
  for (let i = 0; i < name.length; i++) {
    hash ^= name.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return `c-${(hash >>> 0).toString(16).padStart(8, '0')}`
}
