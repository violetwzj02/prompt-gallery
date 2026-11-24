import { createServer } from 'node:http'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
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
})
writeFileSync(join(outDir, 'index.html'), readFileSync(join(dir, 'index.html')))

const PORT = Number(process.env.ALBUM_HARNESS_PORT || 4174)
const HOST = process.env.ALBUM_HARNESS_HOST || '0.0.0.0'
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8' }

const server = createServer((req, res) => {
  const path = req.url === '/' || !req.url ? '/index.html' : req.url.split('?')[0]
  const safe = path === '/index.html' || path === '/main.js'
  if (!safe) {
    res.writeHead(404)
    res.end('not found')
    return
  }
  const file = join(outDir, path.slice(1))
  const ext = path.endsWith('.js') ? '.js' : '.html'
  res.writeHead(200, { 'Content-Type': types[ext], 'Cache-Control': 'no-store' })
  res.end(readFileSync(file))
})

server.listen(PORT, HOST, () => {
  console.log(`album cache harness: http://127.0.0.1:${PORT}/`)
  console.log(`listening on ${HOST}:${PORT}, synthetic images only`)
})
