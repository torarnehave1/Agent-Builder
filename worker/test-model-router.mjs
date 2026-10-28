// Automatisk modellvalg (model-router.js) — 2026-10-28.
import { modelForTier, parseTier, isRoutable, routeModel } from './model-router.js'
import { acceptsSampling } from './models.js'

let failed = 0
const eq = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ` — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`) }

// Valgt modell er taket
eq('auto: enkel → Haiku 5.5', modelForTier('simple', 'auto'), 'claude-haiku-5-5')
eq('auto: kompleks → Sonnet 5.5', modelForTier('complex', 'auto'), 'claude-sonnet-5-5')
eq('Opus 5.5 valgt: kompleks → Opus 5.5', modelForTier('complex', 'claude-opus-5-5'), 'claude-opus-5-5')
eq('Opus 5.5 valgt: enkel → Haiku 5.5', modelForTier('simple', 'claude-opus-5-5'), 'claude-haiku-5-5')
eq('Haiku 4.5 valgt: kompleks → Haiku 4.5 (aldri over taket)', modelForTier('complex', 'claude-haiku-4-5-20251001'), 'claude-haiku-4-5-20251001')

// Hvem rutes
eq('auto rutes', isRoutable('auto'), true)
eq('Claude-modell rutes', isRoutable('claude-sonnet-5-5'), true)
eq('OpenAI rutes ikke', isRoutable('openai/gpt-5.6-sol'), false)
eq('Workers AI rutes ikke', isRoutable('@cf/meta/llama-4-scout-17b-16e-instruct'), false)
eq('tom modell (andre klienter) rutes ikke', isRoutable(undefined), false)

// Tolking av klassifiseringen
eq('gyldig JSON', parseTier('{"tier":"simple","reason":"publish as-is"}'), { tier: 'simple', reason: 'publish as-is' })
eq('JSON i tekst', parseTier('Sure: {"tier":"complex","reason":"edit CSS"} done'), { tier: 'complex', reason: 'edit CSS' })
eq('ukjent tier → null', parseTier('{"tier":"medium"}'), null)
eq('ikke JSON → null', parseTier('complex'), null)

// temperature bare for eldre modeller
eq('Haiku 4.5 tar temperature', acceptsSampling('claude-haiku-4-5-20251001'), true)
eq('Sonnet 5.5 tar ikke temperature', acceptsSampling('claude-sonnet-5-5'), false)
eq('Haiku 5.5 tar ikke temperature', acceptsSampling('claude-haiku-5-5'), false)

// routeModel med falsk ANTHROPIC-binding
const envWith = (reply, status = 200) => ({ ANTHROPIC: { fetch: async (_u, init) => {
  envWith.last = JSON.parse(init.body)
  return new Response(JSON.stringify({ content: [{ type: 'text', text: reply }] }), { status })
} } })
const pub = 'Publiser html-noden lipi-placeholder til lipi.vegr.ai med gate true.\n\n[Current UI context: graphId="27afae70", activeHtmlNodeId="lipi-placeholder"]'
let r = await routeModel(envWith('{"tier":"simple","reason":"publish as-is"}'), { userId: 'u', selected: 'auto', requestText: pub, hasActiveHtml: true })
eq('publisering → Haiku 5.5 via klassifisering', [r.model, r.tier, r.via], ['claude-haiku-5-5', 'simple', 'classifier'])
eq('UI-kontekst fjernes før klassifisering', envWith.last.messages[0].content.includes('Current UI context'), false)
eq('klassifiseringen bruker Haiku 4.5', envWith.last.model, 'claude-haiku-4-5-20251001')
r = await routeModel(envWith('oops', 500), { userId: 'u', selected: 'auto', requestText: 'fiks temaknappen', hasActiveHtml: true })
eq('feil i klassifiseringen → sterk modell', [r.model, r.via], ['claude-sonnet-5-5', 'fallback'])
r = await routeModel(envWith('not json'), { userId: 'u', selected: 'auto', requestText: 'x' })
eq('ubrukelig svar → sterk modell', [r.model, r.via], ['claude-sonnet-5-5', 'fallback'])
r = await routeModel({ ANTHROPIC: { fetch: async () => { throw new Error('should not be called') } } }, { userId: 'u', selected: 'claude-haiku-4-5-20251001', requestText: 'x' })
eq('Haiku valgt → ingen klassifisering', [r.model, r.via], ['claude-haiku-4-5-20251001', 'ceiling'])

if (failed) { console.error(`${failed} failed`); process.exit(1) }
console.log('all passed')
