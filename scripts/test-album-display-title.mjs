import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { buildSync } from 'esbuild'

const outfile = join(mkdtempSync(join(tmpdir(), 'pg-album-title-')), 'albumDisplay.mjs')
buildSync({
  entryPoints: ['src/utils/albumDisplay.ts'],
  outfile,
  bundle: true,
  platform: 'neutral',
  format: 'esm',
})

const { albumDisplayTitle, isOpaqueAlbumTitle, formatAlbumImageNumber } = await import(pathToFileURL(outfile).href)

const cases = []
const check = (name, got, expected) => {
  const ok = Object.is(got, expected) || JSON.stringify(got) === JSON.stringify(expected)
  cases.push({ name, ok, got, expected })
  if (!ok) console.error(`FAIL ${name}\n  got: ${JSON.stringify(got)}\n  expected: ${JSON.stringify(expected)}`)
}

check('pads 1', formatAlbumImageNumber(1), '001')
check('pads 12', formatAlbumImageNumber(12), '012')
check('floor safe', formatAlbumImageNumber(2.9), '002')
check('min 1', formatAlbumImageNumber(0), '001')

check('empty is opaque', isOpaqueAlbumTitle(''), true)
check('blank is opaque', isOpaqueAlbumTitle('   '), true)
check('null is opaque', isOpaqueAlbumTitle(null), true)
check('rfc uuid', isOpaqueAlbumTitle('550e8400-e29b-41d4-a716-446655440000'), true)
check('loose uuid', isOpaqueAlbumTitle('aaaaaaaa-1111-2222-3333-444444444444'), true)
check('uppercase uuid', isOpaqueAlbumTitle('1B5F5DD6-0000-0000-0000-000000000001'), true)
check('32 hex', isOpaqueAlbumTitle('abcdef0123456789abcdef0123456789'), true)
check('dashed 32 hex compact', isOpaqueAlbumTitle('abcdef01-23456789-abcdef01-23456789'), true)
check('16 hex', isOpaqueAlbumTitle('abcdef0123456789'), true)
check('readable chinese', isOpaqueAlbumTitle('日落海边'), false)
check('readable mixed', isOpaqueAlbumTitle('风景 001'), false)
check('short hex stays readable', isOpaqueAlbumTitle('e4e2c858'), false)

check('empty fallback', albumDisplayTitle({ title: '', index: 1 }), '图片001')
check('uuid fallback index 4', albumDisplayTitle({ title: '550e8400-e29b-41d4-a716-446655440000', index: 4 }), '图片004')
check('hex fallback', albumDisplayTitle({ title: 'abcdef0123456789abcdef0123456789', index: 12 }), '图片012')
check('keeps readable', albumDisplayTitle({ title: '日落海边', index: 3 }), '日落海边')
check('trims readable', albumDisplayTitle({ title: '  海边  ', index: 1 }), '海边')
check('does not invent character names', albumDisplayTitle({ title: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', index: 2 }), '图片002')

const failed = cases.filter((c) => !c.ok)
console.log(`${cases.length - failed.length}/${cases.length} passed`)
if (failed.length) process.exit(1)
