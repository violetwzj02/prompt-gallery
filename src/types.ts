export type Category =
  | '人物'
  | '场景'
  | '构图'
  | '特效'
  | '周边'
  | '艺术'

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
  parentId: string | null
  collection: string | null
  collectionIndex: number | null
  collectionTotal: number | null
  tags: string[]
  medium: Medium
  aspect: string | null
  promptText: string
  duplicateNote: string | null
  duplicateOf: string | null
  /** local-only additions */
  local?: boolean
  coverDataUrl?: string
}

export interface FacetCount {
  name: string
  count: number
}

export interface CollectionInfo {
  id: string
  name: string
  category: Category | string
  count: number
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

export const CATEGORIES: Category[] = [
  '人物',
  '场景',
  '构图',
  '特效',
  '周边',
  '艺术',
]

export const MEDIUMS: Medium[] = ['图像', '视频', '模板', '图生提示词']

export const CATEGORY_SLUG: Record<Category, string> = {
  人物: 'renwu',
  场景: 'changjing',
  构图: 'goutu',
  特效: 'texiao',
  周边: 'zhoubian',
  艺术: 'yishu',
}

/** Muted, cinematic accents — used sparingly (dots, hairlines), not as glows. */
export const CATEGORY_ACCENT: Record<Category, string> = {
  人物: '#c4a574',
  场景: '#7aa2b8',
  构图: '#8f9a6b',
  特效: '#c17a5a',
  周边: '#6a9aa4',
  艺术: '#b08aaa',
}

export const STYLE_FACET_EXCLUDE = new Set<string>([
  ...CATEGORIES,
  '图像',
  '视频',
  '模板',
  '图生提示词',
])
