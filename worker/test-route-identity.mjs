// Routes that act as a user take identity from a credential only, never from body.userId
// (2026-11-06). An unauthenticated caller naming someone's userId gets 401 and nothing runs.
import { register } from 'node:module'

// index.js pulls in a dependency that imports `cloudflare:*` modules, which only exist inside the
// Workers runtime. Stub them so the router can be loaded under plain Node.
const stub = `
  export class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env } }
  export class WorkerEntrypoint { constructor(ctx, env) { this.ctx = ctx; this.env = env } }
  export class WorkflowEntrypoint { constructor(ctx, env) { this.ctx = ctx; this.env = env } }
  export class RpcTarget {}
  export class EmailMessage {}
  export const env = {}
  export function connect() { throw new Error('sockets are not available in tests') }
  export default {}
`
register(`data:text/javascript,${encodeURIComponent(`
  export async function resolve(specifier, context, next) {
    if (specifier.startsWith('cloudflare:')) return { url: 'data:text/javascript,' + ${JSON.stringify(encodeURIComponent(stub))}, shortCircuit: true }
    return next(specifier, context)
  }
`)}`)

const { default: worker } = await import('./index.js')

let fail = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${extra ? '  ' + extra : ''}`)
  if (!cond) fail++
}

// Every binding a route might touch records the touch; none should be reached on a refusal.
const touched = []
const trap = (name) => new Proxy({}, { get: (_t, prop) => (...args) => { touched.push(`${name}.${String(prop)}`); throw new Error(`${name} must not be reached`) } })
const env = new Proxy({}, { get: (_t, prop) => (typeof prop === 'string' && prop !== 'then' ? trap(prop) : undefined) })
const ctx = { waitUntil: () => {}, passThroughOnException: () => {} }

const post = (path, body) => worker.fetch(new Request(`https://agent.vegvisr.org${path}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: 'https://builder.vegvisr.org' },
  body: JSON.stringify(body),
}), env, ctx)

const quiet = console.error
console.error = () => {}

for (const [path, body] of [
  ['/execute', { agentId: 'agent_kg_html_builder', task: 'build a page', userId: 'victim-user-id' }],
  ['/automation/run', { graphId: 'g1', dryRun: false, userId: 'victim@example.com', callerEmail: 'victim@example.com' }],
  ['/automation/run', { graphId: 'g1', stepId: 's1', userId: 'victim@example.com' }],
  ['/automation/build', { prompt: 'every day email me', userId: 'victim@example.com', tools: [] }],
]) {
  touched.length = 0
  let status
  try {
    status = (await post(path, body)).status
  } catch (e) {
    status = `threw: ${e.message}`
  }
  const reachedWork = touched.filter((t) => !t.startsWith('DB.') && !t.startsWith('vegvisr_org.'))
  check(`${path}${body.stepId ? ' (single step)' : ''} without a credential → 401`, status === 401, String(status))
  check(`  and no model, graph or tool binding was reached`, reachedWork.length === 0, reachedWork.join(', '))
}

console.error = quiet
console.log(fail ? `\n${fail} FAILED` : '\nAll route-identity checks passed.')
process.exit(fail ? 1 : 0)
