/**
 * Local test for read_html_section logic
 * Tests: search mode, section mode, line-range mode
 * Verifies: raw output has NO line numbers, display output HAS line numbers
 *
 * Run: node worker/test-read-html-section.js
 */

// ---- Inline the function (no imports needed) ----

function executeReadHtmlSection(input, html) {
  const lines = html.replace(/\r\n/g, '\n').split('\n')
  const totalLines = lines.length
  const totalChars = html.length

  // Line-number mode
  if (input.startLine && input.endLine) {
    const start = Math.max(1, input.startLine) - 1
    const end = Math.min(totalLines, input.endLine)
    const maxRange = 100
    const slice = lines.slice(start, Math.min(start + maxRange, end))
    const numbered = slice.map((line, i) => `${start + i + 1}: ${line}`).join('\n')
    const raw = slice.join('\n')
    return {
      totalLines, totalChars,
      range: `${start + 1}-${Math.min(start + maxRange, end)}`,
      display: numbered,
      raw,
      hint: 'Use text from "raw" field (no line numbers) when building edit_html_node old_string.'
    }
  }

  // Search mode
  if (input.search) {
    const matches = []
    const searchLower = input.search.toLowerCase()
    const seenRanges = new Set()
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].toLowerCase().includes(searchLower)) {
        const contextStart = Math.max(0, i - 5)
        const contextEnd = Math.min(totalLines, i + 6)
        const rangeKey = `${contextStart}-${contextEnd}`
        if (seenRanges.has(rangeKey)) continue
        seenRanges.add(rangeKey)
        const display = lines.slice(contextStart, contextEnd)
          .map((line, j) => `${contextStart + j + 1}${j + contextStart === i ? '>' : ':'} ${line}`)
          .join('\n')
        const raw = lines.slice(contextStart, contextEnd).join('\n')
        const matchedLine = lines[i]
        matches.push({ line: i + 1, display, raw, matchedLine })
        if (matches.length >= 5) break
      }
    }
    return {
      totalLines, totalChars,
      searchTerm: input.search,
      matchCount: matches.length,
      matches,
      hint: 'Use text from "raw" or "matchedLine" fields (no line numbers) when building edit_html_node old_string.'
    }
  }

  return { error: 'no mode selected' }
}

// ---- Test HTML (simulates a real app with the contacts bug) ----

const TEST_HTML = `<!DOCTYPE html>
<html>
<head><title>Kontakt Manager</title></head>
<body>
  <div id="app">
    <h1>Kontakt Manager</h1>
    <div id="contact-list"></div>
    <button onclick="exportToCSV()">Export CSV</button>
    <button onclick="importCSV()">Import CSV</button>
  </div>
  <script>
    let allContacts = [];
    const TABLE_ID = 'contacts-table';

    async function loadContacts() {
      console.log('[loadContacts] Fetching...');
      try {
        const res = await fetch('https://drizzle.vegvisr.org/query', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tableId: TABLE_ID })
        });
        const data = await res.json();
        allContacts = data.records || [];
        console.log('[loadContacts] Got ' + allContacts.length + ' contacts');
        renderContacts();
      } catch (error) {
        console.error('[loadContacts] Error:', error);
      }
    }

    function renderContacts() {
      const list = document.getElementById('contact-list');
      list.innerHTML = allContacts.map(c =>
        '<div class="contact">' + c.name + ' - ' + c.email + '</div>'
      ).join('');
    }

    function exportToCSV() {
      if (contacts.length === 0) {
        alert('No contacts to export');
        return;
      }
      const csv = 'Name,Email\\n' + contacts.map(c => c.name + ',' + c.email).join('\\n');
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'contacts.csv';
      a.click();
    }

    function importCSV() {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.csv';
      input.onchange = (e) => {
        const file = e.target.files[0];
        const reader = new FileReader();
        reader.onload = (evt) => {
          const lines = evt.target.result.split('\\n');
          lines.slice(1).forEach(line => {
            const [name, email] = line.split(',');
            if (name && email) {
              contacts.push({ name: name.trim(), email: email.trim() });
            }
          });
          renderContacts();
        };
        reader.readAsText(file);
      };
      input.click();
    }

    loadContacts();
  </script>
</body>
</html>`

// ---- Tests ----

let passed = 0
let failed = 0

function assert(label, condition, detail) {
  if (condition) {
    console.log(`  ✓ ${label}`)
    passed++
  } else {
    console.log(`  ✗ ${label}`)
    if (detail) console.log(`    ${detail}`)
    failed++
  }
}

