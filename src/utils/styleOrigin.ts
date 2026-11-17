import type { PromptItem, ReviewStatus } from '../types'

export function styleOriginLabel(item: PromptItem, viewerId?: string | null): string | null {
  if (item.ownerId) return viewerId && item.ownerId === viewerId ? '我的风格' : '本库风格'
  if (item.local) return '本地'
  return null
}

export function reviewBadgeLabel(item: PromptItem, viewerId?: string | null): string | null {
  if (!viewerId || item.ownerId !== viewerId) return null
  if (item.reviewStatus === 'pending') return '待审核'
  if (item.reviewStatus === 'rejected') return '未通过'
  return null
}

/** Public library = approved (or missing, pre-migration). Owner may also see own pending/rejected. */
export function isVisibleCustomStyle(item: PromptItem, viewerId?: string | null): boolean {
  if (item.reviewStatus === 'pending' || item.reviewStatus === 'rejected') {
    return Boolean(viewerId && item.ownerId === viewerId)
  }
  return true
}

export function canRemoveStyle(item: PromptItem, viewerId?: string | null): boolean {
  if (item.ownerId) return Boolean(viewerId && item.ownerId === viewerId)
  return Boolean(item.local)
}

export function canEditStyle(item: PromptItem, viewerId?: string | null): boolean {
  return canRemoveStyle(item, viewerId)
}

export function reviewStatusTone(status: ReviewStatus | undefined): 'pending' | 'rejected' | null {
  if (status === 'pending' || status === 'rejected') return status
  return null
}
