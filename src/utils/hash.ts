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
