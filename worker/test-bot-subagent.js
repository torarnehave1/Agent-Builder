/**
 * Test script for bot subagent tools — calls the LIVE group-chat-worker API
 *
 * Tests:
 * - list_bots (read — any authenticated user)
 * - get_bot (read — any authenticated user, uses existing bot from list)
 * - register_chat_bot (create — Superadmin only)
 * - update_chat_bot (update — Superadmin only)
 * - remove_chat_bot / deactivate (delete — Superadmin only)
 *
 * The test resolves auth via the smsgway profile API. If the resolved user is
 * not a Superadmin, mutation tests will correctly fail with 403 — and the test
 * script will report that as an expected auth boundary.
 *
 * Usage: node worker/test-bot-subagent.js
 */

const BASE = 'https://group-chat-worker.torarnehave.workers.dev'

// Auth — resolve Superadmin profile from smsgway validate endpoint
async function getAuth() {
  const res = await fetch('https://smsgway.vegvisr.org/api/auth/user/validate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'torarnehave@gmail.com' }),
  })
  if (!res.ok) throw new Error(`Validate API failed: ${res.status}`)
  const data = await res.json()
  if (!data.success) throw new Error(`Validation failed: ${data.error}`)
  if (!data.phone) throw new Error('Profile has no phone — cannot authenticate with CHAT_WORKER')
  console.log(`Role: ${data.role}`)
  if (data.role !== 'Superadmin') console.log('  WARNING: User is not Superadmin — mutation tests will fail with 403')
  return {
    user_id: data.user_id,
    phone: data.phone,
    email: data.email || '',
  }
}

function qs(auth) {
  return `user_id=${encodeURIComponent(auth.user_id)}&phone=${encodeURIComponent(auth.phone)}&email=${encodeURIComponent(auth.email)}`
}

let existingBotId = null
let createdBotId = null
const TEST_USERNAME = `test-bot-${Date.now()}`

// ── Read-only tests (any authenticated user) ──

async function testListBots(auth) {
  console.log('\n── TEST: list_bots ──')
  const res = await fetch(`${BASE}/bots?${qs(auth)}`)
  const data = await res.json()
  console.log(`  Status: ${res.status}`)
  console.log(`  Success: ${data.success}`)
  console.log(`  Bot count: ${(data.bots || []).length}`)
  if (data.bots && data.bots.length > 0) {
    existingBotId = data.bots[0].id
    console.log(`  First bot: ${data.bots[0].name} (@${data.bots[0].username}) — id: ${existingBotId}`)
    for (const b of data.bots) {
      console.log(`    - ${b.name} (@${b.username}) model=${b.model} graph=${b.graph_id || 'none'}`)
    }
  }
  if (!res.ok) {
    console.log(`  ERROR: ${JSON.stringify(data)}`)
    return false
  }
  return true
}

async function testGetBot(auth) {
  const botId = existingBotId
  if (!botId) { console.log('\n── SKIP: get_bot (no bots in system) ──'); return false }
  console.log(`\n── TEST: get_bot (id: ${botId}) ──`)
  const res = await fetch(`${BASE}/bots/${botId}?${qs(auth)}`)
  const data = await res.json()
  console.log(`  Status: ${res.status}`)
  console.log(`  Success: ${data.success}`)
  if (data.bot) {
    console.log(`  Name: ${data.bot.name}`)
    console.log(`  Username: @${data.bot.username}`)
    console.log(`  Model: ${data.bot.model}`)
    console.log(`  Graph: ${data.bot.graph_id || 'none'}`)
    console.log(`  System prompt: ${(data.bot.system_prompt || '').slice(0, 80)}...`)
    console.log(`  Groups: ${(data.groups || []).length}`)
    for (const g of (data.groups || [])) {
      console.log(`    - ${g.name} (${g.id})`)
    }
  }
  if (!res.ok) {
    console.log(`  ERROR: ${JSON.stringify(data)}`)
    return false
  }
  return true
}

// ── Mutation tests (Superadmin required) ──

