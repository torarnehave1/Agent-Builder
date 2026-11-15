// vemotion_list_audio and list_recordings use the portfolio worker's fast listing (2026-11-15).
//
// The legacy /list-recordings walks every user's keys and reads each full record in sequence;
// "my latest recording" took tens of seconds. `order=newest` lists ONE owner's key names, newest
// first, and reads only the requested page (in parallel; `fields=light` drops transcripts).
// The executors must use it, stop early when the latest few are all that is asked for, and fall
// back to the legacy listing when the fast path is missing or sees nothing.
//
// Run:  node worker/test-portfolio-fast-list.mjs   (exit 0 = pass, 1 = fail)
import fs from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'

const dir = path.dirname(fileURLToPath(import.meta.url))
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'portfolio-fast-'))
for (const f of fs.readdirSync(dir)) if (f.endsWith('.js')) fs.copyFileSync(path.join(dir, f), path.join(tmp, f))
fs.writeFileSync(path.join(tmp, 'package.json'), '{"type":"module"}')
fs.symlinkSync(path.join(dir, 'node_modules'), path.join(tmp, 'node_modules'))
const { executeTool } = await import(path.join(tmp, 'tool-executors.js'))

let failures = 0
const check = (name, ok, msg) => { if (ok) console.log(`ok    ${name}`); else { failures++; console.error(`FAIL  ${name}\n      ${msg}`) } }

const EMAIL = 'alice@example.com'
// 260 recordings, newest first. Every 3rd is a conversation (tagged "contacts"); every 5th of the
// rest is tagged "vemotion". Index 0 is the newest.
const ALL = Array.from({ length: 260 }, (_, i) => {
  const contact = i % 3 === 1
  return {
    recordingId: `rec_${String(2000000 - i)}_x`,
    displayName: contact ? `Contact Log Recording ${i}` : `Song ${i}`,
    fileName: `file-${i}.m4a`,
    r2Url: `https://audio.example/${i}.m4a`,
    r2Key: `audio/${i}.m4a`,
    duration: 10 + i,
    audioFormat: 'm4a',
    tags: contact ? ['contacts'] : (i % 5 === 0 ? ['vemotion'] : []),
    createdAt: new Date(Date.UTC(2026, 10, 14) - i * 3600e3).toISOString(),
    transcriptionText: `full transcript ${i}`,
  }
})

// A portfolio worker. mode: 'fast' (has order=newest), 'legacy-only' (ignores order), 'empty-fast'
// (fast path sees nothing, legacy sees everything — keys under another spelling of the e-mail).
function portfolio(mode, owned = { [EMAIL]: ALL }) {
  const calls = []
  const fetch = async (url) => {
    const p = new URL(url).searchParams
    const owner = p.get('ownerEmail') || p.get('userEmail')
    const records = owned[owner] || []
    const limit = Number(p.get('limit') || 50)
    const fast = p.get('order') === 'newest' && mode !== 'legacy-only'
    calls.push({ fast, owner, limit, offset: Number(p.get('offset') || 0), light: p.get('fields') === 'light', cursor: p.get('cursor') })
    let body
    if (fast) {
      const visible = mode === 'empty-fast' ? [] : records
      const offset = Number(p.get('offset') || 0)
      const page = visible.slice(offset, offset + limit).map((r) => {
        if (p.get('fields') !== 'light') return r
        const { transcriptionText, ...rest } = r
        return { ...rest, hasTranscript: Boolean(transcriptionText) }
      })
      const nextOffset = offset + page.length
      body = { recordings: page, total: visible.length, offset, nextOffset, hasMore: nextOffset < visible.length }
    } else {
      // Legacy: OLDEST first, cursor = next index.
      const oldestFirst = [...records].reverse()
      const start = Number(p.get('cursor') || 0)
      const page = oldestFirst.slice(start, start + limit)
      const next = start + page.length
      body = { recordings: page, total: page.length, cursor: next < oldestFirst.length ? String(next) : null }
    }
    return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) }
  }
  return { env: { AUDIO_PORTFOLIO: { fetch } }, calls }
}

const usable = ALL.filter((r) => !r.tags.includes('contacts'))

// 1. The latest recording: one small fast page, no transcripts, nothing else read.
{
  const { env, calls } = portfolio('fast')
  const r = await executeTool('vemotion_list_audio', { userEmail: EMAIL, limit: 1 }, env)
  check('latest recording: exactly one request', calls.length === 1, JSON.stringify(calls))
  check('latest recording: fast path, light, small page', calls[0]?.fast && calls[0]?.light && calls[0]?.limit <= 20, JSON.stringify(calls[0]))
  check('latest recording: it is the newest usable one', r.count === 1 && r.recordings[0]?.name === usable[0].displayName, JSON.stringify(r.recordings))
  check('latest recording: says more exist instead of guessing a total', r.hasMore === true && r.total === undefined && /more exist/.test(r.message), JSON.stringify(r))
  check('reports how long it took', typeof r.tookMs === 'number', JSON.stringify(r.tookMs))
}

