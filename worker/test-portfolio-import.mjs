// upload_portfolio_recording from a sourceUrl (2026-11-15): the executor behind the MCP server's
// import_recording_from_url. It must refuse a non-https URL and a file over 80 MB before anything
// is stored, and on success store the bytes once and register them in the caller's own portfolio.
//
// Run:  node worker/test-portfolio-import.mjs   (exit 0 = pass, 1 = fail)
import fs from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'

const dir = path.dirname(fileURLToPath(import.meta.url))
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'portfolio-import-'))
for (const f of fs.readdirSync(dir)) if (f.endsWith('.js')) fs.copyFileSync(path.join(dir, f), path.join(tmp, f))
fs.writeFileSync(path.join(tmp, 'package.json'), '{"type":"module"}')
fs.symlinkSync(path.join(dir, 'node_modules'), path.join(tmp, 'node_modules'))
const { executeTool } = await import(path.join(tmp, 'tool-executors.js'))

let failures = 0
const check = (name, ok, msg = '') => { if (ok) console.log(`ok    ${name}`); else { failures++; console.error(`FAIL  ${name}\n      ${msg}`) } }

const EMAIL = 'alice@example.com'
const SRC = 'https://files.example/tmp/abc/2026-11-09%20Gruppe.m4a'

function world({ audioBytes = 2000, contentLength, status = 200 } = {}) {
  const seen = { downloads: [], uploads: [], saves: [], cancelled: 0 }
  const json = (body, ok = true, st = 200) => ({ ok, status: st, json: async () => body })
  const env = {
    NORWEGIAN_AUDIO: { fetch: async (url, init) => {
      seen.uploads.push({ name: init.headers['X-File-Name'], size: init.body.byteLength })
      return json({ success: true, audioUrl: 'https://audio.example/audio/ts-file.m4a', r2Key: 'audio/ts-file.m4a', size: init.body.byteLength, contentType: 'audio/mp4' })
    } },
    AUDIO_PORTFOLIO: { fetch: async (url, init) => {
      seen.saves.push({ owner: init.headers['X-User-Email'], body: JSON.parse(init.body) })
      return json({ success: true, recordingId: 'rec_new_1' })
    } },
  }
  globalThis.fetch = async (url) => {
    seen.downloads.push(String(url))
    const bytes = new Uint8Array(audioBytes).fill(1)
    const headers = new Map([['content-length', String(contentLength ?? bytes.length)]])
    return { ok: status === 200, status, headers: { get: (k) => headers.get(k.toLowerCase()) || null }, arrayBuffer: async () => bytes.buffer, body: { cancel: async () => { seen.cancelled++ } } }
  }
  return { env, seen }
}

// 1. The happy path: one download, one upload, one portfolio entry owned by the caller.
{
  const { env, seen } = world()
  const r = await executeTool('upload_portfolio_recording', { userEmail: EMAIL, sourceUrl: SRC, filename: '2026-11-09_Gruppe.m4a', displayName: '2026-11-09 Gruppe', tags: ['url-import'] }, env)
  check('import: succeeds with a recordingId', r.success === true && r.recordingId === 'rec_new_1', JSON.stringify(r))
  check('import: the file was downloaded once', seen.downloads.length === 1 && seen.downloads[0] === SRC, seen.downloads.join(','))
  check('import: the bytes were uploaded under the safe file name', seen.uploads.length === 1 && seen.uploads[0].name === '2026-11-09_Gruppe.m4a' && seen.uploads[0].size === 2000, JSON.stringify(seen.uploads))
  const s = seen.saves[0]
  check('import: registered in the caller\'s own portfolio', seen.saves.length === 1 && s.owner === EMAIL && s.body.userEmail === EMAIL, JSON.stringify(s))
  check('import: the person-facing name is kept', s.body.displayName === '2026-11-09 Gruppe' && s.body.tags.includes('url-import') && s.body.r2Key === 'audio/ts-file.m4a', JSON.stringify(s.body))
}

