// A domain that belongs to a World in its OWN Cloudflare account must never appear in the
// hard-coded platform zone lists. vegr.ai was in both when it moved (2026-09-23): create_subdomain
// used the platform token on a zone that account no longer owned, and publish wrote into the wrong
// KV while reporting success. alivenesslab.org was queued to repeat it (2026-09-24).
//
// This test reads the lists from source and fails on any domain the registry calls own_account.
// It takes the registry snapshot as a literal list, because the suite must not need D1.
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const dir = path.dirname(fileURLToPath(import.meta.url))
const src = fs.readFileSync(path.join(dir, 'tool-executors.js'), 'utf8')

let failures = 0
const check = (name, cond, detail) => { if (cond) console.log(`ok    ${name}`); else { failures++; console.error(`FAIL  ${name}\n      ${detail}`) } }

const listOf = (name) => {
  const m = src.match(new RegExp(`const ${name} = \\[([^\\]]*)\\]`))
  if (!m) return null
  return [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1])
}

const shared = listOf('SHARED_BRAND_ZONES')
const platform = listOf('PLATFORM_SUBDOMAIN_ZONES')
check('both zone lists are readable from source', Array.isArray(shared) && Array.isArray(platform), `shared=${shared} platform=${platform}`)

// Worlds known to run in their own Cloudflare account. Add a domain here when it moves out.
const OWN_ACCOUNT_WORLDS = ['nibi.no', 'vegr.ai', 'alivenesslab.org', 'universi.no', 'iamazing.page']

for (const domain of OWN_ACCOUNT_WORLDS) {
  check(`${domain} is not in SHARED_BRAND_ZONES`, !shared.includes(domain),
    `${domain} is listed — publish_html_node would treat it as a platform host`)
  check(`${domain} is not in PLATFORM_SUBDOMAIN_ZONES`, !platform.includes(domain),
    `${domain} is listed — create_subdomain would use the platform token on a foreign zone`)
}

// The resolver that makes the lists a fallback rather than the authority must still be wired in.
check('publish resolves the serving account from the registry', /isSharedBrandHostFor\(host, env\)/.test(src),
  'publish_html_node no longer asks world_founders which proxy serves the host')
check('the registry resolver consults world_founders', /hosting_model FROM world_founders WHERE domain = \?/.test(src),
  'isSharedBrandHostFor does not read hosting_model')

console.log(failures ? `\n${failures} FAILED` : '\nPASS — no own-account World domain is hard-coded as a platform zone, and publish still resolves the owner from the registry.')
process.exit(failures ? 1 : 0)
