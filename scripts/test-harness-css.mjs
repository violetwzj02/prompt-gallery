import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildGalleryUiHarness } from './gallery-ui-harness/build.mjs'

const cases = []
const check = (name, got, expected = true) => {
  const ok = typeof expected === 'boolean' && expected === true ? Boolean(got) : Object.is(got, expected)
  cases.push({ name, ok, got, expected })
  if (!ok) console.error(`FAIL ${name}\n  got: ${JSON.stringify(got)}\n  expected: ${JSON.stringify(expected)}`)
}

const result = buildGalleryUiHarness()
const html = readFileSync(join(result.outDir, 'index.html'), 'utf8')
const css = readFileSync(join(result.outDir, 'main.css'), 'utf8')
const js = readFileSync(join(result.outDir, 'main.js'), 'utf8')

check('emits main.css with production styles', result.cssBytes > 10_000)
check('html links main.css', html.includes('href="./main.css"'))
check('html has production theme bootstrap', html.includes('prompt-gallery-theme') && html.includes('data-theme'))
check('css includes index.css tokens', css.includes('--bg:') && css.includes('--text:') && css.includes(':root'))
check('css includes App.css shell', css.includes('.topbar') && css.includes('.prompt-card') && css.includes('.rail'))
check('css includes account and album styles', css.includes('.account-main') && css.includes('.album-lightbox'))
check('mobile detail close is fixed and in-viewport', /detail-overlay\s+\.detail-close[\s\S]{0,400}position:\s*fixed/.test(css))
check('fixture includes local editable style', js.includes('fixture-local-edit') && js.includes('local: true'))
check('bundle does not embed quyi cards json', !js.includes('quyi-cards.json') || js.includes('BLOCKED_URL_PATTERN'))
check('bundle does not embed covers/entries', !css.includes('covers/entries') && js.includes('BLOCKED_URL_PATTERN'))
check('no live supabase project url baked in', !js.includes('ptxyvqkushfmowfzqeia') && !js.includes('VITE_SUPABASE_URL') && !js.includes('VITE_SUPABASE_ANON_KEY'))

const failed = cases.filter((item) => !item.ok)
console.log(`${cases.length - failed.length}/${cases.length} passed`)
if (failed.length) process.exit(1)
console.log(`harness css ${result.cssBytes} bytes; js ${result.jsBytes} bytes`)
