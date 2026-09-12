// The model gateway's non-JSON answers must never reach the user as a parser error (2026-09-12).
// Run: node worker/test-model-response.mjs
import { readModelResponse } from './model-response.js'

let failed = 0
const check = (label, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : '\n      ' + detail}`); if (!ok) failed++ }
const fake = (status, body) => ({ status, text: async () => body })

const ok = await readModelResponse(fake(200, JSON.stringify({ content: [{ type: 'text', text: 'hi' }] })))
check('valid JSON passes through', ok.content?.[0]?.text === 'hi')

const t524 = await readModelResponse(fake(524, 'error code: 524'))
check('a 524 becomes a readable timeout message', t524.error?.type === 'edge_timeout' && /timed out at the edge/i.test(t524.error.message), JSON.stringify(t524))
check('the timeout message names the cause and the fix', /too much text/i.test(t524.error.message) && /delegate_to_kg|save_transcript_to_graph/.test(t524.error.message))
check('no parser wording reaches the user', !/is not valid JSON|Unexpected token/i.test(JSON.stringify(t524)))

const html = await readModelResponse(fake(502, '<html><body>Bad gateway</body></html>'))
check('other non-JSON bodies are reported with status + excerpt', html.error?.type === 'non_json_response' && /HTTP 502/.test(html.error.message), JSON.stringify(html))

const empty = await readModelResponse(fake(500, ''))
check('an empty body is stated as empty', /\(empty body\)/.test(empty.error?.message || ''), JSON.stringify(empty))

console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll model-response checks passed.')
process.exit(failed ? 1 : 0)
