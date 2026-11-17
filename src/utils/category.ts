import {
  ADULT_CATEGORY,
  BUILTIN_CATEGORIES,
  CATEGORY_ACCENT,
  CATEGORY_SLUG,
  FIXED_RAIL_CATEGORIES,
  LEGACY_CUSTOM_CATEGORY,
  STYLE_FACET_EXCLUDE,
  type BuiltinCategory,
} from '../types'
import { hashId } from './hash'

const BUILTIN_SET = new Set<string>(BUILTIN_CATEGORIES)
const BUILTIN_SLUGS = new Set(Object.values(CATEGORY_SLUG))
const RESERVED_NEW_NAMES = new Set(['全部', LEGACY_CUSTOM_CATEGORY, 'admin'])

export function isBuiltinCategory(name: string): name is BuiltinCategory {
  return BUILTIN_SET.has(name)
}

/** Built-in maps for fixed names; custom names get a stable url-safe slug. */
export function categorySlug(name: string): string {
  if (isBuiltinCategory(name)) return CATEGORY_SLUG[name]
  const ascii = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24)
  if (ascii && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(ascii)) {
    return BUILTIN_SLUGS.has(ascii) ? `c-${ascii}` : ascii
  }
  return `c-${hashId(name).toString(16).padStart(8, '0')}`
}

export function categoryAccent(name: string): string {
  if (isBuiltinCategory(name)) return CATEGORY_ACCENT[name]
  return CATEGORY_ACCENT[LEGACY_CUSTOM_CATEGORY]
}

/** User-created 大类 names in first-seen order, excluding built-ins and leftover 自定义. */
export function discoverCustomCategoryNames(items: { category: string }[]): string[] {
  const reserved = new Set<string>([...FIXED_RAIL_CATEGORIES, LEGACY_CUSTOM_CATEGORY, ADULT_CATEGORY])
  const seen = new Set<string>()
  const names: string[] = []
  for (const it of items) {
    const name = it.category
    if (!name || reserved.has(name) || seen.has(name)) continue
    seen.add(name)
    names.push(name)
  }
  return names
}

/**
 * Rail 大类 order after「全部」:
 * fixed built-ins, then user-created names, leftover「自定义」if still in use, then 18+.
 */
export function railCategoryNames(items: { category: string }[]): string[] {
  const custom = discoverCustomCategoryNames(items)
  const hasLegacy = items.some((it) => it.category === LEGACY_CUSTOM_CATEGORY)
  return [
    ...FIXED_RAIL_CATEGORIES,
    ...custom,
    ...(hasLegacy ? [LEGACY_CUSTOM_CATEGORY] : []),
    ADULT_CATEGORY,
  ]
}

export function styleFacetExclude(customNames: string[]): Set<string> {
  if (customNames.length === 0) return STYLE_FACET_EXCLUDE
  return new Set([...STYLE_FACET_EXCLUDE, ...customNames])
}

export function validateCategoryName(
  raw: string,
  existing: string[],
): { ok: true; name: string } | { ok: false; error: string } {
  const name = raw.trim()
  if (!name) return { ok: false, error: '请输入大类名称' }
  if (name.length > 20) return { ok: false, error: '大类名称请控制在 1–20 个字符' }
  if (RESERVED_NEW_NAMES.has(name) || name.toLowerCase() === 'admin') {
    return { ok: false, error: '该名称不可用作大类' }
  }
  if (/[/\\]/.test(name)) {
    return { ok: false, error: '大类名称不能包含路径字符' }
  }
  const match = existing.find((e) => e === name)
  return { ok: true, name: match ?? name }
}

export const ADD_STYLE_CATEGORIES: string[] = [...FIXED_RAIL_CATEGORIES, ADULT_CATEGORY]
