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

// 3. Declared larger than 80 MB: refused without downloading the body.
{
  const { env, seen } = world({ contentLength: 81 * 1024 * 1024 })
  const r = await executeTool('upload_portfolio_recording', { userEmail: EMAIL, sourceUrl: SRC, filename: 'big.m4a' }, env)
  check('too large (declared): refused', r.success === false && /at most 80 MB/.test(r.error), JSON.stringify(r))
  check('too large (declared): body cancelled, nothing stored', seen.cancelled === 1 && seen.uploads.length === 0 && seen.saves.length === 0, JSON.stringify(seen))
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
