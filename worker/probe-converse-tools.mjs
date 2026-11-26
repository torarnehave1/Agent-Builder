// Live probe of /converse tool finding (2026-11-26). Not part of `npm test`: it calls the deployed
// agent-worker and the real model, and costs a few cents. Run after any change to how /converse
// gives the model its tools:
//
//   VEGR_TOKEN=<emailVerificationToken> node probe-converse-tools.mjs [model]
//
// Each case asks for a graph edit in plain words and checks that the model LOADED the right tool
// through the tool search. Nothing is written: the prompts say not to call the tool, and the chat
// asks before any change anyway. The failure this guards against: the BM25 search missed
// update_node / reorder_nodes / remove_node and the model said the tools did not exist.
const URL = process.env.CONVERSE_URL || 'https://agent.vegvisr.org/converse'
const token = process.env.VEGR_TOKEN
if (!token) { console.error('Set VEGR_TOKEN to your emailVerificationToken.'); process.exit(2) }
const model = process.argv[2] || 'claude-haiku-5-5'

const G = '509538a1-c24f-44cd-8dce-dbb03982c090'
const ASK = 'Do not change anything and do not call the tool. Only load the tool you would use, and tell me its name.'
const CASES = [
  { expect: 'reorder_nodes', prompt: `Flytt noden header-infographic øverst i grafen ${G}. ${ASK}` },
  { expect: 'update_node', prompt: `Change the label of node summary in graph ${G} to "Summary". ${ASK}` },
  { expect: 'remove_node', prompt: `Delete the node header-infographic from graph ${G}. ${ASK}` },
  { expect: 'add_edge', prompt: `Connect node summary to node method with an edge in graph ${G}. ${ASK}` },
  { expect: 'send_sms', prompt: `Send an SMS to +4700000000 saying hello. ${ASK}` },
]

async function run(c) {
  const r = await fetch(URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: `probe-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, authToken: token, model, message: c.prompt, seeded: false }),
  })
  if (!r.ok || !r.body) return { ok: false, why: `HTTP ${r.status}: ${(await r.text()).slice(0, 200)}` }
  const text = await r.text()
  const loaded = new Set()
  const searches = []
  let answer = ''
  let error = ''
  for (const block of text.split('\n\n')) {
    let name = 'message', data = ''
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) name = line.slice(6).trim()
      else if (line.startsWith('data:')) data += line.slice(5).trim()
    }
    let d = {}
    try { d = data ? JSON.parse(data) : {} } catch { continue }
    if (name === 'tool_call' && d.tool === 'tool_search') searches.push(JSON.stringify(d.input))
    if (name === 'tool_result' && d.tool === 'tool_search') for (const n of String(d.summary || '').split(/,\s*/)) if (n) loaded.add(n.replace(/^vegr_/, ''))
    if (name === 'tool_call' && d.tool !== 'tool_search') loaded.add(String(d.tool).replace(/^vegr_/, ''))
    if (name === 'delta') answer += d.text || ''
    if (name === 'error') error = d.error
  }
  const ok = loaded.has(c.expect)
  return { ok, why: ok ? '' : (error || `loaded: ${[...loaded].join(', ') || 'nothing'}`), searches, answer: answer.slice(0, 160).replace(/\s+/g, ' ') }
}

let failed = 0
for (const c of CASES) {
  const res = await run(c)
  if (!res.ok) failed++
  console.log(`${res.ok ? 'PASS' : 'FAIL'}  ${c.expect.padEnd(14)} searches: ${(res.searches || []).join(' | ') || '-'}${res.ok ? '' : `\n      ${res.why}`}\n      answer: ${res.answer || '-'}`)
}
console.log(`\n${CASES.length - failed}/${CASES.length} passed (${model})`)
process.exit(failed ? 1 : 0)
