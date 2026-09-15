// Regression guard: World login email template without pasted HTML, accent from the logo, caller gate (2026-09-15).
//
// Setting nibi.no's login email meant pasting a prompt full of HTML into AgentChat, which broke. The
// tool now has a built-in login template (no/en; logo row only when the brand has a logo) and
// accent "auto" picks a logo colour white button text is readable on (WCAG 4.5:1). It also had NO
// caller check — anyone could rewrite a World's sign-in email; now Superadmin or that World's founder.
//
// Drives the REAL executor through executeTool with in-memory SQLite for D1, a fake KG_WORKER that
// stores the saved graph, and globalThis.fetch serving the imgix palette captured for the nibi logo.
//
// Run:  node worker/test-world-email-template.mjs   (exit 0 = pass, 1 = fail)

import fs from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'
import { DatabaseSync } from 'node:sqlite'

const dir = path.dirname(fileURLToPath(import.meta.url))
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'email-template-'))
for (const f of fs.readdirSync(dir)) {
  if (f.endsWith('.js')) fs.copyFileSync(path.join(dir, f), path.join(tmp, f))
}
fs.writeFileSync(path.join(tmp, 'package.json'), '{"type":"module"}')
fs.symlinkSync(path.join(dir, 'node_modules'), path.join(tmp, 'node_modules'))
const { executeTool } = await import(path.join(tmp, 'tool-executors.js'))

let failures = 0
const check = (name, cond, detail) => {
  if (cond) console.log(`ok    ${name}`)
  else { failures++; console.error(`FAIL  ${name}\n      ${detail}`) }
}

// Captured 2026-09-15 from https://vegvisr.imgix.net/1789324007169-1.jpg?palette=json&colors=4
const NIBI_PALETTE = {"colors":[{"hex":"#2d5fa7"},{"hex":"#5785c6"},{"hex":"#b3c1d5"},{"hex":"#98bae9"}],"dominant_colors":{"vibrant":{"hex":"#3a7ad6"},"vibrant_light":{"hex":"#8cb2e7"},"vibrant_dark":{"hex":"#2d5fa7"},"muted":{"hex":"#6688b9"},"muted_light":{"hex":"#a9b8cd"}}}
const LIGHT_PALETTE = {"colors":[{"hex":"#8cb2e7"},{"hex":"#eeeeee"}],"dominant_colors":{"vibrant":{"hex":"#8cb2e7"}}}
const LOGO = 'https://vegvisr.imgix.net/1789324007169-1.jpg?h=96'

const paletteRequests = []
globalThis.fetch = async (url) => {
  const u = new URL(url)
  paletteRequests.push(u)
  if (u.hostname.endsWith('imgix.net') && u.searchParams.get('palette') === 'json') {
    return new Response(JSON.stringify(u.pathname.includes('light') ? LIGHT_PALETTE : NIBI_PALETTE), { status: 200 })
  }
  return new Response('not mocked', { status: 404 })
}

function makeEnv() {
  const db = new DatabaseSync(':memory:')
  db.exec(`
    CREATE TABLE config (user_id TEXT, email TEXT, Role TEXT, bio TEXT, profileimage TEXT, phone TEXT, phone_verified_at TEXT, data TEXT);
    CREATE TABLE world_founders (founder_email TEXT, account_holder_email TEXT, domain TEXT);
  `)
  db.prepare(`INSERT INTO config (user_id, email, Role) VALUES ('owner-uuid', 'owner@example.com', 'Superadmin')`).run()
  db.prepare(`INSERT INTO config (user_id, email, Role) VALUES ('b8e7', 'post@nibi.no', 'Admin')`).run()
  db.prepare(`INSERT INTO config (user_id, email, Role) VALUES ('other', 'stranger@example.com', 'Admin')`).run()
  db.prepare(`INSERT INTO world_founders VALUES ('post@nibi.no', 'post@nibi.no', 'nibi.no')`).run()
  const DB = {
    prepare(sql) {
      let args = []
      const stmt = {
        bind(...a) { args = a; return stmt },
        async first() { return db.prepare(sql).get(...args) ?? null },
        async all() { return { results: db.prepare(sql).all(...args) } },
        async run() { db.prepare(sql).run(...args); return { success: true } },
      }
      return stmt
    },
  }
  const graphs = new Map()
  const saves = []
  const KG_WORKER = {
    async fetch(url, init = {}) {
      const u = new URL(url)
      if (u.pathname === '/getknowgraphsummaries') {
        const marker = u.searchParams.get('metaArea')
        const hits = [...graphs.entries()].filter(([, g]) => g.metadata.metaArea === `#${marker}`).map(([id]) => ({ id }))
        return new Response(JSON.stringify({ results: hits }), { status: 200 })
      }
      if (u.pathname === '/getknowgraph') {
        const g = graphs.get(u.searchParams.get('id'))
        return g ? new Response(JSON.stringify(g), { status: 200 }) : new Response('{}', { status: 404 })
      }
      if (u.pathname === '/saveGraphWithHistory') {
        const b = JSON.parse(init.body); graphs.set(b.id, b.graphData); saves.push(b)
        return new Response(JSON.stringify({ message: 'ok', id: b.id }), { status: 200 })
      }
      return new Response('{}', { status: 404 })
    },
  }
  return { env: { DB, KG_WORKER }, graphs, saves }
}

