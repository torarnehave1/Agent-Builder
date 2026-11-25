// BrowserBridge — one Durable Object per person (2026-11-25). The person's Chrome extension holds a
// WebSocket to it; /converse sends browser commands (open, read …) through it and waits for the
// answer. The extension decides what is allowed (per-site permission, approval, stop switch).
import { DurableObject } from 'cloudflare:workers'
import { resolveAuthorizedCallerWithCredentials } from './auth.js'

const CMD_TIMEOUT_MS = 60_000 // long enough for a person to approve a site in the extension
const SLOW_TIMEOUT_MS = 180_000 // nb_ask: NotebookLM writes its answer for up to 150 s
const timeoutFor = (action) => (action === 'nb_ask' ? SLOW_TIMEOUT_MS : CMD_TIMEOUT_MS)

const ev = (self, e) => { self.events.push({ t: new Date().toISOString(), ...e }); self.events = self.events.slice(-15) }

export class BrowserBridge extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env)
    this.pending = new Map() // id -> { resolve, timer }
    this.events = [] // last events, for /browser/status
  }

  async fetch(request) {
    const url = new URL(request.url)
    if (url.pathname === '/ws') {
      const pair = new WebSocketPair()
      // Several connections may exist at once (two Chrome profiles, or an old half-open socket that
      // still looks open). None is closed: commands go to the one that spoke last (see freshest()).
      this.ctx.acceptWebSocket(pair[1])
      ev(this, { e: 'connected' })
      pair[1].serializeAttachment({ at: Date.now() })
      return new Response(null, { status: 101, webSocket: pair[0], headers: { 'Sec-WebSocket-Protocol': 'vegr.v1' } })
    }
    if (url.pathname === '/diag') {
      const at = (w) => { try { return w.deserializeAttachment()?.at || 0 } catch { return 0 } }
      return Response.json({ sockets: this.ctx.getWebSockets().map((w) => ({ lastHeardSecAgo: Math.round((Date.now() - at(w)) / 1000) })), pending: this.pending.size, events: this.events })
    }
    if (url.pathname === '/status') {
      return Response.json({ connected: this.ctx.getWebSockets().length > 0 })
    }
    if (url.pathname === '/cmd' && request.method === 'POST') {
      const sockets = this.freshest()
      if (!sockets.length) return Response.json({ ok: false, error: 'No browser is connected. Install and sign in to the VEGR.AI Chrome extension, then try again.' })
      const { action, params } = await request.json()
      const id = crypto.randomUUID()
      const ms = timeoutFor(action)
      const answer = new Promise((resolve) => {
        const timer = setTimeout(() => { this.pending.delete(id); resolve({ ok: false, error: `The browser did not answer within ${ms / 1000} seconds.` }) }, ms)
        this.pending.set(id, { resolve, timer })
      })
      ev(this, { e: 'cmd', action, sockets: sockets.length })
      try { sockets[0].send(JSON.stringify({ type: 'cmd', id, action, params: params || {} })) } catch (e) {
        const p = this.pending.get(id); if (p) { clearTimeout(p.timer); this.pending.delete(id) }
        return Response.json({ ok: false, error: `Could not reach the browser: ${e?.message || e}` })
      }
      return Response.json(await answer)
    }
    return new Response('Not found', { status: 404 })
  }

  // Open sockets, the one heard from most recently first.
  freshest() {
    const at = (w) => { try { return w.deserializeAttachment()?.at || 0 } catch { return 0 } }
    return this.ctx.getWebSockets().sort((a, b) => at(b) - at(a))
  }

  webSocketMessage(ws, message) {
    try { ws.serializeAttachment({ at: Date.now() }) } catch { /* closed */ }
    let m
    try { m = JSON.parse(typeof message === 'string' ? message : new TextDecoder().decode(message)) } catch { return }
    if (m.type === 'ping') { ws.send(JSON.stringify({ type: 'pong' })); return }
    if (m.type === 'result' && m.id) {
      ev(this, { e: 'result', ok: !!m.ok, known: this.pending.has(m.id) })
      const p = this.pending.get(m.id)
      if (p) { clearTimeout(p.timer); this.pending.delete(m.id); p.resolve({ ok: !!m.ok, ...(m.ok ? { data: m.data } : { error: m.error || 'Failed in the browser.' }) }) }
    }
  }
  webSocketClose(_ws, code) { ev(this, { e: 'closed', code }) }
  webSocketError() {}
}

const stub = (env, userId) => env.BROWSER_BRIDGE.get(env.BROWSER_BRIDGE.idFromName(String(userId)))

// GET /browser/ws — the extension connects here. The login token travels in the WebSocket
// subprotocol list ("vegr.v1", "token.<token>"): a header an extension can set, and not in the URL.
export async function handleBrowserWs(request, env) {
  if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket upgrade', { status: 426 })
  const protos = (request.headers.get('Sec-WebSocket-Protocol') || '').split(',').map((s) => s.trim())
  const t = protos.find((p) => p.startsWith('token.'))
  const auth = t ? await resolveAuthorizedCallerWithCredentials({ authToken: t.slice(6) }, env).catch(() => null) : null
  if (!auth?.authenticated || !auth.userId) return new Response('Unauthorized', { status: 401 })
  return stub(env, auth.userId).fetch(new Request('https://bridge/ws', { headers: { Upgrade: 'websocket' } }))
}

export async function browserStatus(env, userId) {
  const r = await stub(env, userId).fetch('https://bridge/status')
  return r.json()
}
export async function browserCommand(env, userId, action, params) {
  const r = await stub(env, userId).fetch(new Request('https://bridge/cmd', { method: 'POST', body: JSON.stringify({ action, params }) }))
  return r.json()
}

export async function browserDiag(env, userId) {
  const r = await stub(env, userId).fetch('https://bridge/diag')
  return r.json()
}
