/**
 * Checklist / Task-List Template for Vegvisr Agent Builder
 *
 * Renders every "- [ ] text" / "- [x] text" line found across the graph's nodes as a
 * checkbox, grouped by the node it came from. Toggling a box saves back through
 * window.vegvisrPatchNode — the ONLY save path that is authenticated and works both in
 * the builder preview and on a published *.vegvisr.org / custom domain. See the
 * "SAVING data from an HTML app back to a node (patchNode) — CANONICAL" section of
 * system-prompt.js: a raw fetch to /patchNode from inside an html-node 401s outside the
 * logged-in builder session. Never replace vegvisrPatchNode with a hand-rolled fetch.
 *
 * Placeholders:
 *   {{TITLE}}            - Page title (header + <title>)
 *   {{DESCRIPTION}}       - Subtitle shown under the title
 *   {{GRAPH_ID_DEFAULT}} - Fallback graph ID
 */

export const CHECKLIST_TEMPLATE = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1.0" />
  <meta name="template-version" content="1.0.1" />
  <meta name="template-id" content="checklist" />
  <title>{{TITLE}}</title>

  <style>
    :root {
      --bg1: #0b1220;
      --bg2: #111827;
      --text: #fff;
      --muted: rgba(255,255,255,0.72);
      --soft: rgba(255,255,255,0.58);
      --accent: #38bdf8;
      --accent2: #8b5cf6;
      --card-bg: rgba(255,255,255,0.06);
      --card-border: rgba(255,255,255,0.12);
      --line: rgba(255,255,255,0.12);
      --radius: 14px;
    }
    * { box-sizing: border-box; }
    body {
      font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Arial;
      max-width: 800px;
      margin: 40px auto;
      padding: 0 20px 60px;
      background: var(--bg1);
      color: var(--text);
      background-image:
        radial-gradient(circle at top, color-mix(in srgb, var(--accent) 20%, transparent), transparent 55%),
        radial-gradient(circle at bottom, color-mix(in srgb, var(--accent2) 18%, transparent), transparent 55%);
      background-attachment: fixed;
    }
    .header {
      background: linear-gradient(135deg, var(--bg2), color-mix(in srgb, var(--accent2) 25%, var(--bg2)));
      border: 1px solid var(--card-border);
      color: var(--text);
      padding: 24px;
      border-radius: var(--radius);
      margin-bottom: 20px;
    }
    .header h1 { margin: 0 0 6px; font-size: 1.6rem; }
    .header p { margin: 0; color: var(--muted); }
    .stats { display: flex; gap: 16px; margin-top: 16px; font-size: 0.9rem; color: var(--soft); }
    .auth-row { margin-bottom: 20px; }
    .task-section {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: var(--radius);
      padding: 20px;
      margin-bottom: 20px;
    }
    .section-title {
      font-size: 1.05rem;
      font-weight: 600;
      color: var(--accent);
      margin-bottom: 12px;
      padding-bottom: 8px;
      border-bottom: 1px solid var(--line);
    }
    .task-item {
      display: flex;
      align-items: center;
      padding: 10px 12px;
      margin: 6px 0;
      background: rgba(255,255,255,0.03);
      border-radius: 8px;
      transition: opacity 0.2s;
    }
    .task-item.completed { opacity: 0.6; }
    .task-checkbox {
      width: 20px;
      height: 20px;
      margin-right: 12px;
      cursor: pointer;
      accent-color: var(--accent);
      flex-shrink: 0;
    }
    .task-text { flex: 1; font-size: 0.95rem; color: var(--text); }
    .task-item.completed .task-text { text-decoration: line-through; color: var(--soft); }
    .loading, .empty { text-align: center; padding: 40px; color: var(--soft); }
    .error-box { color: #fca5a5; padding: 16px; border: 1px solid rgba(252,165,165,0.3); border-radius: var(--radius); }
  </style>
</head>
<body>
  <div class="header">
    <h1>{{TITLE}}</h1>
    <p>{{DESCRIPTION}}</p>
    <div class="stats">
      <span id="total">Totalt: 0</span>
      <span id="completed">Fullført: 0</span>
      <span id="remaining">Gjenstår: 0</span>
    </div>
  </div>

  <div class="auth-row">
    <vegvisr-auth></vegvisr-auth>
  </div>

  <div id="task-container">
    <div class="loading">Laster oppgaver...</div>
  </div>

  <script src="https://api.vegvisr.org/components/vegvisr-auth.js" defer><\/script>
  <script>
    function getGraphId() {
      if (window.__VEGVISR_GRAPH_ID) return window.__VEGVISR_GRAPH_ID;
      var injected = '{{GRAPH_ID_DEFAULT}}';
      if (injected && !injected.includes('{{')) return injected;
      var urlGraphId = new URLSearchParams(window.location.search).get('graph');
      if (urlGraphId) return urlGraphId;
      return null;
    }

    const GRAPH_ID = getGraphId();
    const KG_API = 'https://knowledge.vegvisr.org';

    let tasks = [];

    async function fetchGraph() {
      const res = await fetch(\`\${KG_API}/getknowgraph?id=\${GRAPH_ID}\`);
      if (!res.ok) throw new Error('Kunne ikke hente graf (' + res.status + ')');
      return await res.json();
    }

    // Matches "- [ ] text" / "- [x] text" (case-insensitive check mark) in any node's info.
    function parseTasksFromNodes(nodes) {
      const parsed = [];
      (nodes || []).forEach(node => {
        if (!node.info) return;
        const lines = node.info.split('\\n');
        lines.forEach((line, index) => {
          const unchecked = line.match(/^-\\s?\\[\\s\\]\\s(.+)$/);
          const checked = line.match(/^-\\s?\\[[xX]\\]\\s(.+)$/);
          if (unchecked || checked) {
            parsed.push({
              nodeId: node.id,
              nodeLabel: node.label,
              lineIndex: index,
              text: (unchecked || checked)[1].trim(),
              completed: !!checked,
              id: \`\${node.id}-\${index}\`
            });
          }
        });
      });
      return parsed;
    }

    // The ONLY correct save path — see system-prompt.js "SAVING data from an HTML app
    // back to a node (patchNode) — CANONICAL". Do NOT replace with a raw fetch to
    // /patchNode: that 401s outside an authenticated builder preview session.
    async function updateNodeTask(nodeId, lineIndex, newLine) {
      const res = await fetch(\`\${KG_API}/getknowgraph?id=\${GRAPH_ID}&nodeId=\${nodeId}\`);
      if (!res.ok) throw new Error('Kunne ikke hente node (' + res.status + ')');

      const data = await res.json();
      const node = data.nodes?.[0];
      if (!node || !node.info) throw new Error('Node ikke funnet');

      const lines = node.info.split('\\n');
      lines[lineIndex] = newLine;
      const newInfo = lines.join('\\n');

      if (typeof window.vegvisrPatchNode !== 'function') {
        throw new Error('Ikke i en autentisert Vegvisr-kontekst — åpne siden i builderen eller pålogget for å lagre.');
      }
      // Pass GRAPH_ID explicitly — window.__VEGVISR_GRAPH_ID (vegvisrPatchNode's own
      // fallback) is only set on a direct publish, not when this node is rendered
      // embedded inside another viewer (e.g. gnew-viewer's node list).
      return await window.vegvisrPatchNode(nodeId, { info: newInfo }, GRAPH_ID);
    }

    function renderTasks() {
      const container = document.getElementById('task-container');
      container.innerHTML = '';

      if (tasks.length === 0) {
        container.innerHTML = '<div class="empty">Ingen oppgaver funnet. Legg til linjer som "- [ ] Oppgavetekst" i en node.</div>';
        updateStats();
        return;
      }

      const grouped = {};
      tasks.forEach(task => {
        if (!grouped[task.nodeLabel]) grouped[task.nodeLabel] = [];
        grouped[task.nodeLabel].push(task);
      });

      Object.keys(grouped).forEach(section => {
        const sectionDiv = document.createElement('div');
        sectionDiv.className = 'task-section';

        const title = document.createElement('div');
        title.className = 'section-title';
        title.textContent = section;
        sectionDiv.appendChild(title);

        grouped[section].forEach(task => {
          const item = document.createElement('div');
          item.className = \`task-item \${task.completed ? 'completed' : ''}\`;
          item.innerHTML = \`
            <input type="checkbox" class="task-checkbox" \${task.completed ? 'checked' : ''}>
            <span class="task-text"></span>
          \`;
          item.querySelector('.task-text').textContent = task.text;

          const checkbox = item.querySelector('.task-checkbox');
          checkbox.addEventListener('change', async () => {
            const newCompleted = checkbox.checked;
            const newLine = newCompleted ? \`- [x] \${task.text}\` : \`- [ ] \${task.text}\`;

            item.style.opacity = '0.4';
            checkbox.disabled = true;

            try {
              await updateNodeTask(task.nodeId, task.lineIndex, newLine);
              task.completed = newCompleted;
              item.classList.toggle('completed', newCompleted);
              updateStats();
            } catch (err) {
              alert('Feil ved oppdatering: ' + err.message);
              checkbox.checked = !newCompleted;
            } finally {
              item.style.opacity = '1';
              checkbox.disabled = false;
            }
          });

          sectionDiv.appendChild(item);
        });

        container.appendChild(sectionDiv);
      });

      updateStats();
    }

    function updateStats() {
      const total = tasks.length;
      const completed = tasks.filter(t => t.completed).length;
      document.getElementById('total').textContent = \`Totalt: \${total}\`;
      document.getElementById('completed').textContent = \`Fullført: \${completed}\`;
      document.getElementById('remaining').textContent = \`Gjenstår: \${total - completed}\`;
    }

    async function init() {
      if (!GRAPH_ID) {
        document.getElementById('task-container').innerHTML =
          '<div class="error-box">Ingen graphId funnet. Åpne siden via graf-vieweren eller legg til ?graph=&lt;id&gt; i URL-en.</div>';
        return;
      }
      try {
        const graphData = await fetchGraph();
        tasks = parseTasksFromNodes(graphData.nodes || []);
        renderTasks();
      } catch (err) {
        document.getElementById('task-container').innerHTML =
          \`<div class="error-box">Feil: \${err.message}</div>\`;
      }
    }

    init();
  <\/script>
</body>
</html>`