const run = async (env, input) => { try { return await executeTool('set_world_email_template', input, env) } catch (e) { return { thrown: e.message } } }
const template = (graphs, lang) => [...graphs.values()][0]?.nodes.find((n) => n.type === 'email-template' && n.metadata.language === lang)
const brandNode = (graphs) => [...graphs.values()][0]?.nodes.find((n) => n.type === 'email-brand')

// 1. The wizard's call: no subject/body, logo + accent auto.
{
  const { env, graphs } = makeEnv()
  const r = await run(env, { userId: 'owner-uuid', domain: 'nibi.no', purpose: 'login', language: 'no', brand: { name: 'Nibi', fromName: 'Nibi', logo: LOGO, accent: 'auto', footer: 'Nibi · nibi.no', fromEmail: 'post@nibi.no' } })
  const t = template(graphs, 'no')
  check('saves with no subject or body', r.success === true && r.used_default_template === true, JSON.stringify(r))
  check('built-in Norwegian subject', t?.metadata.subject === 'Logg inn hos {brandName}', JSON.stringify(t?.metadata))
  check('body has logo row, magicLink button, accent + footer placeholders', /<img src="\{brandLogo\}"/.test(t?.info) && /href="\{magicLink\}"/.test(t?.info) && /background:\{brandAccent\}/.test(t?.info) && /\{brandFooter\}/.test(t?.info) && /Fortsett til \{brandName\}/.test(t?.info), t?.info)
  check('body carries edit-section markers', /<!-- edit:cta:start -->/.test(t?.info), t?.info)
  check('accent auto → #2d5fa7 from the logo palette', r.accent_pick?.accent === '#2d5fa7' && r.accent_pick.contrast >= 4.5 && brandNode(graphs)?.metadata.accent === '#2d5fa7', JSON.stringify(r.accent_pick))
  check('palette read from the original image (h=96 stripped)', paletteRequests.some((q) => q.pathname === '/1789324007169-1.jpg' && !q.searchParams.has('h')), paletteRequests.map(String).join(' '))
  check('"auto" is never stored as the accent', brandNode(graphs)?.metadata.accent !== 'auto', JSON.stringify(brandNode(graphs)?.metadata))
  check('fromEmail stored on the brand', brandNode(graphs)?.metadata.fromEmail === 'post@nibi.no', JSON.stringify(brandNode(graphs)?.metadata))

  // 2. Second language on the same World, brand already stored → still gets the logo row.
  const en = await run(env, { userId: 'owner-uuid', domain: 'nibi.no', purpose: 'login', language: 'en' })
  const te = template(graphs, 'en')
  check('English built-in template added to the same graph', en.success === true && graphs.size === 1 && te?.metadata.subject === 'Sign in to {brandName}' && /Continue to \{brandName\}/.test(te?.info), JSON.stringify(en))
  check('second language sees the stored logo', /<img src="\{brandLogo\}"/.test(te?.info), te?.info)
}

// 3. No logo → no broken image row.
{
  const { env, graphs } = makeEnv()
  await run(env, { userId: 'owner-uuid', domain: 'nibi.no', purpose: 'login', brand: { name: 'Nibi', accent: '#1f3a5f' } })
  check('no logo → template has no <img>', !/<img/.test(template(graphs, 'no')?.info || '<img'), template(graphs, 'no')?.info)
}

