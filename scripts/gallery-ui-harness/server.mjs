import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import { buildGalleryUiHarness } from './build.mjs'

const { outDir, cssBytes } = buildGalleryUiHarness()

const PORT = Number(process.env.GALLERY_UI_HARNESS_PORT || 4175)
const HOST = process.env.GALLERY_UI_HARNESS_HOST || '0.0.0.0'
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
  console.log(`gallery UI harness: http://127.0.0.1:${PORT}/`)
  console.log(`production styles served at /main.css (${cssBytes} bytes); synthetic fixtures only`)
})
