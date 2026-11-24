export type BuiltinCategory =
  | '人物'
  | '场景'
  | '构图'
  | '特效'
  | '周边'
  | '艺术'
  | 'MJ'
  | '自定义'
  | '18+'

/** Any 大类 name: built-ins, leftover 自定义, or a user-created name. */
export type Category = string

export const BUILTIN_CATEGORIES: BuiltinCategory[] = [
  '人物',
  '场景',
  '构图',
  '特效',
  '周边',
  '艺术',
  'MJ',
  '自定义',
  '18+',
]

/** Always listed in the left rail, excluding leftover 自定义 and reserved 18+. */
export const FIXED_RAIL_CATEGORIES: BuiltinCategory[] = [
  '人物',
  '场景',
  '构图',
  '特效',
  '周边',
  '艺术',
  'MJ',
]

export const LEGACY_CUSTOM_CATEGORY = '自定义' as const
/** Previous display name for the MJ 大类; canonicalize to 「MJ」. */
export const LEGACY_MJ_CATEGORY = 'MJ风格' as const
export const ADULT_CATEGORY = '18+' as const

export type Medium = '图像' | '视频' | '模板' | '图生提示词'
export type Density = 'comfortable' | 'dense'

export interface PromptItem {
  id: string
  category: Category
  categorySlug: string
  title: string
  usage: string
  body: string
  source: string
  cover: string | null
  /** Full still set for the detail viewer; cover remains the grid/list thumbnail. */
  covers?: string[]
  parentId: string | null
  collection: string | null
  collectionIndex: number | null
  collectionTotal: number | null
  tags: string[]
  medium: Medium
  aspect: string | null
  promptText: string
  /** Chinese prompt shown on the detail page (may match promptText). */
  chinesePrompt?: string
  /** Grok / generic English prompt shown on the detail page. */
  grokPrompt?: string
  duplicateNote: string | null
  duplicateOf: string | null
  /** local-only additions stored in this browser */
  local?: boolean
  coverDataUrl?: string
  /** Present when this item comes from public.custom_styles */
  ownerId?: string
  /** Review state for uploaded custom styles. Built-in and unsynced local items omit this. */
  reviewStatus?: 'pending' | 'approved' | 'rejected'
  reviewNote?: string
}

export type ReviewStatus = NonNullable<PromptItem['reviewStatus']>

export interface FacetCount {
  name: string
  count: number
}

export interface CollectionInfo {
  id: string
  name: string
  category: Category
  count: number
  /** Raw Imagine / album-drawer image count; used to keep 18+ sub-nav order in sync with the album. */
  imagineItemCount?: number
}

export interface TagFacets {
  medium: FacetCount[]
  aspect: FacetCount[]
  style: FacetCount[]
}

export interface PromptsData {
  generatedFrom: string
  masterCount?: number
  count: number
  categories: Record<string, number>
  collections?: CollectionInfo[]
  tagFacets?: TagFacets
  items: PromptItem[]
}

export const MEDIUMS: Medium[] = ['图像', '视频', '模板', '图生提示词']

export const CATEGORY_SLUG: Record<BuiltinCategory, string> = {
  人物: 'renwu',
  场景: 'changjing',
  构图: 'goutu',
  特效: 'texiao',
  周边: 'zhoubian',
  艺术: 'yishu',
  MJ: 'mj',
  自定义: 'zidingyi',
  '18+': 'eighteen',
}

/** Muted, cinematic accents — used sparingly (dots, hairlines), not as glows. */
export const CATEGORY_ACCENT: Record<BuiltinCategory, string> = {
  人物: '#c4a574',
  场景: '#7aa2b8',
  构图: '#8f9a6b',
  特效: '#c17a5a',
  周边: '#6a9aa4',
  艺术: '#b08aaa',
  MJ: '#6d83b0',
  自定义: '#a39480',
  '18+': '#8d6d73',
}

export const STYLE_FACET_EXCLUDE = new Set<string>([
  ...BUILTIN_CATEGORIES,
  LEGACY_MJ_CATEGORY,
  '图像',
  '视频',
  '模板',
  '图生提示词',
])
