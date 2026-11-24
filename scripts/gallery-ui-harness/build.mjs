import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildSync } from 'esbuild'

const dir = dirname(fileURLToPath(import.meta.url))
export const outDir = join(dir, '.generated')

const REQUIRED_CSS_MARKERS = {
  'src/index.css': [':root', '--bg:', '--text:', 'html[data-theme'],
  'src/App.css': ['.topbar', '.detail-close', '.prompt-card', '.rail'],
  'src/components/account/account.css': ['.account-main', '.download-center'],
  'src/components/account/album.css': ['.album-lightbox', '.album-viewer'],
  'src/components/admin/admin.css': ['.admin-'],
}

export function buildGalleryUiHarness() {
  mkdirSync(outDir, { recursive: true })
  buildSync({
    entryPoints: [join(dir, 'main.tsx')],
    outfile: join(outDir, 'main.js'),
    bundle: true,
    platform: 'browser',
    format: 'esm',
    jsx: 'automatic',
    define: {
      'import.meta.env.VITE_SUPABASE_URL': '""',
      'import.meta.env.VITE_SUPABASE_ANON_KEY': '""',
      'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY': '""',
      'import.meta.env.DEV': 'true',
      'import.meta.env.PROD': 'false',
      'import.meta.env.MODE': '"harness"',
      'import.meta.env.BASE_URL': '"/"',
    },
  })

  const cssPath = join(outDir, 'main.css')
  if (!existsSync(cssPath)) {
    throw new Error('harness build did not emit main.css')
  }
  const css = readFileSync(cssPath, 'utf8')
  const missing = []
  for (const [file, markers] of Object.entries(REQUIRED_CSS_MARKERS)) {
    for (const marker of markers) {
      if (!css.includes(marker)) missing.push(`${file}: ${marker}`)
    }
  }
  if (missing.length) {
    throw new Error(`harness CSS is missing production styles:\n${missing.join('\n')}`)
  }

  let html = readFileSync(join(dir, 'index.html'), 'utf8')
  if (!html.includes('href="./main.css"')) {
    throw new Error('harness index.html must link ./main.css')
  }
  if (!html.includes('data-theme') || !html.includes('prompt-gallery-theme')) {
    throw new Error('harness index.html must include the production theme bootstrap')
  }
  html = html.replace(
    '<!-- harness-css-evidence -->',
    `<!-- harness-css-evidence: ${statSync(cssPath).size} bytes; index.css + App.css + account/album/admin.css -->`,
  )
  writeFileSync(join(outDir, 'index.html'), html)
  writeFileSync(join(outDir, 'main.css'), css)

  return {
    outDir,
    cssBytes: statSync(cssPath).size,
    jsBytes: statSync(join(outDir, 'main.js')).size,
    markers: Object.keys(REQUIRED_CSS_MARKERS),
  }
}
