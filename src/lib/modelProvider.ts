// Which provider a model id belongs to.
//
// Model ids carry their provider as a prefix — see MODELS in components/ModelSettings.tsx:
//   "@cf/…"     Cloudflare Workers AI
//   "ollama/…"  Ollama (local dev only)
//   "openai/…"  OpenAI
//   "grok/…"    Grok (xAI)
//   "claude-…"  Anthropic (no prefix — the bare id)
//
// This exists because chat logs that omit the provider hide a real failure mode. On 2026-08-17 the
// same natural-language prompt made Grok scaffold and DEPLOY a duplicate worker instead of calling
// the existing admin_register_user tool, while Haiku called the tool on the first try. The two logs
// were indistinguishable, and the cause was misattributed to the wording of the prompt. Tool-choice
// reliability differs between models, so every exported log must say which one ran.
//
// An unrecognised id is reported verbatim rather than guessed at — a wrong provider label is worse
// than an honest "unrecognised".
export function providerOf(id?: string): string {
  if (!id) return 'Anthropic (worker default)';
  if (id.startsWith('@cf/')) return 'Cloudflare Workers AI';
  if (id.startsWith('ollama/')) return 'Ollama (local)';
  if (id.startsWith('openai/')) return 'OpenAI';
  if (id.startsWith('grok/')) return 'Grok (xAI)';
  if (id.startsWith('claude-')) return 'Anthropic';
  return `(unrecognised prefix: ${id.split('/')[0]})`;
}
