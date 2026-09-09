// Organizational network analysis over the chat data.
//
// Two node types, two edge types — a two-mode (bipartite) affiliation network:
//   people  --posts-in-->  topics        (every message is an edge; abundant)
//   people  --replies/reacts-->  people  (chosen acts; sparse but meaningful)
//
// Read-only over CHAT_DB. Nothing here writes.
//
// SCOPE: system owner only. Hiding the tab is not access control — the gate that
// matters is on the route, because this maps relationships between identifiable
// people inferred from their behaviour, not from anything they declared.

// Authors that are not people. Bots, the Instagram relay's system notices, and
// Instagram participants (who never consented to being in an org chart).
const NON_PERSON_PREFIXES = ["bot:", "system:", "ig:"]
const notAPerson = (col) =>
  NON_PERSON_PREFIXES.map((p) => `${col} NOT LIKE '${p}%'`).join(' AND ')

// Person <-> topic. A topic with one participant carries no shared-interest
// signal, but IS a real statement about that person's interests — so solo
// topics are kept and flagged rather than filtered out.
export async function affiliationEdges(env) {
  const { results } = await env.CHAT_DB.prepare(`
    SELECT g.id AS topic_id, g.name AS topic, m.user_id AS person, COUNT(*) AS weight
    FROM group_messages m
    JOIN groups g ON m.group_id = g.id
    WHERE ${notAPerson('m.user_id')}
    GROUP BY g.id, m.user_id
    HAVING weight >= 2
  `).all()
  return results || []
}

// Person -> person, from replies and reactions. Self-loops removed: replying to
// yourself is not a relationship.
export async function interactionEdges(env) {
  const { results } = await env.CHAT_DB.prepare(`
    SELECT 'reply' AS kind, m.user_id AS src, p.user_id AS dst, COUNT(*) AS weight
    FROM group_messages m
    JOIN group_messages p ON m.reply_to_id = p.id
    WHERE m.user_id <> p.user_id AND ${notAPerson('m.user_id')} AND ${notAPerson('p.user_id')}
    GROUP BY src, dst
    UNION ALL
    SELECT 'react' AS kind, r.user_id AS src, m.user_id AS dst, COUNT(*) AS weight
    FROM message_reactions r
    JOIN group_messages m ON r.message_id = m.id
    WHERE r.user_id <> m.user_id AND ${notAPerson('r.user_id')} AND ${notAPerson('m.user_id')}
    GROUP BY src, dst
  `).all()
  return results || []
}

// Assembles both edge sets into one graph, with the centrality measures ONA
// actually uses. Degree only — betweenness and closeness need a full traversal
// and would be noise at this density anyway.
export function buildNetwork(affiliations, interactions) {
  const topics = new Map()
  const people = new Map()

  const person = (id) => {
    if (!people.has(id)) {
      people.set(id, { id, kind: 'person', messages: 0, topics: 0, outDegree: 0, inDegree: 0 })
    }
    return people.get(id)
  }

  for (const a of affiliations) {
    if (!topics.has(a.topic_id)) {
      topics.set(a.topic_id, { id: a.topic_id, kind: 'topic', label: a.topic, messages: 0, participants: 0 })
    }
    const t = topics.get(a.topic_id)
    t.messages += a.weight
    t.participants += 1
    const p = person(a.person)
    p.messages += a.weight
    p.topics += 1
  }

  // A topic only carries shared-interest signal with two or more participants.
  // Solo topics stay in the graph, flagged — they are the interests a
  // person-to-person view would silently discard.
  for (const t of topics.values()) t.shared = t.participants >= 2

  for (const e of interactions) {
    person(e.src).outDegree += e.weight
    person(e.dst).inDegree += e.weight
  }

  const affiliationEdgeList = affiliations.map((a) => ({
    source: a.person, target: a.topic_id, kind: 'affiliation', weight: a.weight,
  }))
  const interactionEdgeList = interactions.map((e) => ({
    source: e.src, target: e.dst, kind: e.kind, weight: e.weight,
  }))

  const nodes = [...people.values(), ...topics.values()]
  const edges = [...affiliationEdgeList, ...interactionEdgeList]

  // Density over the person-to-person layer only; the bipartite layer has a
  // different denominator and mixing them would be meaningless.
  const n = people.size
  const possible = n * (n - 1)
  const directedPairs = new Set(interactions.map((e) => `${e.src}|${e.dst}`)).size

  return {
    nodes,
    edges,
    stats: {
      people: people.size,
      topics: topics.size,
      sharedTopics: [...topics.values()].filter((t) => t.shared).length,
      soloTopics: [...topics.values()].filter((t) => !t.shared).length,
      interactionPairs: directedPairs,
      density: possible ? Number((directedPairs / possible).toFixed(3)) : 0,
    },
  }
}