// 4. Accent auto edge cases.
{
  const { env } = makeEnv()
  const light = await run(env, { userId: 'owner-uuid', domain: 'nibi.no', purpose: 'login', brand: { name: 'Nibi', logo: 'https://vegvisr.imgix.net/light-logo.png', accent: 'auto' } })
  check('only light colours → darkened until readable', light.accent_pick && light.accent_pick.contrast >= 4.5 && /darkened/.test(light.accent_pick.source), JSON.stringify(light.accent_pick))
  const ext = await run(env, { userId: 'owner-uuid', domain: 'nibi.no', purpose: 'login', brand: { name: 'Nibi', logo: 'https://example.com/logo.png', accent: 'auto' } })
  check('non-imgix logo → neutral fallback, said so', ext.accent_pick?.accent === '#1f3a5f' && /not on imgix/.test(ext.accent_pick.note || ''), JSON.stringify(ext.accent_pick))
}

// 4b. The live 96px palette (captured 2026-09-15) — lightest readable colour, not the near-black navy.
{
  const { env } = makeEnv()
  const RESIZED = {"colors":[{"hex":"#497dc8"},{"hex":"#2873ce"},{"hex":"#9ab0d4"},{"hex":"#8fa9d8"},{"hex":"#c3cddf"},{"hex":"#e3e7ed"}],"dominant_colors":{"vibrant":{"hex":"#1970cf"},"vibrant_light":{"hex":"#95b2e5"},"vibrant_dark":{"hex":"#0e4076"},"muted_light":{"hex":"#a7b9d7"}}}
  const saved = globalThis.fetch
  globalThis.fetch = async () => new Response(JSON.stringify(RESIZED), { status: 200 })
  const r = await run(env, { userId: 'owner-uuid', domain: 'nibi.no', purpose: 'login', brand: { name: 'Nibi', logo: LOGO, accent: 'auto' } })
  globalThis.fetch = saved
  check('resized-style palette → #2873ce (readable, closest to the logo), not #0e4076', r.accent_pick?.accent === '#2873ce' && r.accent_pick.contrast >= 4.5, JSON.stringify(r.accent_pick))
}

// 5. Explicit subject/body still used as given.
{
  const { env, graphs } = makeEnv()
  await run(env, { userId: 'owner-uuid', domain: 'nibi.no', purpose: 'login', subject: 'Custom {brandName}', body: '<p>Hi <a href="{magicLink}">go</a></p>' })
  const t = template(graphs, 'no')
  check('explicit body kept (wrapped in one section)', t?.metadata.subject === 'Custom {brandName}' && /<p>Hi <a href="\{magicLink\}">go<\/a><\/p>/.test(t?.info) && /edit:email-body:start/.test(t?.info), t?.info)
}

// 6. Purpose without a built-in default still needs a body.
{
  const { env, saves } = makeEnv()
  const r = await run(env, { userId: 'owner-uuid', domain: 'nibi.no', purpose: 'meeting' })
  check('meeting without body → clear error, nothing saved', !!r.thrown && /only purpose "login"/.test(r.thrown) && saves.length === 0, JSON.stringify(r))
}

// 7. Caller gate.
{
  const { env, saves } = makeEnv()
  const stranger = await run(env, { userId: 'other', domain: 'nibi.no', purpose: 'login', brand: { name: 'Evil' } })
  check('non-founder Admin refused, nothing saved', stranger.success === false && /World Founder of nibi\.no/.test(stranger.error || '') && saves.length === 0, JSON.stringify(stranger))
  const founder = await run(env, { userId: 'b8e7', domain: 'nibi.no', purpose: 'login', brand: { name: 'Nibi' } })
  check('the World founder may set their own template', founder.success === true && saves.length === 1, JSON.stringify(founder))
  const noUser = await run(env, { domain: 'nibi.no', purpose: 'login' })
  check('no user context refused', noUser.success === false, JSON.stringify(noUser))
}

fs.rmSync(tmp, { recursive: true, force: true })
console.log(failures ? `\n${failures} FAILED` : '\nPASS — World login email template: built-in body, accent from logo, caller gate.')
process.exit(failures ? 1 : 0)