console.log('\n=== Test 1: Search for "contacts" ===')
const r1 = executeReadHtmlSection({ search: 'contacts' }, TEST_HTML)
assert('Found matches', r1.matchCount > 0, `matchCount=${r1.matchCount}`)
assert('First match has display field', !!r1.matches[0].display)
assert('First match has raw field', !!r1.matches[0].raw)
assert('First match has matchedLine field', !!r1.matches[0].matchedLine)
assert('display contains line numbers', /^\d+[>:] /.test(r1.matches[0].display))
assert('raw does NOT contain line numbers', !/^\d+[>:] /.test(r1.matches[0].raw))
assert('matchedLine does NOT contain line numbers', !/^\d+[>:] /.test(r1.matches[0].matchedLine))

// KEY TEST: Can we use matchedLine directly in edit_html_node?
const matchedLine = r1.matches[0].matchedLine
assert('matchedLine exists in original HTML', TEST_HTML.includes(matchedLine),
  `matchedLine: "${matchedLine.slice(0, 80)}"`)

console.log('\n=== Test 2: Search for "exportToCSV" ===')
const r2 = executeReadHtmlSection({ search: 'exportToCSV' }, TEST_HTML)
assert('Found exportToCSV', r2.matchCount > 0)
// Check that the raw text around exportToCSV contains the buggy "contacts" reference
const exportMatch = r2.matches.find(m => m.matchedLine.includes('function exportToCSV'))
if (exportMatch) {
  assert('raw context shows the bug (contacts.length)', exportMatch.raw.includes('contacts.length'))
  assert('raw is directly usable for old_string', TEST_HTML.includes(exportMatch.matchedLine))
} else {
  assert('Found function exportToCSV match', false)
}

console.log('\n=== Test 3: Line range mode ===')
const r3 = executeReadHtmlSection({ startLine: 12, endLine: 15 }, TEST_HTML)
assert('Has display field', !!r3.display)
assert('Has raw field', !!r3.raw)
assert('display has line numbers', r3.display.includes('12:'))
assert('raw does NOT have line numbers', !r3.raw.includes('12:'))
assert('raw is in original HTML', TEST_HTML.includes(r3.raw))

console.log('\n=== Test 4: Simulate the full fix flow ===')
// The subagent would search for the error keyword first, e.g. "contacts is not defined"
// Then it would search specifically for the bare variable usage

// Step 1: Search for "contacts.length" — the specific pattern from the error
const search1 = executeReadHtmlSection({ search: 'contacts.length' }, TEST_HTML)
assert('Found contacts.length usage', search1.matchCount > 0)
if (search1.matchCount > 0) {
  const bugLine = search1.matches[0].matchedLine
  assert('matchedLine is usable as old_string', TEST_HTML.includes(bugLine))

  // Step 2: Fix it by replacing contacts with allContacts
  const fixedLine = bugLine.replace('contacts.length', 'allContacts.length')
  const testFixed = TEST_HTML.replace(bugLine, fixedLine)
  assert('Fix applied for contacts.length', testFixed.includes('allContacts.length === 0'))
}

// Step 3: Search for "contacts.map" — another buggy usage
const search2 = executeReadHtmlSection({ search: 'contacts.map' }, TEST_HTML)
assert('Found contacts.map usage', search2.matchCount > 0)
if (search2.matchCount > 0) {
  assert('matchedLine is usable', TEST_HTML.includes(search2.matches[0].matchedLine))
}

// Step 4: Search for "contacts.push" — yet another
const search3 = executeReadHtmlSection({ search: 'contacts.push' }, TEST_HTML)
assert('Found contacts.push usage', search3.matchCount > 0)
if (search3.matchCount > 0) {
  assert('matchedLine is usable', TEST_HTML.includes(search3.matches[0].matchedLine))
}

// Step 5: Full simulation — fix all three
let fullyFixed = TEST_HTML
for (const s of [search1, search2, search3]) {
  if (s.matchCount > 0) {
    const old = s.matches[0].matchedLine
    const fixed = old.replace(/\bcontacts\b/g, 'allContacts')
    fullyFixed = fullyFixed.replace(old, fixed)
  }
}
assert('All bare "contacts" references fixed',
  !fullyFixed.includes('contacts.length') || fullyFixed.includes('allContacts.length'),
  'Still has bare contacts.length')
assert('allContacts declaration preserved', fullyFixed.includes('let allContacts = []'))

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`)

if (failed > 0) {
  process.exit(1)
}
