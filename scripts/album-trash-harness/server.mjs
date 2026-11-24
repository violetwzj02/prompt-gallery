import { createServer } from 'node:http'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildSync } from 'esbuild'

const dir = dirname(fileURLToPath(import.meta.url))
const outDir = join(dir, '.generated')
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
    'import.meta.env.VITE_GOOGLE_CLIENT_ID': '""',
    'import.meta.env.DEV': 'true',
    'import.meta.env.PROD': 'false',
    'import.meta.env.MODE': '"harness"',
    'import.meta.env.BASE_URL': '"/"',
  },
})

const cssPath = join(outDir, 'main.css')
if (!existsSync(cssPath)) {
  throw new Error('album trash harness build did not emit main.css')
}
const css = readFileSync(cssPath, 'utf8')
const required = [':root', '--bg:', '--text:', '.album-lightbox', '.album-chip--trash', '.album']
const missing = required.filter((marker) => !css.includes(marker))
if (missing.length) {
  throw new Error(`album trash harness CSS is missing: ${missing.join(', ')}`)
}

let html = readFileSync(join(dir, 'index.html'), 'utf8')
if (!html.includes('href="./main.css"')) {
  throw new Error('harness index.html must link ./main.css')
}
html = html.replace(
  '<!-- harness-css-evidence -->',
  `<!-- harness-css-evidence: ${statSync(cssPath).size} bytes; index.css + App.css + account/album.css -->`,
)
writeFileSync(join(outDir, 'index.html'), html)
writeFileSync(join(outDir, 'main.css'), css)

const PORT = Number(process.env.ALBUM_TRASH_HARNESS_PORT || 4176)
const HOST = process.env.ALBUM_TRASH_HARNESS_HOST || '0.0.0.0'
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
}
const allowed = new Set(['/index.html', '/main.js', '/main.css'])

const server = createServer((req, res) => {
  const path = req.url === '/' || !req.url ? '/index.html' : req.url.split('?')[0]
  if (!allowed.has(path)) {
    res.writeHead(404)
    res.end('not found')
    return
  }
  const ext = extname(path)
  res.writeHead(200, { 'Content-Type': types[ext], 'Cache-Control': 'no-store' })
  res.end(readFileSync(join(outDir, path.slice(1))))
})

server.listen(PORT, HOST, () => {
  console.log(`album trash harness: http://127.0.0.1:${PORT}/`)
  console.log(`production styles served at /main.css (${statSync(cssPath).size} bytes); synthetic fixtures only`)
})
