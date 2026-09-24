// Pretty-print HTML for READING ONLY. The formatted text is never what gets saved: the panel keeps
// the original bytes and the save button writes those, because reformatting a page would rewrite
// every byte of a 3.4 MB node for a cosmetic reason and make every later diff useless.
//
// Contents of script/style/pre/textarea are left exactly as they are — breaking lines inside a
// script would show the reader something the page does not contain.
export const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const OPAQUE_TAGS = 'script|style|pre|textarea';

export function formatHtmlForReading(html: string): string {
  // Cut the document into opaque blocks (kept verbatim) and everything else (formatted).
  const parts: { text: string; opaque: boolean }[] = [];
  const opaque = new RegExp(`<(${OPAQUE_TAGS})\\b[^>]*>[\\s\\S]*?</\\1\\s*>`, 'gi');
  let last = 0;
  for (let m = opaque.exec(html); m; m = opaque.exec(html)) {
    if (m.index > last) parts.push({ text: html.slice(last, m.index), opaque: false });
    parts.push({ text: m[0], opaque: true });
    last = m.index + m[0].length;
  }
  if (last < html.length) parts.push({ text: html.slice(last), opaque: false });

  const out: string[] = [];
  let depth = 0;
  const pad = () => '  '.repeat(Math.max(0, depth));
  for (const part of parts) {
    if (part.opaque) { out.push('\n' + pad() + part.text); continue; }
    // One token per tag or text run.
    for (const token of part.text.split(/(<[^>]+>)/g)) {
      if (!token || !token.trim()) continue;
      if (token.startsWith('</')) {
        depth -= 1;
        out.push('\n' + pad() + token);
      } else if (token.startsWith('<')) {
        const name = (token.match(/^<\s*([a-zA-Z0-9-]+)/) || [])[1]?.toLowerCase() || '';
        const selfClosing = token.endsWith('/>') || VOID_TAGS.has(name) || token.startsWith('<!');
        out.push('\n' + pad() + token);
        if (!selfClosing) depth += 1;
      } else {
        out.push('\n' + pad() + token.trim());
      }
    }
  }
  return out.join('').replace(/^\n/, '');
}
