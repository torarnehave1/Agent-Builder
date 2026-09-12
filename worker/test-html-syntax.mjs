// The html-node syntax check must not invent errors. On 2026-09-11 it reported one on EVERY script
// ("Code generation from strings disallowed" — Cloudflare Workers forbid new Function) and on every
// regex character class ("Mismatched '}'"). A live agent run believed it, hunted a syntax error that
// did not exist, and rolled the node back to a version from before it had installed the verified
// component. Run: node worker/test-html-syntax.mjs   (exit 0 = pass)

import { scanHtmlSyntax, scanScript, ownedBlockRanges } from './html-syntax.js'

let failed = 0
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : `\n      ${detail}`}`)
  if (!ok) failed += 1
}

const page = body => `<!DOCTYPE html>\n<html>\n<head><style>:root{--a:1}</style></head>\n<body>\n${body}\n</body>\n</html>`

// 1. The real patterns that were falsely flagged.
const regexHeavy = page(`<script>
(function () {
  var esc = function (v) { return String(v).replace(/[-\\/\\\\^$*+?.()|[\\]{}]/g, '\\\\$&') };
  var re = new RegExp('<' + 'style\\\\b[^>]*>[\\\\s\\\\S]*?<' + '/style>', 'gi');
  var CLOSE = '<' + '/head>';
  var ratio = 10 / 2;
  var url = 'https://x.example/a/b';
  console.log(esc, re, CLOSE, ratio, url);
})();
</script>`)
const r1 = scanHtmlSyntax(regexHeavy)
check('a regex character class is not a bracket error', r1.valid, JSON.stringify(r1.issues))
check('division and urls are not regex literals', r1.scriptBlocks === 1)

// 2. A genuinely broken script is still caught.
const broken = page(`<script>
function halfDone() {
  if (true) {
    console.log('x');
</script>`)
const r2 = scanHtmlSyntax(broken)
check('a real unclosed brace IS reported', !r2.valid && r2.issues.some(i => i.type === 'unclosed'), JSON.stringify(r2.issues))

// 3. Scripts inside a registry component block are not scanned or repaired.
const ownedBroken = page(`<!-- vegvisr-component:theme-picker:start -->
<script data-component="theme-picker">
(function () { var x = { a: 1 ; })();
</script>
<!-- vegvisr-component:theme-picker:end -->
<script>console.log('page script');</script>`)
const r3 = scanHtmlSyntax(ownedBroken)
check('a registry component block is skipped', r3.skippedOwnedBlocks === 1 && r3.scriptBlocks === 1, JSON.stringify(r3))
check('skipping is explained in the message', /registry component block/.test(r3.message))
check('ownedBlockRanges finds the block', ownedBlockRanges(ownedBroken).map(r => r.name).join() === 'theme-picker')

// 4. Strings, template literals and comments.
const trickyStrings = page(`<script>
const a = "a // not a comment";
const b = 'it\\'s fine';
const c = \`template \${1 + 1} with } brace\`;
/* block } comment */
// line } comment
console.log(a, b, c);
</script>`)
check('strings, templates and comments do not confuse the scan', scanHtmlSyntax(trickyStrings).valid, JSON.stringify(scanHtmlSyntax(trickyStrings).issues))

// 5. External scripts have no body to scan.
const ext = page('<script src="https://api.vegvisr.org/components/vegvisr-auth.js"></script>')
const r5 = scanHtmlSyntax(ext)
check('<script src> is counted, not scanned', r5.valid && r5.externalScripts === 1 && r5.scriptBlocks === 0, JSON.stringify(r5))

// 6. The parser check must never report the runtime's own eval ban as a page error.
const r6 = scanScript('var ok = 1;', 1)
check('parser check reports ok or unavailable, never an eval error', r6.issues.length === 0 && ['ok', 'unavailable'].includes(r6.parser), JSON.stringify(r6))
check('no issue text mentions code generation', !JSON.stringify([r1, r2, r3, r5, r6]).includes('Code generation from strings'))

console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll html-syntax checks passed.')
process.exit(failed ? 1 : 0)
