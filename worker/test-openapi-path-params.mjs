// Regression guard for OpenAPI path parameters (2026-09-10).
//
// executeOpenAPITool used to build the URL from the RAW path template:
//   let url = `${workerUrl}${meta.path}`      // "/groups/{groupId}/bots"
// so "{groupId}" was never substituted, and because a path param is not a query param it was
// also dumped into the JSON body. group-chat-worker's route regex matched the literal token,
// looked it up as an id, and returned "Group not found" for a group that plainly existed —
// while set_contact_route (which reads CHAT_DB directly) found the same group. 23 templated
// paths on group-chat-worker + 2 on email-worker were affected, i.e. every chat tool that
// addresses a group/bot/poll/message by id.
//
// This test drives the REAL dispatcher with a fake service binding and asserts the URL and
// body that go out on the wire.
//
// Run:  node worker/test-openapi-path-params.mjs   (exit 0 = pass, 1 = fail)

import fs from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'

const dir = path.dirname(fileURLToPath(import.meta.url))

// worker/package.json has no "type": "module", so a .js with `export` cannot be imported
// directly. Copy the real source to a .mjs and import THAT — still the actual code, not a copy
// of its logic.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'openapi-path-'))
const shim = path.join(tmp, 'openapi-tools.mjs')
fs.copyFileSync(path.join(dir, 'openapi-tools.js'), shim)
const { executeOpenAPITool } = await import(shim)

let failures = 0
const fail = (name, msg) => { failures++; console.error(`FAIL  ${name}\n      ${msg}`) }
const pass = (name) => console.log(`ok    ${name}`)

// Captures what the dispatcher actually sent.
function fakeEnv(status = 200, payload = { success: true }) {
  const seen = {}
  return {
    seen,
    env: {
      CHAT_WORKER: {
        fetch: async (url, opts) => {
          seen.url = url
          seen.method = opts.method
          seen.body = opts.body ? JSON.parse(opts.body) : null
          return {
            ok: status < 400,
            status,
            json: async () => payload,
          }
        },
      },
    },
  }
}

const addBotMeta = {
  toolName: 'add_bot_to_group',
  path: '/groups/{groupId}/bots',
  method: 'POST',
  queryParams: [],
  pathParams: ['groupId'],
  hasBody: true,
  binding: 'CHAT_WORKER',
  workerUrl: 'https://group-chat-worker',
  auth: 'none',
}

const GROUP = '6492abb7-e1e6-4e19-a238-75cd5d9b4bfb'
const BOT = '6ffaabed-fadd-463b-b017-faa34f4448eb'
const USER = 'ca3d9d93-3b02-4e49-a4ee-43552ec4ca2b'

// 1. The exact failing call from the 2026-09-10 log.
{
  const t = 'add_bot_to_group substitutes {groupId} into the URL'
  const { env, seen } = fakeEnv()
  await executeOpenAPITool('add_bot_to_group',
    { groupId: GROUP, bot_id: BOT, user_id: USER, phone: '+4790914095' },
    env, { add_bot_to_group: addBotMeta })
  if (seen.url !== `https://group-chat-worker/groups/${GROUP}/bots`) fail(t, `url was ${seen.url}`)
  else if (seen.url.includes('{')) fail(t, 'raw template still in url')
  else pass(t)

  const t2 = 'path param is stripped from the JSON body'
  if (seen.body.groupId !== undefined) fail(t2, `body still carries groupId: ${JSON.stringify(seen.body)}`)
  else if (seen.body.bot_id !== BOT || seen.body.user_id !== USER || seen.body.phone !== '+4790914095')
    fail(t2, `body lost auth/bot fields: ${JSON.stringify(seen.body)}`)
  else pass(t2)
}

