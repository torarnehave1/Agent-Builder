// Syntax scan for the <script> blocks of an html-node. Pure, no imports, no runtime deps — so
// test-html-syntax.mjs drives exactly what the worker runs.
//
// It replaces a checker that produced a false error on EVERY script and cost a full day on
// 2026-09-11. Two sources:
//   1. `new Function(scriptSource)` as a "full JS syntax check". Cloudflare Workers disallow code
//      generation from strings, so that call ALWAYS throws there and every script was reported as
//      "JavaScript syntax error … Code generation from strings disallowed". The agent believed it,
//      hunted a syntax error that did not exist, and in one live run rolled the node back to a
//      version from before it had installed the verified component — undoing its own good work.
//   2. The bracket scanner did not understand REGEX LITERALS, so a character class like
//      /[-\/\\^$*+?.()|[\]{}]/g read as unbalanced brackets ("Mismatched '}'").
//
// Now: regex literals are parsed, the parser check only reports a REAL SyntaxError (and says
// "unavailable" where the runtime forbids it), and scripts inside a registry component block are
// skipped entirely — that code is browser-verified and belongs to insert_component, not to a repair
// loop.

const OWNED_BLOCK_RE = /<!-- vegvisr-component:([a-z0-9-]+):start -->([\s\S]*?)<!-- vegvisr-component:\1:end -->/g

export function ownedBlockRanges(html) {
  const ranges = []
  const re = new RegExp(OWNED_BLOCK_RE.source, 'g')
  let m
  while ((m = re.exec(String(html || ''))) !== null) ranges.push({ name: m[1], start: m.index, end: m.index + m[0].length })
  return ranges
}

// A '/' starts a regex literal only where a VALUE may start. After an identifier, a number, or a
// closing ) ] } it is division. This is the standard heuristic and it is enough for page scripts.
function regexCanStartHere(prevSignificant) {
  if (!prevSignificant) return true
  return !/[A-Za-z0-9_$)\]}'"`]/.test(prevSignificant)
}

