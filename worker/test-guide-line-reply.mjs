// The agent's reply ends with every "Guide: <step> — <url>" line its tools returned. The model is
// told to repeat it (system-prompt.js); the loop appends any it still left out (agent-loop.js).
//
// Run:  node worker/test-guide-line-reply.mjs   (exit 0 = pass, 1 = fail)
import fs from 'fs'
import { collectGuideLines, missingGuideText } from './agent-loop.js'

let failures = 0
const check = (name, cond, detail = '') => {
  if (cond) console.log(`ok    ${name}`)
  else { failures++; console.error(`FAIL  ${name}\n      ${detail}`) }
}
const GURL = 'https://www.vegvisr.org/gnew-viewer?graphId=b7f3a1d0-9c52-4e18-a6b4-3f5d8e2c7a91'
const LINE = `Guide: 10 · Verifiser hele kjeden — ${GURL}`

const g = []
collectGuideLines(`sodesign.no: 2 of 2 host(s) serve a published page.\n  me.sodesign.no — ok\n${LINE}`, g)
check('a guide line in a message is collected', g.length === 1 && g[0].url === GURL, JSON.stringify(g))
collectGuideLines(`again\n${LINE}`, g)
check('the same line is collected once', g.length === 1)
collectGuideLines('No user context available', g)
collectGuideLines(undefined, g)
check('text without a guide adds nothing', g.length === 1)
check('a host line with an em dash is not taken for a guide', !g.some(x => x.line.includes('me.sodesign.no')))

check('a reply that left it out gets it appended', missingGuideText('**READY** — both hosts serve.', g) === `\n\n${LINE}`)
check('a reply that already has the link gets nothing', missingGuideText(`Done.\n${LINE}`, g) === '')
check('no guides, nothing appended', missingGuideText('anything', []) === '')

const g2 = [...g]
const LINE15 = `Guide: 15 · Bilder, video og PDF på cdn.<domene> — ${GURL}`
collectGuideLines(`Photo storage ready.\n${LINE15}`, g2)
check('two steps sharing one link are both collected', g2.length === 2, JSON.stringify(g2))
check('two steps, only the missing one is appended', missingGuideText(`Done.\n${LINE}`, g2) === `\n\n${LINE15}`, JSON.stringify(missingGuideText(`Done.\n${LINE}`, g2)))
check('the bare link alone does not count as the line', missingGuideText(`see ${GURL}`, g) === `\n\n${LINE}`)

const loop = fs.readFileSync(new URL('./agent-loop.js', import.meta.url), 'utf8')
check('both loops collect from tool results', (loop.match(/collectGuideLines\(result\?\.message, guideLines\)/g) || []).length === 2)
check('both loops collect from thrown errors', (loop.match(/collectGuideLines\(error\.message, guideLines\)/g) || []).length === 2)
check('both loops append at the end of the reply', (loop.match(/missingGuideText\(/g) || []).length === 3)
const prompt = fs.readFileSync(new URL('./system-prompt.js', import.meta.url), 'utf8')
check('the system prompt tells the model to repeat it', /starting \\`Guide: \\`[^\n]*VERBATIM/.test(prompt))

console.log(failures ? `\n${failures} FAILED` : '\nPASS — the reply ends with the guide line its tools returned.')
process.exit(failures ? 1 : 0)
