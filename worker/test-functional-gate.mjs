// Funksjonsporten (detectFunctionalGaps) — 2026-10-28.
// En publisering av Lipi utløste «Fix each on the node» for to feil som ikke fantes:
// temabryteren var koblet med dataset.theme + $('#themeBtn').onclick, og skriften var brukt
// gjennom en CSS-variabel. Agenten la inn en temabryter til, og knappen sluttet å virke.
// Mønstrene under må gi null funn, og de ekte døde tilfellene må fortsatt fanges.
import { detectFunctionalGaps } from './html-builder-subagent.js'

let failed = 0
function check(name, html, expect) {
  const gaps = detectFunctionalGaps(html)
  const theme = gaps.some(g => g.startsWith('Theme toggle'))
  const font = gaps.some(g => g.startsWith('Google font'))
  const ok = theme === expect.theme && font === expect.font
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name} — theme gap: ${theme}, font gap: ${font}`)
}

const FONT = '<link href="https://fonts.googleapis.com/css2?family=Source+Sans+3:wght@400;600&display=swap" rel="stylesheet">'
const THEME_CSS = ':root[data-theme="light"]{--bg:#fff}'

// Lipi: dataset.theme + $() helper + .onclick; font via --sans variable.
check('Lipi-mønster (dataset.theme, $().onclick, font via var)', `<style>:root{--sans:'Source Sans 3', system-ui, sans-serif}${THEME_CSS}
body{font-family:var(--sans)}</style>${FONT}<button class="iconbtn" id="themeBtn">◐</button>
<script>const $=s=>document.querySelector(s);
$('#themeBtn').onclick=()=>{const r=document.documentElement;r.dataset.theme=r.dataset.theme==='dark'?'light':'dark';};</script>`,
  { theme: false, font: false })

// Klassisk mønster som allerede var godkjent.
check('setAttribute + addEventListener + direkte font-family', `<style>${THEME_CSS}body{font-family:'Source Sans 3',sans-serif}</style>${FONT}
<button id="themeToggle">t</button><script>document.getElementById('themeToggle').addEventListener('click',()=>{document.documentElement.setAttribute('data-theme','dark')})</script>`,
  { theme: false, font: false })

// font-skrivemåten (shorthand).
check('font-shorthand', `<style>body{font:16px/1.5 'Source Sans 3',sans-serif}</style>${FONT}`, { theme: false, font: false })

// Ekte døde tilfeller — må fortsatt fanges.
check('død bryter: knapp + CSS, ingen JS', `<style>${THEME_CSS}</style><button id="themeBtn">◐</button>`, { theme: true, font: false })
check('død bryter: dataset.theme settes, men ingen klikk-kobling', `<style>${THEME_CSS}</style><button id="themeBtn">◐</button><script>document.documentElement.dataset.theme='dark'</script>`, { theme: true, font: false })
check('font lastet, aldri brukt', `${FONT}<style>body{font-family:Arial}</style>`, { theme: false, font: true })
check('font i variabel som ingen bruker', `${FONT}<style>:root{--sans:'Source Sans 3',sans-serif}body{font-family:Arial}</style>`, { theme: false, font: true })

// Den ekte Lipi-fila, hvis den finnes på maskinen.
import fs from 'fs'
import os from 'os'
const lipi = `${os.homedir()}/Downloads/lipi-v40.html`
if (fs.existsSync(lipi)) check('lipi-v40.html (ekte side)', fs.readFileSync(lipi, 'utf8'), { theme: false, font: false })

if (failed) { console.error(`${failed} failed`); process.exit(1) }
console.log('all passed')