// 2. Not https: refused before any request.
{
  const { env, seen } = world()
  const r = await executeTool('upload_portfolio_recording', { userEmail: EMAIL, sourceUrl: 'http://files.example/a.m4a', filename: 'a.m4a' }, env)
  check('http: refused', r.success === false && /https/.test(r.error), JSON.stringify(r))
  check('http: nothing fetched or stored', seen.downloads.length === 0 && seen.uploads.length === 0 && seen.saves.length === 0, JSON.stringify(seen))
}

// 3. Declared larger than 400 MB (2026-11-21; was 80 MB before the multipart path): refused
//    without downloading the body.
{
  const { env, seen } = world({ contentLength: 401 * 1024 * 1024 })
  const r = await executeTool('upload_portfolio_recording', { userEmail: EMAIL, sourceUrl: SRC, filename: 'big.m4a' }, env)
  check('too large (declared): refused', r.success === false && /400 MB/.test(r.error), JSON.stringify(r))
  check('too large (declared): body cancelled, nothing stored', seen.cancelled === 1 && seen.uploads.length === 0 && seen.saves.length === 0, JSON.stringify(seen))
}

// 5. Declared over 80 MB (an 85 MB Zoom file): streamed in 10 MB parts to the multipart upload,
//    never held whole. The body really is 85 MB, delivered in odd-sized chunks, so the part
//    boundaries are exercised; arrayBuffer() throws, so reading it whole would fail the test.
{
  const SIZE = 85 * 1024 * 1024 + 12345
  const PART = 10 * 1024 * 1024
  const seen = { inits: [], parts: [], completes: [], aborts: 0, simpleUploads: 0, saves: [] }
  const json = (body, ok = true, st = 200) => ({ ok, status: st, json: async () => body })
  const env = {
    NORWEGIAN_AUDIO: { fetch: async (url, init) => {
      const u = new URL(url)
      if (u.pathname === '/upload') { seen.simpleUploads++; return json({ success: true, audioUrl: 'x' }) }
      if (u.pathname === '/upload/init') { const b = JSON.parse(init.body); seen.inits.push(b); return json({ success: true, uploadId: 'up1', key: 'audio/ts-' + b.filename }) }
      if (u.pathname === '/upload/part') {
        const n = Number(u.searchParams.get('partNumber'))
        const body = init.body
        seen.parts.push({ n, size: body.byteLength, first: body[0], last: body[body.byteLength - 1], key: u.searchParams.get('key'), uploadId: u.searchParams.get('uploadId') })
        return json({ success: true, part: { partNumber: n, etag: 'e' + n } })
      }
      if (u.pathname === '/upload/complete') { const b = JSON.parse(init.body); seen.completes.push(b); return json({ success: true, audioUrl: 'https://audio.example/' + b.key, r2Key: b.key, size: b.size, contentType: b.contentType }) }
      if (u.pathname === '/upload/abort') { seen.aborts++; return json({ success: true }) }
      return json({ success: false }, false, 404)
    } },
    AUDIO_PORTFOLIO: { fetch: async (url, init) => { seen.saves.push(JSON.parse(init.body)); return json({ success: true, recordingId: 'rec_big' }) } },
  }
  // byte i of the file is i % 251, so every part's first and last byte can be checked
  const byteAt = (i) => i % 251
  globalThis.fetch = async () => {
    let sent = 0
    const CHUNK = 3 * 1024 * 1024 + 7
    return {
      ok: true, status: 200,
      headers: { get: (k) => ({ 'content-length': String(SIZE), 'content-type': 'application/octet-stream' })[k.toLowerCase()] || null },
      arrayBuffer: async () => { throw new Error('the whole file must not be read into memory') },
      body: {
        cancel: async () => {},
        getReader: () => ({ read: async () => {
          if (sent >= SIZE) return { done: true }
          const n = Math.min(CHUNK, SIZE - sent)
          const v = new Uint8Array(n)
          for (let k = 0; k < n; k++) v[k] = byteAt(sent + k)
          sent += n
          return { done: false, value: v }
        } }),
      },
    }
  }
  const r = await executeTool('upload_portfolio_recording', { userEmail: EMAIL, sourceUrl: SRC, filename: 'GMT20220328-180106_MaikenTorArne.m4a' }, env)
  check('streamed: succeeds', r.success === true && r.recordingId === 'rec_big', JSON.stringify(r))
  check('streamed: multipart, not the single /upload', seen.simpleUploads === 0 && seen.inits.length === 1 && seen.completes.length === 1 && seen.aborts === 0, JSON.stringify({ ...seen, parts: seen.parts.length }))
  check('streamed: init has the size and an audio type', seen.inits[0]?.size === SIZE && seen.inits[0]?.contentType === 'audio/mp4', JSON.stringify(seen.inits))
  const expectParts = Math.ceil(SIZE / PART)
  check('streamed: 10 MB parts, all but the last full', seen.parts.length === expectParts && seen.parts.slice(0, -1).every(p => p.size === PART) && seen.parts.at(-1).size === SIZE - PART * (expectParts - 1), seen.parts.map(p => p.size).join(','))
  check('streamed: parts in order with the right bytes', seen.parts.every((p, i) => p.n === i + 1 && p.first === byteAt(i * PART) && p.last === byteAt(i * PART + p.size - 1) && p.uploadId === 'up1'), JSON.stringify(seen.parts.slice(0, 2)))
  const c = seen.completes[0] || {}
  check('streamed: complete lists every part and the real size', c.parts?.length === expectParts && c.parts.every((p, i) => p.partNumber === i + 1 && p.etag === 'e' + (i + 1)) && c.size === SIZE, JSON.stringify(c).slice(0, 300))
  check('streamed: registered with the stored address and size', seen.saves[0]?.r2Url === 'https://audio.example/' + c.key && seen.saves[0]?.fileSize === SIZE && seen.saves[0]?.audioFormat === 'mp4', JSON.stringify(seen.saves[0]))
}

