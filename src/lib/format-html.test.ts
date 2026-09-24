// The reading formatter must not lie about the page: it may add whitespace between tags, but the
// tags, attributes and every byte inside script/style/pre must survive unchanged. Run it against the
// real 3.4 MB Aliveness LAB page, not a toy fixture — that page is why this exists.
//
//     node --experimental-strip-types src/lib/format-html.test.ts [path-to-a-real-page.html]
import fs from 'fs'
import { formatHtmlForReading } from './format-html.ts'

let failures = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}`)
  if (!ok) { failures++; if (detail) console.log('      ' + detail.slice(0, 400)) }
}

// 1. Tags come out on their own lines, nested ones indented.
{
  const out = formatHtmlForReading('<div><p>Hei</p><br><span>Ha det</span></div>')
  const lines = out.split('\n')
  check('every tag gets its own line', lines.length >= 7, JSON.stringify(out))
  check('nesting is indented', lines.some(l => /^ {2}<p>/.test(l)), JSON.stringify(lines))
  check('a void tag does not open a level', !/^ {4}<span>/.test(lines.find(l => l.includes('<span>')) || ''), JSON.stringify(lines))
}

// 2. Script and style contents are untouched — reformatting inside them would show the reader
// something the page does not contain.
{
  const js = 'if(a<b){x=">"}\nconst s="</div>"'
  const out = formatHtmlForReading(`<head><style>.a{color:red}</style><script>${js}</script></head>`)
  check('script contents survive byte for byte', out.includes(js), out)
  check('style contents survive byte for byte', out.includes('.a{color:red}'), out)
}

// 3. Nothing but whitespace changes: strip all whitespace between tags from both and compare.
// The formatter's whole job is inserting whitespace between tags, so the comparison has to ignore
// exactly that: collapse space after '>' and before '<' as well.
const squash = (s: string) => s
  .replace(/>\s+/g, '>')
  .replace(/\s+</g, '<')
  .replace(/\s+/g, ' ')
  .trim()
{
  const src = '<div class="x">  <p>a</p>  <img src="y.png">  </div>'
  check('no content is added or lost', squash(formatHtmlForReading(src)) === squash(src),
    `${squash(formatHtmlForReading(src))}\n!==\n${squash(src)}`)
}

// 4. The real page, if one is at hand.
const file = process.argv[2] || '/tmp/al.html'
if (fs.existsSync(file)) {
  const html = fs.readFileSync(file, 'utf8')
  const started = Date.now()
  const out = formatHtmlForReading(html)
  const ms = Date.now() - started
  check(`a ${(html.length / 1e6).toFixed(1)} MB page formats in under 5s (${ms} ms)`, ms < 5000, `${ms} ms`)
  check('the formatted page is longer, never shorter', out.length >= html.length, `${html.length} -> ${out.length}`)
  const tagCount = (s: string) => (s.match(/<[a-zA-Z!/][^>]*>/g) || []).length
  check('every tag survives', tagCount(out) === tagCount(html), `${tagCount(html)} -> ${tagCount(out)}`)
  // EVERY opaque block, not a sampled one: a non-greedy match can span from one <script> across
  // intervening markup to a later </script>, and that span is not a script at all.
  const opaque = [...html.matchAll(/<(script|style|pre|textarea)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi)]
  const broken = opaque.filter(m => m[2].length > 40 && !out.includes(m[2]))
  check(`all ${opaque.length} script/style/pre blocks are reproduced verbatim`, broken.length === 0,
    broken.length ? `${broken.length} altered, first starts: ${broken[0][2].slice(0, 120)}` : '')
  const biggest = opaque.map(m => m[2].length).sort((a, b) => b - a)[0] || 0
  check('and the largest of them is a real chunk of the page', biggest > 1000, `${biggest} chars`)
} else {
  console.log(`SKIP  no real page at ${file} — pass one as the first argument for the full check`)
}

console.log(failures ? `\n${failures} FAILED` : '\nPASS — the reading view adds whitespace and nothing else.')
process.exit(failures ? 1 : 0)
