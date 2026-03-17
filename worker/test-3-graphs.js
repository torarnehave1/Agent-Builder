/**
 * Test: Create 3 separate graphs via agent endpoint
 * Verifies that the graphId auto-injection fix works correctly —
 * each "create new graph" request should produce a DIFFERENT graph.
 */

const AGENT_URL = 'https://agent.vegvisr.org/chat'

async function parseSSE(response) {
  const text = await response.text()
  const lines = text.split('\n')
  const events = []
  let currentEvent = null

  for (const line of lines) {
    if (line.startsWith('event: ')) {
      currentEvent = { type: line.slice(7) }
    } else if (line.startsWith('data: ') && currentEvent) {
      try {
        currentEvent.data = JSON.parse(line.slice(6))
      } catch {
        currentEvent.data = line.slice(6)
      }
      events.push(currentEvent)
      currentEvent = null
    }
  }
  return events
}

async function createGraph(name, index) {
  console.log(`\n--- Creating graph ${index}: "${name}" ---`)

  const res = await fetch(AGENT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [
        {
          role: 'user',
          content: `Create a new knowledge graph called "${name}". Add one fulltext node with the text "This is test graph number ${index}". Do NOT reuse any existing graph — create a brand new one.`
        }
      ],
      userId: 'test-user-graph-creation',
      model: 'claude-haiku-4-5-20251001'
    })
  })

  if (!res.ok) {
    console.error(`  HTTP ${res.status}: ${await res.text()}`)
    return null
  }

  const events = await parseSSE(res)

  // Find graphId from tool_result events
  let graphId = null
  for (const ev of events) {
    if (ev.type === 'tool_result' && ev.data?.graphId) {
      graphId = ev.data.graphId
    }
    if (ev.type === 'tool_call') {
      console.log(`  Tool call: ${ev.data?.tool} → input keys: [${Object.keys(ev.data?.input || {}).join(', ')}]`)
      if (ev.data?.input?.graphId) {
        console.log(`    graphId in input: ${ev.data.input.graphId}`)
      }
    }
    if (ev.type === 'tool_result') {
      console.log(`  Tool result: ${ev.data?.tool} → ${ev.data?.summary?.slice(0, 100)}`)
      if (ev.data?.graphId) console.log(`    graphId: ${ev.data.graphId}`)
    }
  }

  // Also check text events for any graphId mention
  const textEvents = events.filter(e => e.type === 'text')
  const fullText = textEvents.map(e => typeof e.data?.content === 'string' ? e.data.content : '').join('')
  if (fullText) console.log(`  Response: ${fullText.slice(0, 200)}`)

  console.log(`  → Graph ID: ${graphId || 'NOT FOUND IN EVENTS'}`)
  return graphId
}

async function main() {
  console.log('=== Testing 3 graph creations (should produce 3 DIFFERENT graph IDs) ===\n')

  const ids = []
  for (let i = 1; i <= 3; i++) {
    const id = await createGraph(`Test Graph ${i} - ${Date.now()}`, i)
    ids.push(id)
  }

  console.log('\n=== RESULTS ===')
  console.log('Graph IDs:', ids)

  const unique = new Set(ids.filter(Boolean))
  if (unique.size === 3) {
    console.log('✅ PASS: All 3 graphs have unique IDs')
  } else if (unique.size === 0) {
    console.log('⚠️  No graph IDs were captured from SSE events (check event format)')
  } else {
    console.log(`❌ FAIL: Only ${unique.size} unique IDs out of 3 — graphId auto-injection bug may still exist`)
  }

  // Verify graphs exist
  console.log('\n--- Verifying graphs exist ---')
  for (const id of ids) {
    if (!id) { console.log('  Skipped (no ID)'); continue }
    try {
      const res = await fetch(`https://knowledge.vegvisr.org/getknowgraph?id=${id}`)
      const data = await res.json()
      const nodeCount = data.nodes?.length || 0
      console.log(`  ${id}: ${nodeCount} nodes, title="${data.metadata?.title || 'untitled'}"`)
    } catch (err) {
      console.log(`  ${id}: ERROR - ${err.message}`)
    }
  }

  // Cleanup: delete test graphs
  console.log('\n--- Cleaning up test graphs ---')
  for (const id of ids) {
    if (!id) continue
    try {
      await fetch('https://knowledge.vegvisr.org/deleteknowgraph', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ graphId: id })
      })
      console.log(`  Deleted ${id}`)
    } catch (err) {
      console.log(`  Failed to delete ${id}: ${err.message}`)
    }
  }
}

main().catch(console.error)
