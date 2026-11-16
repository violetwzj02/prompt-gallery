/** Stable 32-bit hash from string (FNV-1a-ish). */
export function hashId(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

export function paletteFromId(id: string): {
  hue: number
  sat: number
  light: number
  angle: number
  seed: number
} {
  const h = hashId(id)
  return {
    hue: h % 360,
    sat: 45 + (h % 35),
    light: 40 + ((h >> 8) % 25),
    angle: (h >> 4) % 360,
    seed: h,
  }
}

/**
 * Collection-related palettes: siblings share a base hue/grade,
 * while each sub-prompt gets a distinct motif from its own id.
 */
export function collectionPalette(collectionKey: string | null | undefined, itemId: string) {
  const base = paletteFromId(collectionKey || itemId)
  const item = paletteFromId(itemId)
  const hue = collectionKey ? (base.hue + ((item.seed % 18) - 9) + 360) % 360 : item.hue
  return {
    hue,
    altHue: item.hue,
    sat: 32 + (base.sat % 22),
    light: 34 + (item.seed % 18),
    angle: (base.angle + (item.seed % 48) - 24 + 360) % 360,
    motif: item.seed % 4,
    seed: item.seed,
    baseHue: base.hue,
  }
}
