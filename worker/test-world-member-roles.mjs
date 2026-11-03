// World member roles (2026-11-03): list_world_member_roles / set_world_member_roles against a fake
// platform database (SQLite behind the D1 API). Properties: only a Superadmin or that World's
// founder may; only <World tag>-<ROLE> tags are touched; the person must carry the World tag as a
// whole token; other tags and the platform role are never changed; foreign tags are refused.
//
// Run:  node worker/test-world-member-roles.mjs   (exit 0 = pass, 1 = fail)

import fs from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'
import { DatabaseSync } from 'node:sqlite'

const dir = path.dirname(fileURLToPath(import.meta.url))
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'world-roles-'))
for (const f of fs.readdirSync(dir)) if (f.endsWith('.js')) fs.copyFileSync(path.join(dir, f), path.join(tmp, f))
fs.writeFileSync(path.join(tmp, 'package.json'), '{"type":"module"}')
fs.symlinkSync(path.join(dir, 'node_modules'), path.join(tmp, 'node_modules'))
const { executeTool } = await import(path.join(tmp, 'tool-executors.js'))

let failures = 0
const check = (name, cond, detail) => {
  if (cond) console.log(`ok    ${name}`)
  else { failures++; console.error(`FAIL  ${name}\n      ${detail}`) }
}

const db = new DatabaseSync(':memory:')
db.exec(`
  CREATE TABLE config (user_id TEXT, email TEXT, Role TEXT, bio TEXT, profileimage TEXT, phone TEXT, phone_verified_at TEXT, data TEXT, group_tags TEXT);
  CREATE TABLE world_founders (id TEXT, founder_email TEXT, account_holder_email TEXT, domain TEXT, world_name TEXT, meta_area_tag TEXT, created_at TEXT);
`)
const addUser = (email, role, tags, name) => db.prepare('INSERT INTO config (user_id, email, Role, data, group_tags) VALUES (?, ?, ?, ?, ?)')
  .run(email, email, role, JSON.stringify({ profile: { name } }), tags)
addUser('post@nibi.no', 'Admin', null, 'NIBI')
addUser('boss@example.com', 'Superadmin', '#VEGR.AI', 'Boss')
addUser('giulia@example.com', 'Admin', '#NIBI', 'Giulia')
addUser('ingrid@example.com', 'Admin', '#NIBI #IIBA', 'Ingrid')
addUser('outsider@example.com', 'Admin', '#VEGR.AI #NIBI-LEDER', 'Outsider')
addUser('other@sodesign.no', 'Admin', '#SODESIGN', 'Stine')
db.prepare(`INSERT INTO world_founders VALUES ('w1', 'post@nibi.no', 'post@nibi.no', 'nibi.no', 'Nibi', '#NIBI', '2026-09-15')`).run()
db.prepare(`INSERT INTO world_founders VALUES ('w2', 'other@sodesign.no', null, 'sodesign.no', 'SO', '#SODESIGN', '2026-10-15')`).run()
const DB = { prepare(sql) { let a = []; const st = { bind(...x) { a = x; return st }, async first() { return db.prepare(sql).get(...a) ?? null }, async all() { return { results: db.prepare(sql).all(...a) } }, async run() { db.prepare(sql).run(...a); return { success: true } } }; return st } }
const env = { DB }
const tags = (email) => db.prepare('SELECT group_tags FROM config WHERE email = ?').get(email).group_tags
const role = (email) => db.prepare('SELECT Role FROM config WHERE email = ?').get(email).Role

// Founder adds a role by its short name, Norwegian letters folded.
let r = await executeTool('set_world_member_roles', { domain: 'nibi.no', email: 'giulia@example.com', roles: ['sekretær'], userId: 'post@nibi.no' }, env, {})
check('founder adds a role', r.success && r.verified && tags('giulia@example.com') === '#NIBI #NIBI-SEKRETAER', JSON.stringify(r) + ' ' + tags('giulia@example.com'))
check('platform role untouched', role('giulia@example.com') === 'Admin', role('giulia@example.com'))

// Adding the same role again changes nothing.
r = await executeTool('set_world_member_roles', { domain: 'nibi.no', email: 'giulia@example.com', roles: ['#NIBI-SEKRETAER'], userId: 'post@nibi.no' }, env, {})
check('idempotent add', r.success && r.changed === false, JSON.stringify(r))

