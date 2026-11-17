import type { PromptItem } from '../types'

export function styleOriginLabel(item: PromptItem, viewerId?: string | null): string | null {
  if (item.ownerId) return viewerId && item.ownerId === viewerId ? '我的风格' : '本库风格'
  if (item.local) return '本地'
  return null
}

export function canRemoveStyle(item: PromptItem, viewerId?: string | null): boolean {
  if (item.ownerId) return Boolean(viewerId && item.ownerId === viewerId)
  return Boolean(item.local)
}
