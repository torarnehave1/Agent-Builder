// graph-portfolio's pure parts, extracted from the REAL component source so the test can
// never drift from what is served. Three things this guards, all of them verified against
// live data on 2026-09-12:
//  1. The endpoint's metaArea filter takes ONE term per call ("NIBI,BLOGG" matches zero
//     rows), so several areas mean several requests merged by id — a graph tagged with two
//     of them must appear once, not twice.
//  2. The anonymous gate is `publicationState = 'published' OR seoSlug IS NOT NULL`, and a
//     draft saved with seoSlug "" passes it: 134 of 211 anonymous rows are drafts. The
//     component keeps only rows whose metadata says published.
//  3. Area strings can contain spaces ("BUSINESS DEVELOPMENT"), so areas split on comma and
//     '#' only. Splitting on whitespace shatters that area into two that match nothing.
//
// Run:  node worker/test-graph-portfolio.mjs   (exit 0 = pass, 1 = fail)

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const dir = path.dirname(fileURLToPath(import.meta.url))
const src = fs.readFileSync(path.join(dir, 'components/graph-portfolio.js'), 'utf8')

// The helpers live at two-space indent inside the component's IIFE (it must not leak
// globals onto a customer page), so split on that rather than on column-zero functions.
const parts = {}
for (const part of src.split(/\n(?=  function\s)/)) {
  const nm = part.match(/^\s*function\s+(\w+)\s*\(/)
  if (nm) parts[nm[1]] = part
}
const need = [
  'parseAreas', 'graphAreas', 'matchesArea', 'isPublished', 'visibleRows', 'mergeById',
  'sortRows', 'hueFor', 'initialsFor', 'summarize', 'fmtDate', 'cardData', 'limitRows',
  'visibleNodes', 'nodeRenderPlan', 'isUnsafeUrl', 'sameHeading',
]
for (const n of need) {
  if (!parts[n]) { console.error(`FAIL: function ${n} not found in components/graph-portfolio.js`); process.exit(1) }
}
const consts = src.match(/^\s*var (VIEWER|DESC_MAX) = .*$/gm) || []
if (consts.length !== 2) { console.error('FAIL: VIEWER/DESC_MAX consts not found'); process.exit(1) }
const api = new Function(`${consts.join('\n')}\n${need.map(n => parts[n]).join('\n')}\nreturn { ${need.join(', ')} }`)()

let failed = 0
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : `\n      ${detail}`}`)
  if (!ok) failed += 1
}

const row = (id, over = {}) => ({
  id,
  title: over.title || `Graph ${id}`,
  updatedAt: over.updatedAt || '2026-09-01T10:00:00.000Z',
  nodeCount: over.nodeCount === undefined ? 5 : over.nodeCount,
  portfolioImagePath: over.image || null,
  metadata: {
    title: over.title || `Graph ${id}`,
    description: over.description === undefined ? 'A description.' : over.description,
    metaArea: over.metaArea === undefined ? '#NIBI' : over.metaArea,
    publicationState: over.state === undefined ? 'published' : over.state,
    seoSlug: over.seoSlug === undefined ? '' : over.seoSlug,
  },
})

// 1. Area parsing — the real shapes seen in the data.
check('splits "#VEGR.AI #BLOGG #KUNNSKAPSLEDELSE"',
  JSON.stringify(api.parseAreas('#VEGR.AI #BLOGG #KUNNSKAPSLEDELSE')) === JSON.stringify(['VEGR.AI', 'BLOGG', 'KUNNSKAPSLEDELSE']),
  JSON.stringify(api.parseAreas('#VEGR.AI #BLOGG #KUNNSKAPSLEDELSE')))
check('an area containing a space survives intact',
  JSON.stringify(api.parseAreas('BUSINESS DEVELOPMENT, NIBI')) === JSON.stringify(['BUSINESS DEVELOPMENT', 'NIBI']),
  JSON.stringify(api.parseAreas('BUSINESS DEVELOPMENT, NIBI')))
check('author input is trimmed, upper-cased and de-duplicated',
  JSON.stringify(api.parseAreas(' nibi , NIBI,  blogg ')) === JSON.stringify(['NIBI', 'BLOGG']),
  JSON.stringify(api.parseAreas(' nibi , NIBI,  blogg ')))
check('empty / null input yields no areas (= every published graph)',
  api.parseAreas('').length === 0 && api.parseAreas(null).length === 0)

// 2. Matching mirrors the server's LIKE, so a chip cannot hide a card the server returned.
check('exact area matches', api.matchesArea(row('a', { metaArea: '#NIBI #PROFF' }), 'NIBI'))
check('substring area matches like the server LIKE does (AI inside VEGR.AI)',
  api.matchesArea(row('a', { metaArea: '#VEGR.AI' }), 'AI'))
check('an unrelated area does not match', !api.matchesArea(row('a', { metaArea: '#NIBI' }), 'BLOGG'))
check('a row with no metaArea matches nothing', !api.matchesArea(row('a', { metaArea: '' }), 'NIBI'))

// 3. The draft leak: metadata decides, not the endpoint.
check('published row is kept', api.isPublished(row('a')))
check('draft with seoSlug "" is DROPPED (the 134-row leak)',
  !api.isPublished(row('a', { state: 'draft', seoSlug: '' })))
check('row with no publicationState is dropped', !api.isPublished(row('a', { state: null })))

// 3b. data-include is the deliberate opt-in to the API's looser idea of public.
const mixed = [row('p'), row('d', { state: 'draft' })]
check('default keeps only the published row', api.visibleRows(mixed, 'published').length === 1)
check('an omitted data-include defaults to strict', api.visibleRows(mixed, '').length === 1)
check('data-include="public" keeps drafts too', api.visibleRows(mixed, 'public').length === 2)
check('visibleRows does not mutate its input', mixed.length === 2)

// 4. Merge by id — a graph in two requested areas appears once.
const inNibi = [row('x', { metaArea: '#NIBI #BLOGG' }), row('y')]
const inBlogg = [row('x', { metaArea: '#NIBI #BLOGG' }), row('z')]
const merged = api.mergeById([inNibi, inBlogg])
check('two area result sets merge to 3 unique graphs, not 4', merged.length === 3,
  merged.map(r => r.id).join(','))
check('merge preserves first-seen order', merged.map(r => r.id).join(',') === 'x,y,z')
check('merge tolerates an empty / missing list', api.mergeById([[], null, [row('q')]]).length === 1)

// 5. Sorting.
const unsorted = [
  row('a', { title: 'Beta', updatedAt: '2026-01-01T00:00:00.000Z', nodeCount: 9 }),
  row('b', { title: 'Alfa', updatedAt: '2026-09-01T00:00:00.000Z', nodeCount: 2 }),
]
check('default sort is newest updated first', api.sortRows(unsorted, 'updated')[0].id === 'b')
check('title sort is alphabetical', api.sortRows(unsorted, 'title')[0].title === 'Alfa')
check('nodes sort is largest first', api.sortRows(unsorted, 'nodes')[0].nodeCount === 9)
check('sortRows does not mutate its input', unsorted[0].id === 'a')

// 6. Card mapping.
const card = api.cardData(row('abc-123', { title: 'Hva ligger i sentrum?', metaArea: '#VEGR.AI #BLOGG' }), { lang: 'no' })
check('card links to the gnew viewer with an encoded id',
  card.href === 'https://www.vegvisr.org/gnew-viewer?graphId=abc-123', card.href)
check('card carries the row areas', JSON.stringify(card.areas) === JSON.stringify(['VEGR.AI', 'BLOGG']))
check('initials come from the first two words', card.initials === 'HL', card.initials)
check('hue is stable for the same id', api.hueFor('abc-123') === api.hueFor('abc-123'))
check('hue stays inside 0-359', api.hueFor('abc-123') >= 0 && api.hueFor('abc-123') < 360)
check('different ids generally get different hues', api.hueFor('abc-123') !== api.hueFor('zzz-999'))
check('a one-word title still yields initials', api.initialsFor('Systemkart') === 'SY')
check('an empty title does not crash the tile', api.initialsFor('') === '•')

// 7. Description clamping — p50 of real descriptions is 422 chars, so this always fires.
const long = 'x'.repeat(500)
check('long description is clamped and ellipsised', api.summarize(long, 180).length <= 181 && api.summarize(long, 180).endsWith('…'))
check('short description is left alone', api.summarize('Kort.', 180) === 'Kort.')
check('clamp breaks on a word boundary where there is one',
  api.summarize('alpha beta gamma delta epsilon zeta', 20).indexOf('…') > 0 &&
  !/\s…$/.test(api.summarize('alpha beta gamma delta epsilon zeta', 20)))
check('missing description yields an empty string, not "undefined"', api.summarize(undefined, 180) === '')

// 8. Dates and limit.
check('a real ISO date formats without throwing', api.fmtDate('2026-09-12T19:00:45.227Z', 'no').length > 0)
check('a missing date yields an empty string', api.fmtDate(null, 'no') === '')
check('a malformed date yields an empty string', api.fmtDate('not-a-date', 'no') === '')
check('limit 0 keeps every row', api.limitRows([1, 2, 3], 0).length === 3)
check('limit 2 keeps two rows', api.limitRows([1, 2, 3], 2).length === 2)

// 9. The dialog's node mapping. A card must open ON the embedding site, so these decide
// what actually reaches the reader without a trip to vegvisr.org.
check('a hidden node is left out', api.visibleNodes({ nodes: [{ id: 'a', visible: false }, { id: 'b', visible: true }] }).length === 1)
check('a node with no visible flag is shown', api.visibleNodes({ nodes: [{ id: 'a' }] }).length === 1)
check('a graph with no nodes yields none', api.visibleNodes({}).length === 0 && api.visibleNodes(null).length === 0)

check('a fulltext node renders as markdown',
  api.nodeRenderPlan({ type: 'fulltext', info: '## Hei\ntekst' }).kind === 'markdown')
check('a mermaid node is a diagram, not prose',
  api.nodeRenderPlan({ type: 'mermaid-diagram', info: 'quadrantChart\n title x' }).kind === 'mermaid')
check('an empty mermaid node is skipped',
  api.nodeRenderPlan({ type: 'mermaid-diagram', info: '  ' }).kind === 'skip')
check('a markdown-image renders from its LABEL, not info',
  (p => p.kind === 'markdown' && p.text.indexOf('![') === 0)(
    api.nodeRenderPlan({ type: 'markdown-image', label: '![Header](https://x/y.png)', info: '' })))
check('a markdown-image with no markdown in the label is skipped',
  api.nodeRenderPlan({ type: 'markdown-image', label: 'just a name' }).kind === 'skip')
check('a css-node never reaches the reader', api.nodeRenderPlan({ type: 'css-node', info: 'body{}' }).kind === 'skip')
check('an unknown type with content still renders rather than vanishing',
  api.nodeRenderPlan({ type: 'something-new', info: 'real content' }).kind === 'markdown')
check('a node with no content is skipped', api.nodeRenderPlan({ type: 'fulltext', info: '   ' }).kind === 'skip')

// 10. The scrub's pure half. A meta area can hold graphs written by other accounts, and
// this grid renders them on somebody else's site.
check('javascript: url is unsafe', api.isUnsafeUrl('javascript:alert(1)'))
check('JavaScript: in mixed case is unsafe', api.isUnsafeUrl('JaVaScRiPt:alert(1)'))
check('a url hiding behind whitespace/control chars is unsafe',
  api.isUnsafeUrl(' java\tscript:alert(1)') && api.isUnsafeUrl('java\nscript:alert(1)'))
check('data:text/html is unsafe', api.isUnsafeUrl('data:text/html;base64,PHNjcmlwdD4='))
check('vbscript: is unsafe', api.isUnsafeUrl('vbscript:msgbox'))
check('an ordinary https link is safe', !api.isUnsafeUrl('https://vegvisr.org/a/b?c=d'))
check('a relative link is safe', !api.isUnsafeUrl('/photos/1.png'))
check('a data: image is safe', !api.isUnsafeUrl('data:image/png;base64,iVBOR'))
check('a mailto link is safe', !api.isUnsafeUrl('mailto:post@vegvisr.org'))
check('empty / null is safe', !api.isUnsafeUrl('') && !api.isUnsafeUrl(null))

// 11. The dialog bar shows the graph title and the first node usually repeats it.
check('an identical heading is recognised', api.sameHeading('Hva ligger i sentrum?', 'Hva ligger i sentrum?'))
check('case and spacing differences still match', api.sameHeading('  HVA   ligger i Sentrum? ', 'Hva ligger i sentrum?'))
check('trailing punctuation is ignored', api.sameHeading('De to aksene —', 'De to aksene'))
check('a genuinely different heading is kept', !api.sameHeading('Om Tor Arne Håve', 'Hva ligger i sentrum?'))
check('an empty heading never counts as a duplicate', !api.sameHeading('', '') && !api.sameHeading('   ', 'Title'))

console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll checks passed.')
process.exit(failed ? 1 : 0)