// Replace keeps other Worlds' tags.
r = await executeTool('set_world_member_roles', { domain: 'nibi.no', email: 'ingrid@example.com', roles: ['OKONOMI', 'STYRE-MEDLEM'], mode: 'replace', userId: 'post@nibi.no' }, env, {})
check('replace keeps #IIBA', r.success && tags('ingrid@example.com') === '#NIBI #IIBA #NIBI-OKONOMI #NIBI-STYRE-MEDLEM', tags('ingrid@example.com'))
r = await executeTool('set_world_member_roles', { domain: 'nibi.no', email: 'ingrid@example.com', roles: ['STYRE-MEDLEM'], mode: 'remove', userId: 'post@nibi.no' }, env, {})
check('remove one role', r.success && tags('ingrid@example.com') === '#NIBI #IIBA #NIBI-OKONOMI', tags('ingrid@example.com'))

// Refusals.
r = await executeTool('set_world_member_roles', { domain: 'nibi.no', email: 'giulia@example.com', roles: ['#IIBA'], userId: 'post@nibi.no' }, env, {})
check('foreign tag refused', !r.success && /not a role of nibi.no/.test(r.error), JSON.stringify(r))
r = await executeTool('set_world_member_roles', { domain: 'nibi.no', email: 'giulia@example.com', roles: ['#NIBI'], userId: 'post@nibi.no' }, env, {})
check('membership tag refused', !r.success && /membership tag/.test(r.error), JSON.stringify(r))
r = await executeTool('set_world_member_roles', { domain: 'nibi.no', email: 'giulia@example.com', roles: ['VEGR.AI'], userId: 'post@nibi.no' }, env, {})
check('dotted name refused', !r.success, JSON.stringify(r))
r = await executeTool('set_world_member_roles', { domain: 'nibi.no', email: 'outsider@example.com', roles: ['LEDER'], userId: 'post@nibi.no' }, env, {})
check('non-member refused (#NIBI-LEDER is not #NIBI)', !r.success && /not a member/.test(r.error), JSON.stringify(r))
r = await executeTool('set_world_member_roles', { domain: 'nibi.no', email: 'giulia@example.com', roles: ['LEDER'], userId: 'other@sodesign.no' }, env, {})
check("another World's founder refused", !r.success && /Only a Superadmin or the World Founder of nibi.no/.test(r.error), JSON.stringify(r))
r = await executeTool('set_world_member_roles', { domain: 'nibi.no', email: 'giulia@example.com', roles: ['LEDER'], userId: 'ingrid@example.com' }, env, {})
check('plain member refused', !r.success, JSON.stringify(r))
r = await executeTool('set_world_member_roles', { domain: 'nibi.no', email: 'giulia@example.com', roles: ['LEDER'] }, env, {})
check('no caller refused', !r.success, JSON.stringify(r))
check('refusals wrote nothing', tags('giulia@example.com') === '#NIBI #NIBI-SEKRETAER', tags('giulia@example.com'))

// Superadmin may.
r = await executeTool('set_world_member_roles', { domain: 'nibi.no', email: 'giulia@example.com', roles: ['LEDER'], userId: 'boss@example.com' }, env, {})
check('superadmin adds', r.success && tags('giulia@example.com') === '#NIBI #NIBI-SEKRETAER #NIBI-LEDER', tags('giulia@example.com'))

// List: members by whole token, roles only from this World, the stray listed apart.
r = await executeTool('list_world_member_roles', { domain: 'nibi.no', userId: 'post@nibi.no' }, env, {})
const emails = (r.members || []).map((m) => m.email).sort()
check('list members', r.success && JSON.stringify(emails) === JSON.stringify(['giulia@example.com', 'ingrid@example.com']), JSON.stringify(r))
const ing = (r.members || []).find((m) => m.email === 'ingrid@example.com')
check('list shows only this World\'s roles', ing && JSON.stringify(ing.roles) === JSON.stringify(['#NIBI-OKONOMI']), JSON.stringify(ing))
check('stray role listed apart', (r.formerMembersWithRoles || []).some((s) => s.email === 'outsider@example.com'), JSON.stringify(r.formerMembersWithRoles))
r = await executeTool('list_world_member_roles', { domain: 'nibi.no', userId: 'other@sodesign.no' }, env, {})
check('list refused for another founder', !r.success, JSON.stringify(r))

if (failures) { console.error(`\n${failures} failure(s)`); process.exit(1) }
console.log('\nall world-member-roles checks passed')
