export type Category =
  | '人物'
  | '场景'
  | '构图'
  | '特效'
  | '周边'
  | '艺术'

export interface PromptItem {
  id: string
  category: Category
  categorySlug: string
  title: string
  usage: string
  body: string
  source: string
  cover: string | null
  /** local-only additions */
  local?: boolean
  coverDataUrl?: string
}

export interface PromptsData {
  generatedFrom: string
  count: number
  categories: Record<string, number>
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

export const CATEGORY_SLUG: Record<Category, string> = {
  人物: 'renwu',
  场景: 'changjing',
  构图: 'goutu',
  特效: 'texiao',
  周边: 'zhoubian',
  艺术: 'yishu',
}

export const CATEGORY_ACCENT: Record<Category, string> = {
  人物: '#c77dff',
  场景: '#4cc9f0',
  构图: '#a7c957',
  特效: '#ff6b35',
  周边: '#48cae4',
  艺术: '#e0aaff',
}
