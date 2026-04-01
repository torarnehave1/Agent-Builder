const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const BASE_URL = 'https://models.inference.ai.azure.com';

if (!GITHUB_TOKEN) {
  console.error('Run: GITHUB_TOKEN=ghp_yourtoken node test-github-models.js');
  process.exit(1);
}

async function listModels() {
  console.log('\n📋 Listing models...\n');
  const res = await fetch(`${BASE_URL}/models`, {
    headers: { Authorization: `Bearer ${GITHUB_TOKEN}` },
  });
  if (!res.ok) { console.error(`❌ ${res.status}`, await res.text()); return; }
  const data = await res.json();
  const models = Array.isArray(data) ? data : (data.data || []);
  models.forEach(m => {
    const id = m.id || m.name || JSON.stringify(m);
    const tag = id.toLowerCase().includes('haiku') ? ' ← HAIKU ✅' : '';
    const c   = id.toLowerCase().includes('claude') ? ' [Claude]' : '';
    console.log(`  ${id}${c}${tag}`);
  });
}

async function testChat(modelId) {
  console.log(`\n💬 Testing: ${modelId}`);
  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: modelId,
      messages: [{ role: 'user', content: 'Reply with exactly: "GitHub Models works!"' }],
      max_tokens: 20,
    }),
  });
  if (!res.ok) { console.error(`❌ ${res.status}`, await res.text()); return false; }
  const data = await res.json();
  console.log(`✅  "${data.choices?.[0]?.message?.content}" | tokens: ${data.usage?.total_tokens}`);
  return true;
}

async function main() {
  console.log(`🔑 Token: ${GITHUB_TOKEN.slice(0, 8)}...`);
  await listModels().catch(e => console.error('List error:', e.message));
  for (const model of ['claude-3-5-haiku', 'claude-3-haiku-20241022', 'gpt-4o-mini']) {
    if (await testChat(model).catch(() => false)) break;
  }
}

main().catch(console.error);