// 2. Subagents pass snake_case; the spec property is camelCase.
{
  const t = 'snake_case alias (group_id) fills {groupId}'
  const { env, seen } = fakeEnv()
  await executeOpenAPITool('add_bot_to_group',
    { group_id: GROUP, bot_id: BOT, user_id: USER, phone: '+4790914095' },
    env, { add_bot_to_group: addBotMeta })
  if (seen.url !== `https://group-chat-worker/groups/${GROUP}/bots`) fail(t, `url was ${seen.url}`)
  else if (seen.body.group_id !== undefined) fail(t, 'alias left in body')
  else pass(t)
}

// 3. A missing value must name the parameter, not reach the worker as "{groupId}".
{
  const t = 'missing path param throws naming the parameter'
  const { env, seen } = fakeEnv()
  let err = null
  try {
    await executeOpenAPITool('add_bot_to_group',
      { bot_id: BOT, user_id: USER, phone: '+4790914095' },
      env, { add_bot_to_group: addBotMeta })
  } catch (e) { err = e }
  if (!err) fail(t, 'no error thrown')
  else if (!/groupId/.test(err.message)) fail(t, `error does not name the param: ${err.message}`)
  else if (seen.url) fail(t, `request was sent anyway: ${seen.url}`)
  else pass(t)
}

// 4. Two tokens in one path.
{
  const t = 'multiple path params both substituted'
  const meta = { ...addBotMeta, path: '/groups/{groupId}/bots/{botId}', method: 'DELETE', pathParams: ['groupId', 'botId'] }
  const { env, seen } = fakeEnv()
  await executeOpenAPITool('remove_bot_from_group',
    { groupId: GROUP, botId: BOT, user_id: USER, phone: '+4790914095' },
    env, { remove_bot_from_group: meta })
  if (seen.url !== `https://group-chat-worker/groups/${GROUP}/bots/${BOT}`) fail(t, `url was ${seen.url}`)
  else pass(t)
}

// 5. Path + query together.
{
  const t = 'path and query params coexist'
  const meta = { ...addBotMeta, path: '/groups/{groupId}/messages', method: 'GET', queryParams: ['limit'], hasBody: false }
  const { env, seen } = fakeEnv()
  await executeOpenAPITool('get_group_messages',
    { groupId: GROUP, limit: 20 },
    env, { get_group_messages: meta })
  if (seen.url !== `https://group-chat-worker/groups/${GROUP}/messages?limit=20`) fail(t, `url was ${seen.url}`)
  else pass(t)
}

// 6. Regression: KG-style query-only operations must be untouched.
{
  const t = 'query-only operation (KG worker) unchanged'
  const meta = {
    toolName: 'kg_get_know_graph', path: '/getknowgraph', method: 'GET',
    queryParams: ['id'], pathParams: [], hasBody: false,
    binding: 'CHAT_WORKER', workerUrl: 'https://knowledge-graph-worker', auth: 'none',
  }
  const { env, seen } = fakeEnv()
  await executeOpenAPITool('kg_get_know_graph', { id: 'graph_system_registry' }, env, { kg_get_know_graph: meta })
  if (seen.url !== 'https://knowledge-graph-worker/getknowgraph?id=graph_system_registry') fail(t, `url was ${seen.url}`)
  else pass(t)
}

// 7. A stale cached operationMap (built before pathParams existed) must still work, because
//    tokens are read from the template itself.
{
  const t = 'stale operationMap without pathParams still substitutes'
  const meta = { ...addBotMeta }
  delete meta.pathParams
  const { env, seen } = fakeEnv()
  await executeOpenAPITool('add_bot_to_group',
    { groupId: GROUP, bot_id: BOT, user_id: USER, phone: '+4790914095' },
    env, { add_bot_to_group: meta })
  if (seen.url !== `https://group-chat-worker/groups/${GROUP}/bots`) fail(t, `url was ${seen.url}`)
  else if (seen.body.groupId !== undefined) fail(t, 'groupId left in body')
  else pass(t)
}

fs.rmSync(tmp, { recursive: true, force: true })

if (failures > 0) {
  console.error(`\n${failures} failure(s)`)
  process.exit(1)
}
console.log('\nAll OpenAPI path-param checks passed.')
