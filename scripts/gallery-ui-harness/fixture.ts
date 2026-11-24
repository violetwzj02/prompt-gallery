import type { PromptItem, PromptsData } from '../../src/types'
import { categorySlug } from '../../src/utils/category'

function swatch(color: string, label: string, width = 960, height = 640): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="${color}"/><text x="40" y="80" font-size="42" font-family="sans-serif" fill="#111">${label}</text></svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

function item(input: {
  id: string
  category: string
  title: string
  usage: string
  body: string
  color: string
  extraColors?: string[]
  collection?: { id: string; name: string; index: number; total: number }
  tags?: string[]
  aspect?: string
  local?: boolean
}): PromptItem {
  const coverDataUrl = swatch(input.color, input.title.slice(0, 12))
  const extra = (input.extraColors ?? []).map((color, index) => swatch(color, `${input.title.slice(0, 8)}-${index + 2}`))
  return {
    id: input.id,
    category: input.category,
    categorySlug: categorySlug(input.category),
    title: input.title,
    usage: input.usage,
    body: input.body,
    source: 'UI fixture',
    cover: null,
    coverDataUrl,
    covers: extra.length ? [coverDataUrl, ...extra] : [coverDataUrl],
    parentId: input.collection?.id ?? null,
    collection: input.collection?.name ?? null,
    collectionIndex: input.collection?.index ?? null,
    collectionTotal: input.collection?.total ?? null,
    tags: [input.category, '图像', ...(input.tags ?? [])],
    medium: '图像',
    aspect: input.aspect ?? '3:2',
    promptText: input.body,
    chinesePrompt: input.body,
    grokPrompt: 'A calm landscape study used only for interface testing.',
    duplicateNote: null,
    duplicateOf: null,
    local: input.local,
  }
}

const lake = { id: 'col-daylight', name: '日光风景', index: 1, total: 2 }

export const FIXTURE_DATA: PromptsData = {
  generatedFrom: 'gallery-ui-harness fixture (synthetic only)',
  count: 7,
  categories: { 场景: 4, 构图: 3 },
  collections: [{ id: 'col-daylight', name: '日光风景', category: '场景', count: 2 }],
  tagFacets: {
    medium: [{ name: '图像', count: 6 }],
    aspect: [{ name: '3:2', count: 6 }],
    style: [{ name: '风景', count: 4 }, { name: '建筑', count: 2 }],
  },
  items: [
    item({
      id: 'fixture-lake',
      category: '场景',
      title: '湖畔晨雾',
      usage: '风景测试卡',
      body: '平静的湖面、浅雾和远处的山脊，仅用于界面测试。',
      color: '#9ad0ec',
      extraColors: ['#c9e4c5'],
      collection: { ...lake, index: 1 },
      tags: ['风景'],
    }),
    item({
      id: 'fixture-valley',
      category: '场景',
      title: '山谷午后',
      usage: '风景测试卡',
      body: '宽阔山谷和柔和日光，仅用于界面测试。',
      color: '#c9e4c5',
      collection: { ...lake, index: 2 },
      tags: ['风景'],
    }),
    item({
      id: 'fixture-long-title',
      category: '构图',
      title: '超长标题用于检查换行与溢出：晨光穿过针叶林后的构图练习与窗口留白方案合集',
      usage: '长标题测试',
      body: '这张卡片专门用来检查标题在顶栏、网格和详情中的换行，不使用外部图片。',
      color: '#f6d6ad',
      tags: ['构图'],
    }),
    item({
      id: 'fixture-coast',
      category: '场景',
      title: '海岸岩层',
      usage: '风景测试卡',
      body: '岩石海岸和层层海浪，仅用于界面测试。',
      color: '#a9cce3',
      tags: ['风景'],
    }),
    item({
      id: 'fixture-house',
      category: '构图',
      title: '山间木屋',
      usage: '建筑测试卡',
      body: '简洁的木屋轮廓，用来检查筛选和详情切换。',
      color: '#d5c6e0',
      tags: ['建筑'],
    }),
    item({
      id: 'fixture-local-edit',
      category: '构图',
      title: '本地构图练习（可编辑）',
      usage: '本地风格测试卡',
      body: '这是一条本地风格，详情里会出现生产中的「编辑」按钮，用于测试详情上方再打开编辑面板。',
      color: '#f5b7b1',
      tags: ['构图'],
      local: true,
    }),
    item({
      id: 'fixture-field',
      category: '场景',
      title: '麦田小路',
      usage: '风景测试卡',
      body: '一条穿过麦田的小路，仅用于网格滚动和返回位置检查。',
      color: '#f9e79f',
      tags: ['风景'],
    }),
  ],
}

export const BLOCKED_URL_PATTERN = /quyi-cards|quyi-meta|covers\/entries|covers\/originals/i

export function installGalleryFixtureFetch(): { blocked: string[]; restore: () => void } {
  const blocked: string[] = []
  const original = window.fetch.bind(window)
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(typeof input === 'string' || input instanceof URL ? input : input.url)
    if (BLOCKED_URL_PATTERN.test(url)) {
      blocked.push(url)
      if (/quyi-cards|quyi-meta/i.test(url)) {
        return new Response(JSON.stringify({ items: [], collections: [], characters: [] }), {
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response('blocked-production-asset', { status: 404 })
    }
    if (/data\/prompts\.json|data\/meta\.json/i.test(url)) {
      return new Response(JSON.stringify(FIXTURE_DATA), {
        headers: { 'Content-Type': 'application/json' },
      })
    }
    return original(input, init)
  }
  return {
    blocked,
    restore: () => {
      window.fetch = original
    },
  }
}