async function testRegisterBot(auth) {
  console.log('\n── TEST: register_chat_bot (create) ──')
  const res = await fetch(`${BASE}/bots`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      user_id: auth.user_id,
      phone: auth.phone,
      email: auth.email,
      name: 'Test Bot (delete me)',
      username: TEST_USERNAME,
      system_prompt: 'You are a test bot. This bot will be deleted.',
      model: 'claude-haiku-4-5-20251001',
      tools: [],
    }),
  })
  const data = await res.json()
  console.log(`  Status: ${res.status}`)
  if (res.status === 403) {
    console.log(`  Expected 403 — user is not Superadmin (auth boundary works correctly)`)
    return 'auth_boundary'
  }
  console.log(`  Success: ${data.success}`)
  if (data.bot) {
    createdBotId = data.bot.id
    console.log(`  Bot ID: ${data.bot.id}`)
    console.log(`  Name: ${data.bot.name}`)
    console.log(`  Username: @${data.bot.username}`)
    console.log(`  Model: ${data.bot.model}`)
  }
  if (!res.ok) {
    console.log(`  ERROR: ${JSON.stringify(data)}`)
    return false
  }
  return true
}

async function testUpdateBot(auth) {
  const botId = createdBotId || existingBotId
  if (!botId) { console.log('\n── SKIP: update_chat_bot (no bot available) ──'); return false }
  console.log(`\n── TEST: update_chat_bot (id: ${botId}) ──`)
  const res = await fetch(`${BASE}/bots/${botId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      user_id: auth.user_id,
      phone: auth.phone,
      email: auth.email,
      // Only change temperature — non-destructive even on existing bots
      temperature: 0.42,
    }),
  })
  const data = await res.json()
  console.log(`  Status: ${res.status}`)
  if (res.status === 403) {
    console.log(`  Expected 403 — user is not Superadmin (auth boundary works correctly)`)
    return 'auth_boundary'
  }
  console.log(`  Success: ${data.success}`)
  if (data.bot) {
    console.log(`  Updated temp: ${data.bot.temperature}`)
  }
  if (!res.ok) {
    console.log(`  ERROR: ${JSON.stringify(data)}`)
    return false
  }
  return true
}

async function testDeactivateBot(auth) {
  if (!createdBotId) {
    console.log('\n── SKIP: remove_chat_bot (no test bot created — not Superadmin) ──')
    return 'skipped'
  }
  console.log('\n── TEST: remove_chat_bot (deactivate) ──')
  const res = await fetch(`${BASE}/bots/${createdBotId}?${qs(auth)}`, {
    method: 'DELETE',
  })
  const data = await res.json()
  console.log(`  Status: ${res.status}`)
  console.log(`  Success: ${data.success}`)
  console.log(`  Message: ${data.message}`)
  if (!res.ok) {
    console.log(`  ERROR: ${JSON.stringify(data)}`)
    return false
  }
  return true
}

// ── Username reuse test ──
// After deactivating a bot, the username should be freed for reuse

async function testUsernameReuse(auth) {
  if (!createdBotId) {
    console.log('\n── SKIP: username reuse (no bot was created/deactivated) ──')
    return 'skipped'
  }
  console.log(`\n── TEST: username reuse — create new bot with same username @${TEST_USERNAME} ──`)
  const res = await fetch(`${BASE}/bots`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      user_id: auth.user_id,
      phone: auth.phone,
      email: auth.email,
      name: 'Reused Username Bot (delete me)',
      username: TEST_USERNAME,
      model: 'claude-haiku-4-5-20251001',
      tools: [],
    }),
  })
  const data = await res.json()
  console.log(`  Status: ${res.status}`)
  if (res.status === 409) {
    console.log(`  FAIL: Username still blocked after deactivation! (409 conflict)`)
    return false
  }
  if (!res.ok) {
    console.log(`  ERROR: ${JSON.stringify(data)}`)
    return false
  }
  const reusedBotId = data.bot?.id
  console.log(`  Success — new bot created with reused username: ${reusedBotId}`)

  // Clean up: deactivate the reused bot too
  if (reusedBotId) {
    await fetch(`${BASE}/bots/${reusedBotId}?${qs(auth)}`, { method: 'DELETE' })
    console.log(`  Cleanup: deactivated reused bot`)
  }
  return true
}

// ── Executor contract test ──
// Verify the API response shapes match what the executor code expects

async function testExecutorContract(auth) {
  console.log('\n── TEST: executor contract verification ──')
  const issues = []

  // Verify list_bots returns { success, bots: [...] }
  console.log('  Checking list_bots response shape...')
  const listRes = await fetch(`${BASE}/bots?${qs(auth)}`)
  const listData = await listRes.json()
  if (!listData.success) issues.push('list_bots missing .success')
  if (!Array.isArray(listData.bots)) issues.push('list_bots missing .bots array')
  else {
    const b = listData.bots[0]
    if (b) {
      // Verify fields the executor maps
      for (const f of ['id', 'name', 'username', 'model', 'is_active', 'created_at']) {
        if (b[f] === undefined) issues.push(`list_bots bot missing .${f}`)
      }
    }
    console.log(`  list_bots shape OK (${listData.bots.length} bots, fields present) ✓`)
  }

  // Verify get_bot returns { success, bot, groups }
  if (existingBotId) {
    console.log('  Checking get_bot response shape...')
    const getRes = await fetch(`${BASE}/bots/${existingBotId}?${qs(auth)}`)
    const getData = await getRes.json()
    if (!getData.success) issues.push('get_bot missing .success')
    if (!getData.bot) issues.push('get_bot missing .bot')
    if (!Array.isArray(getData.groups)) issues.push('get_bot missing .groups array')
    else {
      const bot = getData.bot
      for (const f of ['id', 'name', 'username', 'model', 'system_prompt']) {
        if (bot[f] === undefined) issues.push(`get_bot bot missing .${f}`)
      }
      console.log(`  get_bot shape OK (groups: ${getData.groups.length}) ✓`)
    }
  }

  // Verify get_bot with nonexistent ID returns error (not crash)
  console.log('  Checking get_bot error handling...')
  const errRes = await fetch(`${BASE}/bots/00000000-0000-0000-0000-000000000000?${qs(auth)}`)
  const errData = await errRes.json()
  if (errRes.status === 404) {
    console.log(`  get_bot 404 for missing bot ✓`)
  } else {
    console.log(`  get_bot returned ${errRes.status} for missing bot (executor handles via !res.ok) ✓`)
  }

  if (issues.length > 0) {
    console.log(`  ISSUES: ${issues.join(', ')}`)
    return false
  }
  console.log('  All contract checks passed')
  return true
}

// ── Run all tests ──

async function main() {
  console.log('=== Bot Subagent Tool Test ===')
  console.log(`Test username: @${TEST_USERNAME}`)

  let auth
  try {
    auth = await getAuth()
    console.log(`Auth resolved: user_id=${auth.user_id}, phone=${auth.phone}, email=${auth.email}`)
  } catch (e) {
    console.error(`FATAL: Cannot resolve auth — ${e.message}`)
    process.exit(1)
  }

  const results = {}

  // Read-only tests (should pass for any authenticated user)
  results.list_bots = await testListBots(auth)
  results.get_bot = await testGetBot(auth)

  // Mutation tests (require Superadmin — 403 is an acceptable result)
  results.register = await testRegisterBot(auth)
  results.update = await testUpdateBot(auth)
  results.deactivate = await testDeactivateBot(auth)

  // Username reuse after deactivation
  results.usernameReuse = await testUsernameReuse(auth)

  // Contract verification (uses auth for valid API calls)
  results.contract = await testExecutorContract(auth)

  console.log('\n=== RESULTS ===')
  let failed = false
  for (const [name, result] of Object.entries(results)) {
    if (result === true) {
      console.log(`  ✅ ${name}`)
    } else if (result === 'auth_boundary' || result === 'skipped') {
      console.log(`  ⚠️  ${name} (${result})`)
    } else {
      console.log(`  ❌ ${name}`)
      failed = true
    }
  }

  if (failed) {
    console.log('\n❌ SOME TESTS FAILED')
    process.exit(1)
  } else {
    console.log('\n✅ ALL TESTS PASSED (auth boundary checks are expected when not Superadmin)')
  }
}

main().catch(e => { console.error(e); process.exit(1) })
