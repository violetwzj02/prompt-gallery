/** Resolve a stored cover reference into a usable image URL. */
export function resolveCoverSrc(src: string): string {
  const value = src.trim()
  if (!value) return value
  if (
    /^(data:|blob:|https?:|\/\/)/i.test(value) ||
    value.startsWith('./') ||
    value.startsWith('/')
  ) {
    return value
  }
  return `./${value}`
}