export function scanScript(source, startLine = 1) {
  const issues = []
  const lines = String(source).split('\n')
  const stack = []
  let inSingle = false, inDouble = false, inTemplate = false, inLine = false, inBlock = false, inRegex = false, inClass = false
  let prevSignificant = ''

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const absLine = startLine + i
    inLine = false
    for (let col = 0; col < line.length; col++) {
      const ch = line[col]
      const next = col + 1 < line.length ? line[col + 1] : ''
      const escaped = col > 0 && line[col - 1] === '\\' && !(col > 1 && line[col - 2] === '\\')

      if (inBlock) { if (ch === '*' && next === '/') { inBlock = false; col++ } continue }
      if (inLine) continue
      if (inSingle) { if (ch === "'" && !escaped) inSingle = false; continue }
      if (inDouble) { if (ch === '"' && !escaped) inDouble = false; continue }
      if (inTemplate) { if (ch === '`' && !escaped) inTemplate = false; continue }
      if (inRegex) {
        if (escaped) continue
        if (inClass) { if (ch === ']') inClass = false; continue }
        if (ch === '[') { inClass = true; continue }
        if (ch === '/') { inRegex = false; prevSignificant = '/' }
        continue
      }

      if (ch === '/' && next === '/') { inLine = true; break }
      if (ch === '/' && next === '*') { inBlock = true; col++; continue }
      if (ch === '/' && regexCanStartHere(prevSignificant)) { inRegex = true; inClass = false; continue }
      if (ch === "'") { inSingle = true; prevSignificant = ch; continue }
      if (ch === '"') { inDouble = true; prevSignificant = ch; continue }
      if (ch === '`') { inTemplate = true; prevSignificant = ch; continue }

      if (ch === '{' || ch === '(' || ch === '[') stack.push({ char: ch, line: absLine })
      else if (ch === '}' || ch === ')' || ch === ']') {
        const opener = ch === '}' ? '{' : ch === ')' ? '(' : '['
        const closer = ch
        if (stack.length === 0) {
          issues.push({ type: 'unexpected_closing', line: absLine, message: `Unexpected '${closer}' at line ${absLine} — no matching '${opener}' is open`, context: `${absLine}: ${line.trim()}` })
        } else if (stack[stack.length - 1].char !== opener) {
          const top = stack[stack.length - 1]
          issues.push({ type: 'mismatch', line: absLine, openedAt: top.line, message: `Mismatched '${closer}' at line ${absLine} — expected the closer for '${top.char}' opened at line ${top.line}`, context: `${absLine}: ${line.trim()}` })
        } else stack.pop()
      }
      if (!/\s/.test(ch)) prevSignificant = ch
    }
  }

  for (const unclosed of stack) {
    const closer = unclosed.char === '{' ? '}' : unclosed.char === '(' ? ')' : ']'
    issues.push({ type: 'unclosed', line: unclosed.line, message: `Unclosed '${unclosed.char}' opened at line ${unclosed.line} — missing '${closer}'`, context: `${unclosed.line}: ${(lines[unclosed.line - startLine] || '').trim()}` })
  }
  if (inBlock) issues.push({ type: 'unclosed_comment', message: 'Unclosed block comment /* … */' })
  if (inTemplate) issues.push({ type: 'unclosed_template', message: 'Unclosed template literal `…`' })
  if (inSingle || inDouble) issues.push({ type: 'unclosed_string', message: 'Unclosed string literal' })

  // Parser check — only where the runtime allows it. A runtime that forbids code generation from
  // strings (Cloudflare Workers) says NOTHING about this script, so it must not produce an issue.
  let parser = 'ok'
  if (issues.length === 0) {
    try {
      // eslint-disable-next-line no-new-func
      new Function(String(source))
    } catch (err) {
      const msg = String((err && err.message) || err)
      if (/code generation from strings|eval|unsafe-eval|CSP/i.test(msg)) parser = 'unavailable'
      else issues.push({ type: 'js_syntax_error', line: startLine, message: `JavaScript syntax error in the script starting at line ${startLine}: ${msg}` })
    }
  } else {
    parser = 'skipped'
  }
  return { issues, parser }
}

export function scanHtmlSyntax(html) {
  const text = String(html || '').replace(/\r\n/g, '\n')
  const owned = ownedBlockRanges(text)
  const inOwned = idx => owned.some(r => idx >= r.start && idx < r.end)
  const re = /<script([^>]*)>([\s\S]*?)<\/script>/gi
  const issues = []
  let checked = 0, skippedOwned = 0, externals = 0, parserUnavailable = false
  let m
  while ((m = re.exec(text)) !== null) {
    if (/\ssrc\s*=/i.test(m[1])) { externals += 1; continue }
    if (inOwned(m.index)) { skippedOwned += 1; continue }
    const startLine = text.slice(0, m.index).split('\n').length
    const r = scanScript(m[2], startLine)
    if (r.parser === 'unavailable') parserUnavailable = true
    checked += 1
    issues.push(...r.issues)
  }
  const note = skippedOwned
    ? ` ${skippedOwned} script(s) inside a registry component block were not scanned — that code is browser-verified and owned by insert_component; do not edit it on the page.`
    : ''
  return {
    valid: issues.length === 0,
    issueCount: issues.length,
    issues: issues.slice(0, 10),
    scriptBlocks: checked,
    skippedOwnedBlocks: skippedOwned,
    externalScripts: externals,
    parserAvailable: !parserUnavailable,
    totalLines: text.split('\n').length,
    message: issues.length === 0
      ? `Brackets, strings and regex literals balanced in ${checked} script block(s).${note}${parserUnavailable ? ' (Full JS parse is not available in this runtime, so only the structural scan ran.)' : ''}`
      : `Found ${issues.length} syntax issue(s). Fix the FIRST one — later errors are usually caused by it.${note}`,
  }
}
