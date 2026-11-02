#!/usr/bin/env node
// ---------------------------------------------------------------------------
// 无引擎截图夹具：不会真的构建，只把 /api/* 用固定数据答出来，好让 UI 在
// macOS / 无 docker 的机器上也能完整渲染（配合 ops/ui-shot.mjs 做视觉回归）。
//
//   pnpm build && node ops/ui-fixture.mjs        # http://127.0.0.1:8899
//   node ops/ui-shot.mjs http://127.0.0.1:8899 /tmp/ui.png \
//     --wait "document.querySelectorAll('.board').length > 0"
//
// 数据是编的：8 块假板子、预检永远通过、包搜索返回空。要改行为直接改这里。
// ---------------------------------------------------------------------------
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { newProfile, defaultProduct } from '../shared/src/index.ts'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DIST = path.join(ROOT, 'web/dist')
const PORT = Number(process.env.PORT ?? 8899)
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
}

const products = [
  ['rock-5b', 'Radxa ROCK 5B', 'rk3588'],
  ['rock-5t', 'Radxa ROCK 5T', 'rk3588'],
  ['rock-5a', 'Radxa ROCK 5A', 'rk3588s'],
  ['rock-4d', 'Radxa ROCK 4D', 'rk3576'],
  ['rock-4c-plus', 'Radxa ROCK 4C+', 'rk3399'],
  ['radxa-zero3w', 'Radxa ZERO 3W', 'rk3566'],
  ['cm5-io', 'Radxa CM5 IO', 'rk3588s'],
  ['e54c', 'Radxa E54C', 'rk3588s2'],
].map(([product, product_name, soc]) => ({
  product, product_name, soc: [soc], sector_size: [512, 4096],
  supported_suite: ['bookworm', 'trixie', 'jammy', 'noble'],
  supported_edition: ['server', 'desktop'], firmware_type: 'u-boot',
}))

const catalog = {
  source: 'image', rsdkVersion: '0.1.0', product: 'rock-5b', products,
  socs: products.map((p) => ({ soc: p.soc[0] })),
  suites: ['bookworm', 'trixie', 'jammy', 'noble'],
  editions: ['server', 'desktop'], image: 'rsdk-image:latest',
}

const env = {
  server: { version: '0.1.0', dataDir: '/tmp' },
  engine: { kind: 'podman', binary: '/usr/bin/podman', version: 'podman version 5.2.0', args: [], runExtra: [], rootless: true, ok: true },
  image: { ref: 'rsdk-image:latest', present: true, sizeBytes: 2_450_000_000 },
  buildTree: { ready: true, path: '/tmp/tree', rsdkVersion: '0.1.0', anchorOk: true },
  gh: { available: true, login: 'xzl01', tokenPresent: true },
}

const profiles = []
const json = (res, code, body) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)) }
const readBody = (req) => new Promise((r) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => r(b)) })

http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://x')
  const p = url.pathname

  if (p === '/api/health') return json(res, 200, { ok: true, version: '0.1.0' })
  if (p === '/api/env') return json(res, 200, env)
  if (p === '/api/catalog') return json(res, 200, catalog)
  if (p === '/api/catalog/new-profile') {
    const selected = products.find((x) => x.product === (url.searchParams.get('product') ?? '')) ?? defaultProduct(products) ?? products[0]
    return json(res, 200, newProfile({ product: selected, image: catalog.image, engine: 'podman' }))
  }
  if (p === '/api/profiles' && req.method === 'GET') return json(res, 200, profiles)
  if (p.startsWith('/api/profiles/') && req.method === 'PUT') {
    const v = JSON.parse(await readBody(req))
    const i = profiles.findIndex((x) => x.id === v.id)
    if (i >= 0) profiles[i] = v
    else profiles.push(v)
    return json(res, 200, v)
  }
  if (p.startsWith('/api/profiles/') && req.method === 'DELETE') return json(res, 200, { deleted: true })
  if (p === '/api/preflight' && req.method === 'POST') {
    return json(res, 200, {
      product: 'rock-5b', suite: 'trixie', testRepo: false,
      required: ['task-rock-5b', 'u-boot-rock-5b', 'linux-image-rock-5b', 'linux-headers-rock-5b'],
      missing: [], repos: [{ label: 'trixie（站点静态索引）', exists: true, packageCount: 64213 }],
      suggestTestRepo: false, checkedAt: Date.now(),
    })
  }
  if (p === '/api/render' && req.method === 'POST') {
    return json(res, 200, {
      files: [
        { path: 'profile.json', content: '{ "version": 1, ... }', mode: 420, binary: false },
        { path: 'run.sh', content: '#!/usr/bin/env bash\n# host-side launcher\nset -euo pipefail\n...', mode: 493, binary: false },
        { path: 'install.sh', content: '#!/usr/bin/env bash\n# customize hook\nset -euo pipefail\n...', mode: 493, binary: false },
      ],
      command: 'rsdk build --sector-size 512 --image-name output.img rock-5b trixie server',
      env,
    })
  }
  if (p === '/api/packages/index-status') return json(res, 200, { key: 'trixie', meta: { count: 64213, builtAt: Date.now() } })
  if (p === '/api/packages/search') return json(res, 200, { key: 'trixie', meta: { count: 64213 }, hits: [] })
  if (p === '/api/jobs') return json(res, 200, [])
  if (p.startsWith('/api/')) return json(res, 404, { error: 'not found' })

  let file = path.join(DIST, p === '/' ? 'index.html' : p)
  if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, 'index.html')
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream' })
  fs.createReadStream(file).pipe(res)
}).listen(PORT, '127.0.0.1', () => console.log(`fixture on http://127.0.0.1:${PORT}`))
