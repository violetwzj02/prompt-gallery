import { createRequire } from 'node:module'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { buildSync } from 'esbuild'

const outfile = join(mkdtempSync(join(tmpdir(), 'pg-dl-')), 'downloadOriginal.mjs')
buildSync({
  entryPoints: ['src/utils/downloadOriginal.ts'],
  outfile,
  bundle: true,
  platform: 'neutral',
  format: 'esm',
})

const mod = await import(pathToFileURL(outfile).href)
const {
  sanitizeFilename,
  basenameFromUrl,
  extFromMime,
  formatBytes,
  parseDownloadHistory,
  resolveGallerySrc,
  isEphemeralUrl,
  normalizeCoverKey,
  lookupOriginal,
  resolveDownloadTarget,
} = mod

const cases = []
const check = (name, got, expected) => {
  const ok = Object.is(got, expected) || JSON.stringify(got) === JSON.stringify(expected)
  cases.push({ name, ok, got, expected })
  if (!ok) console.error(`FAIL ${name}\n  got: ${JSON.stringify(got)}\n  expected: ${JSON.stringify(expected)}`)
}

check('sanitize keeps basename', sanitizeFilename('covers/entries/renwu-22-02.jpg'), 'renwu-22-02.jpg')
check('sanitize strips illegal', sanitizeFilename('a/b:c*.png'), 'b_c_.png')
check('sanitize empty', sanitizeFilename('...'), 'image.jpg')
check('basename path', basenameFromUrl('covers/entries/renwu-18-02.jpg'), 'renwu-18-02.jpg')
check('basename relative', basenameFromUrl('./covers/entries/renwu-21.jpg'), 'renwu-21.jpg')
check('basename query', basenameFromUrl('https://example.com/a/b/c.png?t=1'), 'c.png')
check('basename data', basenameFromUrl('data:image/png;base64,abc'), 'image.png')
check('ext jpeg', extFromMime('image/jpeg'), 'jpg')
check('ext png', extFromMime('image/png'), 'png')
check('bytes null', formatBytes(null), '—')
check('bytes kb', formatBytes(275378), '269 KB')
check('bytes mb', formatBytes(1536000), '1.5 MB')
check('resolve gallery', resolveGallerySrc('covers/entries/renwu-22-02.jpg'), './covers/entries/renwu-22-02.jpg')
check('resolve data prefers data', resolveGallerySrc('covers/x.jpg', 'data:image/jpeg;base64,xx'), 'data:image/jpeg;base64,xx')
check('ephemeral blob', isEphemeralUrl('blob:https://x/1'), true)
check('durable url', isEphemeralUrl('./covers/entries/renwu-22-02.jpg'), false)

const parsed = parseDownloadHistory(JSON.stringify([
  { id: '1', filename: 'renwu-22-02.jpg', source: '樱花', url: './covers/entries/renwu-22-02.jpg', time: 1, size: 10, status: 'success', folderName: 'Pictures' },
  { id: 2, filename: 'bad' },
  { status: 'fail' },
]))
check('history keeps valid', parsed.length, 1)
check('history filename', parsed[0].filename, 'renwu-22-02.jpg')
check('history folder', parsed[0].folderName, 'Pictures')
check('history ignores junk', parseDownloadHistory('not-json').length, 0)

const originals = {
  'covers/entries/renwu-22-02.jpg': {
    original: 'covers/originals/renwu-22-02.png',
    filename: 'renwu-22-02.png',
    bytes: 1823500,
  },
}
check('key relative', normalizeCoverKey('./covers/entries/renwu-22-02.jpg'), 'covers/entries/renwu-22-02.jpg')
check('key bare', normalizeCoverKey('covers/entries/renwu-22-02.jpg'), 'covers/entries/renwu-22-02.jpg')
check('key query', normalizeCoverKey('./covers/entries/renwu-22-02.jpg?t=1'), 'covers/entries/renwu-22-02.jpg')
check('key site path', normalizeCoverKey('https://example.com/prompt-gallery/covers/entries/renwu-22-02.jpg'), 'covers/entries/renwu-22-02.jpg')
check('key ephemeral', normalizeCoverKey('blob:https://x/1'), null)
check('lookup hit', lookupOriginal('./covers/entries/renwu-22-02.jpg', originals).filename, 'renwu-22-02.png')
check('lookup miss', lookupOriginal('./covers/entries/renwu-22.jpg', originals), null)
const hit = resolveDownloadTarget('./covers/entries/renwu-22-02.jpg', originals, 'renwu-22-02.jpg')
check('target uses original url', hit.url, './covers/originals/renwu-22-02.png')
check('target uses png name', hit.filename, 'renwu-22-02.png')
check('target fromOriginal', hit.fromOriginal, true)
const miss = resolveDownloadTarget('./covers/entries/renwu-22.jpg', originals, 'renwu-22.jpg')
check('fallback url is display jpeg', miss.url, './covers/entries/renwu-22.jpg')
check('fallback name stays jpg', miss.filename, 'renwu-22.jpg')
check('fallback not original', miss.fromOriginal, false)

const failed = cases.filter((c) => !c.ok)
console.log(`${cases.length - failed.length}/${cases.length} passed`)
if (failed.length) process.exit(1)
