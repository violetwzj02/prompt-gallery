import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { buildSync } from 'esbuild'

const cacheDir = join(process.cwd(), 'node_modules', '.cache')
mkdirSync(cacheDir, { recursive: true })
const outfile = join(cacheDir, 'pg-cover-src.mjs')
buildSync({
  entryPoints: ['src/utils/coverSrc.ts'],
  outfile,
  bundle: true,
  platform: 'neutral',
  format: 'esm',
})
const { resolveCoverSrc } = await import(pathToFileURL(outfile).href)

const cases = []
const check = (name, got, expected) => {
  const ok = Object.is(got, expected)
  cases.push({ name, ok, got, expected })
  if (!ok) console.error(`FAIL ${name}\n  got: ${JSON.stringify(got)}\n  expected: ${JSON.stringify(expected)}`)
}

check('relative path gets ./ prefix', resolveCoverSrc('covers/entries/demo.jpg'), './covers/entries/demo.jpg')
check('already relative stays', resolveCoverSrc('./covers/categories/changjing.svg'), './covers/categories/changjing.svg')
check('absolute path stays', resolveCoverSrc('/local/fixture.png'), '/local/fixture.png')
check('data url is not prefixed', resolveCoverSrc('data:image/svg+xml,test'), 'data:image/svg+xml,test')
check('blob url is not prefixed', resolveCoverSrc('blob:https://example.test/1'), 'blob:https://example.test/1')
check('https url is not prefixed', resolveCoverSrc('https://example.test/a.png'), 'https://example.test/a.png')
check('trims whitespace', resolveCoverSrc('  data:image/png;base64,abc  '), 'data:image/png;base64,abc')

const failed = cases.filter((item) => !item.ok)
console.log(`${cases.length - failed.length}/${cases.length} passed`)
if (failed.length) process.exit(1)