// 6. A part upload fails half-way: the multipart upload is aborted and nothing is registered.
{
  const SIZE = 30 * 1024 * 1024
  const seen = { aborts: 0, saves: 0 }
  const json = (body, ok = true, st = 200) => ({ ok, status: st, json: async () => body })
  const env = {
    NORWEGIAN_AUDIO: { fetch: async (url) => {
      const u = new URL(url)
      if (u.pathname === '/upload/init') return json({ success: true, uploadId: 'up2', key: 'audio/k' })
      if (u.pathname === '/upload/part') return Number(u.searchParams.get('partNumber')) === 2 ? json({ success: false, error: 'R2 said no' }, false, 502) : json({ success: true, part: { etag: 'e' } })
      if (u.pathname === '/upload/abort') { seen.aborts++; return json({ success: true }) }
      return json({ success: true, audioUrl: 'x' })
    } },
    AUDIO_PORTFOLIO: { fetch: async () => { seen.saves++; return json({ success: true }) } },
  }
  globalThis.fetch = async () => {
    let sent = 0
    return { ok: true, status: 200, headers: { get: (k) => k.toLowerCase() === 'content-length' ? String(85 * 1024 * 1024) : null },
      body: { cancel: async () => {}, getReader: () => ({ read: async () => { if (sent >= SIZE) return { done: true }; sent += 1048576; return { done: false, value: new Uint8Array(1048576) } } }) } }
  }
  const r = await executeTool('upload_portfolio_recording', { userEmail: EMAIL, sourceUrl: SRC, filename: 'x.m4a' }, env)
  check('part fails: reported', r.success === false && /R2 said no/.test(r.error), JSON.stringify(r))
  check('part fails: aborted, nothing registered', seen.aborts === 1 && seen.saves === 0, JSON.stringify(seen))
}

// 4. The source answers an error (an expired or already-used link): reported, nothing stored.
{
  const { env, seen } = world({ status: 410 })
  const r = await executeTool('upload_portfolio_recording', { userEmail: EMAIL, sourceUrl: SRC, filename: 'gone.m4a' }, env)
  check('dead link: reported with its status', r.success === false && /410/.test(r.error), JSON.stringify(r))
  check('dead link: nothing stored', seen.uploads.length === 0 && seen.saves.length === 0, JSON.stringify(seen))
}

fs.rmSync(tmp, { recursive: true, force: true })
if (failures) { console.error(`\n${failures} check(s) failed`); process.exit(1) }
console.log('\nall portfolio-import checks passed')