// 2. Twenty latest: conversation recordings are skipped and the result is still 20, newest first.
{
  const { env, calls } = portfolio('fast')
  const r = await executeTool('vemotion_list_audio', { userEmail: EMAIL, limit: 20 }, env)
  const names = r.recordings.map((x) => x.name)
  check('20 latest: 20 returned', r.count === 20, `count ${r.count}`)
  check('20 latest: same as the 20 newest usable', JSON.stringify(names) === JSON.stringify(usable.slice(0, 20).map((x) => x.displayName)), names.join(', '))
  check('20 latest: no conversation recording', r.recordings.every((x) => !x.tags.includes('contacts')), JSON.stringify(names))
  check('20 latest: stops early (not the whole portfolio)', calls.length <= 2 && calls.every((c) => c.fast), JSON.stringify(calls))
}

// 3. Asking for more than exist reads to the end and gives the exact total.
{
  const few = ALL.slice(0, 12)
  const { env } = portfolio('fast', { [EMAIL]: few })
  const r = await executeTool('vemotion_list_audio', { userEmail: EMAIL, limit: 50 }, env)
  const expected = few.filter((x) => !x.tags.includes('contacts')).length
  check('small portfolio: exact total, no hasMore', r.total === expected && r.count === expected && r.hasMore === undefined, JSON.stringify({ total: r.total, count: r.count, hasMore: r.hasMore }))
}

// 4. A filter needs the whole portfolio — still the fast path, every page, no transcripts.
{
  const { env, calls } = portfolio('fast')
  const r = await executeTool('vemotion_list_audio', { userEmail: EMAIL, vemotionOnly: true, limit: 200 }, env)
  const expected = usable.filter((x) => x.tags.includes('vemotion')).length
  check('vemotionOnly: all of them found across pages', r.total === expected && r.count === expected, `total ${r.total}, expected ${expected}`)
  check('vemotionOnly: fast light pages only', calls.length === 2 && calls.every((c) => c.fast && c.light), JSON.stringify(calls))
  const byName = await executeTool('vemotion_list_audio', { userEmail: EMAIL, query: 'song 255' }, env)
  check('query: a recording on the last page is found', byName.count === 1 && byName.recordings[0].name === 'Song 255', JSON.stringify(byName.recordings))
}

// 5. A portfolio worker without the fast path: the legacy listing still answers, newest first.
{
  const { env, calls } = portfolio('legacy-only')
  const r = await executeTool('vemotion_list_audio', { userEmail: EMAIL, limit: 3 }, env)
  check('no fast path: falls back to the legacy listing', calls.some((c) => !c.fast && c.cursor), JSON.stringify(calls.slice(0, 4)))
  check('no fast path: still the newest usable first', JSON.stringify(r.recordings.map((x) => x.name)) === JSON.stringify(usable.slice(0, 3).map((x) => x.displayName)), JSON.stringify(r.recordings.map((x) => x.name)))
}

// 6. The fast path sees nothing (keys under another spelling of the e-mail): legacy finds them.
{
  const { env } = portfolio('empty-fast')
  const r = await executeTool('vemotion_list_audio', { userEmail: EMAIL, limit: 2 }, env)
  check('fast path empty: legacy fallback finds the recordings', r.count === 2 && r.recordings[0].name === usable[0].displayName, JSON.stringify(r))
}

// 7. list_recordings keeps the transcript (it searches and previews it) and uses the fast path.
{
  const { env, calls } = portfolio('fast')
  const r = await executeTool('list_recordings', { userEmail: EMAIL, limit: 5 }, env)
  const own = calls.filter((c) => c.owner === EMAIL)
  check('list_recordings: fast path with full records', own.length > 0 && own.every((c) => c.fast && !c.light), JSON.stringify(own))
  const list = r.recordings || []
  check('list_recordings: newest first, with transcript state', list.length === 5 && list[0]?.recordingId === ALL[0].recordingId && list[0]?.hasTranscription === true, JSON.stringify(list.slice(0, 2)))
  const found = await executeTool('list_recordings', { userEmail: EMAIL, query: 'transcript 259' }, env)
  check('list_recordings: transcript text is still searchable', (found.recordings || []).some((x) => x.recordingId === ALL[259].recordingId), JSON.stringify((found.recordings || []).map((x) => x.recordingId)))
}

fs.unlinkSync(path.join(tmp, 'node_modules'))
fs.rmSync(tmp, { recursive: true, force: true })
if (failures) { console.error(`\n${failures} failure(s)`); process.exit(1) }
console.log('\nAll portfolio fast-list checks passed.')
