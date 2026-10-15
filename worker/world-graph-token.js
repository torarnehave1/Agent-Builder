/**
 * COPY of vegvisr-frontend/dev-worker/world-graph-token.js — the token format the World graph
 * proxy verifies. That file is the source of truth; this copy exists because agent-worker signs
 * the proxy's migrate call during provision_world_graphs and cannot import across repos.
 * Change the format there first, then here. Nothing checks that the two copies agree; a
 * mismatch shows up as provision_world_graphs failing the migrate step with "bad signature".
 */
/**
 * world-graph-token.js — the short-lived token the platform sends to a World's graph proxy.
 *
 * The proxy runs in the World Founder's OWN Cloudflare account. It must accept writes only from
 * the platform, and nothing secret may live in that account: whoever can read the founder's worker
 * settings must not be able to forge platform requests. So the platform signs with an Ed25519
 * PRIVATE key (a secret in the platform workers) and the proxy holds only the PUBLIC key.
 *
 *   token = base64url(JSON claims) + "." + base64url(signature over the first part)
 *
 *   claims  aud  the World's domain — a token for one World is useless at another
 *           op   the one operation it allows ('commit', 'getRow', 'migrate', …)
 *           bh   SHA-256 (base64url) of the exact request body — a token cannot be replayed
 *                with a different body
 *           iat, exp   seconds; exp - iat is at most MAX_LIFETIME_S
 *
 * Agent-Builder's provisioning tool signs migrate tokens with a copy of signWorldGraphToken().
 * The format above is the contract between the two; change it in both places or in neither.
 */

export const MAX_LIFETIME_S = 120

const enc = new TextEncoder()

export function b64url(bytes) {
  let s = ''
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromB64url(str) {
  const s = String(str).replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(s + '='.repeat((4 - (s.length % 4)) % 4))
  return Uint8Array.from(bin, (c) => c.charCodeAt(0))
}

// Only the key material goes into importKey. Node exports an Ed25519 JWK with "alg":"Ed25519";
// the Workers runtime refuses that ("alg does not match requested Ed25519 curve", seen live on the
// first provisioning, 2026-10-15) and expects "EdDSA" or nothing. Dropping alg and key_ops makes the
// same key importable in both runtimes.
function keyMaterial(jwk, withPrivate) {
  const k = typeof jwk === 'string' ? JSON.parse(jwk) : jwk
  return withPrivate ? { kty: k.kty, crv: k.crv, x: k.x, d: k.d } : { kty: k.kty, crv: k.crv, x: k.x }
}

export async function bodyHash(body) {
  return b64url(await crypto.subtle.digest('SHA-256', enc.encode(body)))
}

/** privateJwk: the Ed25519 private key as a JWK object (or its JSON string). */
export async function signWorldGraphToken(privateJwk, { aud, op, body, ttlSeconds = 60, now = Date.now() }) {
  const key = await crypto.subtle.importKey('jwk', keyMaterial(privateJwk, true), { name: 'Ed25519' }, false, ['sign'])
  const iat = Math.floor(now / 1000)
  const claims = { aud, op, bh: await bodyHash(body), iat, exp: iat + Math.min(ttlSeconds, MAX_LIFETIME_S) }
  const head = b64url(enc.encode(JSON.stringify(claims)))
  const sig = await crypto.subtle.sign({ name: 'Ed25519' }, key, enc.encode(head))
  return `${head}.${b64url(sig)}`
}

/** The public half of a private JWK — what the proxy is given. */
export function publicJwkOf(privateJwk) {
  return keyMaterial(privateJwk, false)
}

/**
 * Verify a token for one request. Returns { ok: true, claims } or { ok: false, error }.
 * Every check fails closed; the error names which one, never the key.
 */
export async function verifyWorldGraphToken(publicJwk, token, { aud, op, body, now = Date.now() }) {
  if (!publicJwk) return { ok: false, error: 'proxy has no public key configured' }
  const parts = String(token || '').split('.')
  if (parts.length !== 2) return { ok: false, error: 'malformed token' }
  let claims
  try {
    claims = JSON.parse(new TextDecoder().decode(fromB64url(parts[0])))
  } catch {
    return { ok: false, error: 'malformed token' }
  }
  let valid = false
  try {
    const key = await crypto.subtle.importKey('jwk', keyMaterial(publicJwk, false), { name: 'Ed25519' }, false, ['verify'])
    valid = await crypto.subtle.verify({ name: 'Ed25519' }, key, fromB64url(parts[1]), enc.encode(parts[0]))
  } catch {
    valid = false
  }
  if (!valid) return { ok: false, error: 'bad signature' }
  const t = Math.floor(now / 1000)
  if (claims.aud !== aud) return { ok: false, error: 'token is for another World' }
  if (claims.op !== op) return { ok: false, error: `token is for op ${claims.op}, not ${op}` }
  if (!Number.isInteger(claims.exp) || !Number.isInteger(claims.iat)) return { ok: false, error: 'malformed token' }
  if (claims.exp - claims.iat > MAX_LIFETIME_S) return { ok: false, error: 'token lifetime too long' }
  if (claims.iat > t + 30) return { ok: false, error: 'token issued in the future' }
  if (claims.exp < t) return { ok: false, error: 'token expired' }
  if (claims.bh !== (await bodyHash(body))) return { ok: false, error: 'token does not match the request body' }
  return { ok: true, claims }
}
