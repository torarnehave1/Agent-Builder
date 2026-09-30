# VEGR.AI Knowledge Graph — MCP server

**Server version `1.12.0`** · live since 2026-09-27

`https://knowledge.vegvisr.org/mcp` — a **remote MCP server**: stateless Streamable HTTP,
protected by an OAuth 2.1 authorization server running in the same Cloudflare Worker.

## Terminology

Use these words; they are the ones the MCP specification uses, and mixing them up makes a bug
report ambiguous.

| Term | What it means here |
|---|---|
| **MCP server** | This thing. `knowledge.vegvisr.org/mcp`. It reports itself as `vegvisr-knowledge-graph` v1.5.0 in the initialize handshake (`mcp/server.js`, `SERVER_INFO`). |
| **remote MCP server** | An MCP server reached over HTTP at a URL, as opposed to a **local server** run as a subprocess over stdio. Only the remote kind needs OAuth, scopes and a consent screen — which is most of this document. |
| **MCP client** | The thing that connects and calls tools: ChatGPT, Claude, Grok. |
| **host** | The application the client lives in — the ChatGPT app, the Claude app. |
| **connector** | What ChatGPT and Claude call a configured MCP server in their own UI. A product word, not a spec word. Say "connector" to a user, "MCP server" to a developer. |
| **tools / resources / prompts** | The three things an MCP server can expose. This one exposes tools only — 22 of them. |
| **authorization server** | Also this worker: `/authorize`, `/token`, `/register`, RFC 8414 metadata. Most systems keep this separate; here it is the same worker, which is why the existing phone OTP could be reused as the login. |
| **protected resource** | Also this worker: `/mcp`, advertised per RFC 9728 as `VEGR.AI Knowledge Graph`. |

It is **not** a "wrapper" and not a "plugin". A wrapper sits on top of an API; this does not.
`mcp/tools.js` and the REST routes call the *same* internal service functions
(`graph-service.js`, `chat-service.js`, `users-service.js`, …), so MCP is a second front door on
one implementation, not a layer over the first door. "Plugin" is the deprecated ChatGPT term for
something else entirely.

The name to use in writing: **VEGR.AI Knowledge Graph MCP server**, or "the KG server" in short.
"KG Manager" is only the label given to one connector inside one ChatGPT account.

## Status

Verified on the live host, not just locally: OAuth discovery and RFC 9728 metadata are served,
the Bearer challenge points at that metadata, PKCE is enforced with S256 only, an unregistered
redirect_uri is refused, and the three auth bypasses measured at the start of this work are
closed — nine rejection probes, after which the target graph was re-read and still stood at
version 21 with 17 nodes, so nothing got through.

The full flow IS now proven end to end. ChatGPT, Claude and Grok have each completed the SMS leg
and the code-for-token exchange and held working tokens; grants for all three are in `OAUTH_KV`,
and `mcp_audit_log` records their tool calls.

> `*.md` and `*.sql` are gitignored in this repo by convention (`.gitignore:79` and `:57`), so
> this file and `database/mcp-oauth-tables.sql` are tracked as force-added exceptions — a deploy
> cannot be reproduced from a file that exists on one machine. **This repository is public.**

---

## Versions

`SERVER_INFO.version` in `mcp/server.js` is what a client shows and what a bug report should
name. It said `1.0.0` from launch straight through everything below — four tools became
twenty-two and one scope became seven while the handshake still claimed the launch version.
That is the reason the first real bump lands at 1.5.0 rather than 1.1.0: the numbers below
describe what shipped, reconstructed, not versions any client ever saw.

**Bump this with the surface from now on.** A minor for new tools or scopes, a patch for a fix
that changes no contract.

| Version | Date | What |
|---|---|---|
| `1.0.0` | 2026-09-27 | Launch. OAuth 2.1 + PKCE, phone-OTP login, stateless Streamable HTTP. Four tools: `create_graph`, `get_graph`, `add_node`, `get_graph_links`. Scopes `graph:read`, `graph:write`. |
| `1.1.0` | 2026-09-27 | `update_node`, `search_graphs`, `list_my_graphs`, and the fixed pair `search`/`fetch` that ChatGPT deep research requires. |
| `1.2.0` | 2026-09-27 | Chat: `post_chat_message`, `list_chat_groups`, `read_chat_messages`. Introduced the **opt-in scope** — `chat:write`/`chat:read` are unadvertised and grantable only by a ticked box on the consent screen. |
| `1.3.0` | 2026-09-28 | `get_fulltext_elements` and `generate_node_image`. Images are generated and stored server-side; no bytes cross MCP. |
| `1.4.0` | 2026-09-28 | `update_graph_metadata`, `list_published_sites`, `publish_html_node` (opt-in `graph:publish`, restricted to hosts the node already references). |
| `1.5.0` | 2026-09-29 | The user directory: `register_user`, `list_users`, `set_user_groups`, `set_user_role` (opt-in `user:register`, `user:read`), plus `list_meta_areas` and `list_my_graphs` paging to 200. |
| `1.5.1` | 2026-09-29 | Patch. Stop refusing a POST whose `Accept` lacks `text/event-stream` — the server never returns an event stream, so the SDK's check only cost real requests (13 rejected in one day). `mcp_audit_log` gains a `method` column, because `tool` is NULL for anything that is not `tools/call` and a rejected handshake logged nothing identifying. |
| `1.6.0` | 2026-09-29 | The scope vocabulary is FROZEN — eight scopes named after risk classes instead of features, so a new tool costs a tool-list refresh rather than a re-authorization. Consent copy widened to describe the class. No tool changed. |
| `1.7.0` | 2026-09-29 | `graph:delete` made grantable. It was in the vocabulary with no checkbox, so the first delete tool would have forced a re-authorization regardless — closed while one reconnect still cost one person. Six opt-in boxes now. |
| `1.8.0` | 2026-09-30 | `generate_node_image` takes a `model`, and the default becomes `@cf/leonardo/lucid-origin`. The old default was SDXL Lightning, inherited from Agent-Builder without anyone asking whether a distilled few-step model suited a published header image. |
| `1.9.0` | 2026-09-30 | `style`, `lighting` and `format` on the image tool — the chat UI's dropdown vocabulary, copied token for token, so the same choice gives the same picture through either surface. The reply carries `finalPrompt`. |
| `1.10.0` | 2026-09-30 | `renderTraits`, `imageText` and `textTreatment`. Traits are emitted in the table's order rather than the caller's, so one set of choices always composes to one string. |
| `1.11.0` | 2026-09-30 | `get_image_guide`, and per-model parameter resolution. `quality`, `steps`, `guidance`, `seed` and `negativePrompt` now resolve against the chosen model's own published schema: the five models disagree about which of those exist, so an unsupported one is reported in `notes` rather than dropped in silence. `mcp_audit_log` gains `client_info`, recording what each client declares at `initialize` — including whether it supports `elicitation`, which is what a server would need to ask the user a question mid-call. |
| `1.12.0` | 2026-09-30 | `flux-1-schnell` retired from the image model enum — it accepts no width or height, and `generate_node_image` only ever fills a placeholder whose element already declared a size. Four models remain, all of which take a size and a seed, asserted as a property rather than a list. Naming a retired or unknown model now leads `notes` with the substitution and its reason instead of falling through to the default in silence. |

### Current surface

- **23 tools** — `TOOL_NAMES` in `mcp/tools.js` is the list, and a test asserts `tools/list`
  matches it exactly.
- **2 advertised scopes**: `graph:read`, `graph:write`. These are all `CONNECT_SCOPES`, so they
  are all a client can request.
- **5 opt-in scopes**: `chat:write`, `chat:read`, `graph:publish`, `user:register`, `user:read`.
  None is advertised; each is granted only by a person ticking its box. A test pins that no
  opt-in ever leaks into the advertised set.
- **3 outward-facing tools** — `post_chat_message`, `publish_html_node`, `register_user`. Their
  effects leave this system and reach other people, so each declares `openWorldHint` and each
  sits behind an opt-in scope. A test pins both properties together.

---

## Scopes are frozen — pick one, do not add one

Adding a scope string is the most expensive change in this system, and the cost lands on every
user rather than on you. **A grant is never widened.** An existing connection keeps exactly the
scopes it was created with, so a new scope means every person must delete their connector and add
it again — and ChatGPT refuses to reuse the old connector name, so they end up with "KM2".

Five scopes were added over two days in September 2026 and each one cost that. The mistake was
naming them after FEATURES: `chat:write` arrived with chat, `graph:publish` with publishing,
`user:register` with the directory. So every new capability implied a new scope.

These eight are named after RISK CLASSES and are meant to be final. `scopes.test.mjs` pins the
array; that test failing is the warning, not a nuisance.

| Scope | The class of damage it covers | Advertised? |
|---|---|---|
| `graph:read` | reading content the user may already see | yes |
| `graph:write` | creating or changing the user's own content, including files, images and metadata | yes |
| `graph:publish` | making something reachable by people who are not signed in | opt-in |
| `graph:delete` | destroying content — reserved, no tool uses it yet, but the box exists so the first one costs a refresh and not a re-authorization | opt-in |
| `chat:write` | sending a message that reaches other people, in any channel | opt-in |
| `chat:read` | reading messages other people wrote | opt-in |
| `user:register` | creating or altering an account in the user directory | opt-in |
| `user:read` | seeing other people's names, addresses and roles | opt-in |

### Choosing a scope for a new tool

1. **What is the worst thing this tool can do?** Not what it usually does.
2. **Which row above does that damage resemble?** Use that scope. A tool that attaches a file to
   a node is `graph:write`, not a new `files:write`. A tool that emails someone is `chat:write`,
   not `email:send` — the damage is "a message reached a person", and the channel does not change
   that.
3. **If the honest answer is "none of them"** — then the scope is justified. Add it, and add a
   row here saying what it cost, so the next person sees the price.
4. **Widen the consent copy to match.** Consent must never be narrower than what the scope
   permits, or the new tool is doing something the user never agreed to. `SCOPE_TEXT` and
   `OPT_IN_SCOPE_DETAIL` describe the class, and a test asserts they do.

Note that widening copy does not retroactively inform people who already consented under the
narrower wording. A tool that materially enlarges what an existing scope reaches is still a
deliberate decision — the freeze removes the re-authorization tax, it does not remove judgement.

### What a new tool actually costs now

| Change | Cost to the user |
|---|---|
| New tool in an existing scope | a tool-list refresh — in ChatGPT, a new conversation |
| New tool needing a new scope | delete the connector, add it again, re-tick every box |
| Changed tool description or schema | a tool-list refresh |
| Backend fix behind an existing tool | nothing |

---

## What is where

| Path | Role |
|---|---|
| `dev-worker/index.js` | The REST routes (77 paths), wrapped as the provider's `defaultHandler`. Its default export is the `OAuthProvider`. |
| `dev-worker/graph-service.js` | The one internal implementation of the graph operations. REST and MCP both call it. |
| `dev-worker/oauth/authorize.js` | `/authorize`: the login page, the OTP step and consent. |
| `dev-worker/oauth/otp.js` | The OTP challenge, bound to one OAuth transaction. |
| `dev-worker/mcp/server.js` | `/mcp`: the stateless transport, plus the audit log. |
| `dev-worker/mcp/tools.js` | The 22 tools. |
| `database/mcp-oauth-tables.sql` | The `graph:publish` scope row and `mcp_audit_log`. |

Endpoints the provider serves: `/authorize`, `/token`, `/register`,
`/.well-known/oauth-authorization-server`, `/.well-known/oauth-protected-resource/mcp`.
None of them existed in this worker before, so no REST route is shadowed.

---

## Deploying

### 1. The KV namespace — DONE

Created 2026-09-27; `dev-worker/wrangler.toml` carries its id. Nothing to do unless the namespace
is ever recreated, in which case:

```bash
wrangler kv namespace create OAUTH_KV
```

and paste the id it prints into the `OAUTH_KV` binding. The worker will not start without one.

### 2. The D1 migration — DONE

Applied to production 2026-09-27: 5 queries, 9 rows written. Verified afterwards — `api_scopes`
now carries all four Graph scopes (`graph:read`, `graph:write`, `graph:publish`, `graph:delete`),
and `mcp_audit_log` exists with its three indexes and no rows yet.

Every statement is idempotent (`INSERT OR IGNORE`, `CREATE TABLE IF NOT EXISTS`), so re-running
it is safe:

```bash
wrangler d1 execute vegvisr_org --remote --config dev-worker/wrangler.toml \
  --file=database/mcp-oauth-tables.sql
```

> `*.sql` is gitignored here by convention, so this migration is tracked as a force-added
> exception alongside the other 18 `database/*.sql` files. Reproduced below for reference.

<details>
<summary><code>database/mcp-oauth-tables.sql</code> in full</summary>

```sql
-- MCP / OAuth 2.1 support for knowledge-graph-worker (2026-09-27)
--
-- The OAuth token material itself is NOT here: @cloudflare/workers-oauth-provider keeps
-- clients, grants, authorization codes and tokens in KV (binding OAUTH_KV), hashed. The OTP
-- challenges bound to an authorization live in the same KV under the oauthtx: prefix, with a
-- 15-minute TTL, and are never written to config.phone_verification_code — an OAuth OTP must
-- not double as a durable web session.
--
-- So D1 needs exactly two things: the new scope, and the audit trail.

-- 1. graph:publish. graph:read / graph:write / graph:delete already exist as rows.
--    graph:delete is intentionally NOT granted by default and has no tool in version 1.
INSERT OR IGNORE INTO api_scopes (id, scope_name, description, category, is_active, requires_admin)
VALUES ('scope_graph_publish', 'graph:publish', 'Publish a knowledge graph publicly', 'Graph', 1, 0);

-- 2. The MCP audit trail.
--
-- Records who did what, to which graph, with what outcome and how fast. Deliberately holds NO
-- access token, refresh token, authorization code, OTP, Authorization header or node content:
-- the graph id is enough to find the data through the normal API, and a copy of the content
-- here would just be a second place for it to leak from.
CREATE TABLE IF NOT EXISTS mcp_audit_log (
  id TEXT PRIMARY KEY,
  ts TEXT NOT NULL,             -- ISO 8601, when the call was answered
  user_id TEXT,                 -- the VALIDATED user from the OAuth token, never a tool argument
  client_id TEXT,               -- the OAuth client (e.g. the ChatGPT connector)
  tool TEXT,                    -- MCP tool name, or NULL for tools/list and initialize
  graph_id TEXT,                -- the graph acted on, when the call named one
  result_code TEXT,             -- OK, or a structured code such as VERSION_CONFLICT
  duration_ms INTEGER
);

CREATE INDEX IF NOT EXISTS idx_mcp_audit_user_ts ON mcp_audit_log(user_id, ts);
CREATE INDEX IF NOT EXISTS idx_mcp_audit_graph ON mcp_audit_log(graph_id);
CREATE INDEX IF NOT EXISTS idx_mcp_audit_ts ON mcp_audit_log(ts);
```

</details>

### 3. Secrets

No new secrets. The layer reuses what is already configured:

| Needed | Where it already lives |
|---|---|
| Magic-link mail | `email-worker` (`SLOWYOU_API_TOKEN`, `MAGIC_SMTP_*`) via the `EMAIL_WORKER` binding |
| SMS | `sms-gateway` (`CLICKSEND_USERNAME`, `CLICKSEND_API_KEY`) via the new `SMS_GATEWAY` binding |

All OAuth token material is hashed in KV by the provider. There is nothing to rotate by hand.

### 4. Deploy — DONE

Deployed 2026-09-27, version `6429904a-245e-43d0-a5f1-8aa3e8bb8105`. To redeploy:

```bash
cd /Volumes/T7/vegvisr-frontend/dev-worker && wrangler deploy
```

`compatibility_flags = ["global_fetch_strictly_public"]` must be present or Client ID Metadata
Documents are silently disabled — the provider only says so in the startup log.

---

## Running locally

```bash
# terminal 1 — email-worker, so the magic link can be issued
npx wrangler dev --config email-worker/wrangler.toml --port 8790 --local

# terminal 2 — the knowledge graph worker
npx wrangler dev --config dev-worker/wrangler.toml --port 8788 --local
```

`dev-worker/.dev.vars` (gitignored) must set the origin, or discovery will refuse to answer:

```
MCP_PUBLIC_ORIGIN = "http://localhost:8788"
```

**Why:** RFC 9728 makes the resource identifier the audience of every token, and the provider
will not serve the protected-resource document, or name it in the `WWW-Authenticate` challenge,
for a request arriving on a different origin. With the production URL compiled in, localhost got
an empty 404 and a challenge with no `resource_metadata`.

Seed a local database (schema, test users, tokens) before testing writes — the local D1 starts
empty.

Local mail is **not** sent: `SLOWYOU_API_TOKEN` is absent, so `/login/magic/send` fails after
storing the row. Read the token straight out of local D1 and follow the link by hand:

```bash
wrangler d1 execute vegvisr_org --local --config email-worker/wrangler.toml \
  --command "SELECT token FROM login_magic_links ORDER BY created_at DESC LIMIT 1"
```

Then open `http://localhost:8788/authorize?tx=<tx>&magic=<token>`.

The SMS leg cannot be completed locally: the code exists only in the SMS body and as a salted
hash, and `sms-worker` logs only the message length. That is deliberate — do not add a way to
read it.

---

## Tests

```bash
node --test dev-worker/test/graph-service.test.mjs   # 41 — service layer, access control, versions
node --test dev-worker/test/otp.test.mjs             # 21 — OTP: reuse, expiry, attempts, throttles
node --test dev-worker/test/mcp-tools.test.mjs       # 29 — the tools, over real MCP JSON-RPC
node --test src/utils/kgAuth.test.mjs                #  6 — the frontend auth headers
```

They run against a real SQLite engine using the schema read from production `sqlite_master`, not
a mock. `dev-worker/test/d1-adapter.mjs` holds the D1 adapter, a KV stub that honours
`expirationTtl`, and a fake SMS gateway that reads the code the way a recipient would.

### MCP Inspector

```bash
npx @modelcontextprotocol/inspector
```

Point it at `http://localhost:8788/mcp` and let it run the OAuth flow. It will need the magic
link and the SMS code, so a real phone on the account is required.

---

## Connecting ChatGPT or Codex

Add a connector pointing at `https://knowledge.vegvisr.org/mcp`. The client discovers everything
else itself: the unauthenticated request returns

```
WWW-Authenticate: Bearer realm="OAuth",
  resource_metadata="https://knowledge.vegvisr.org/.well-known/oauth-protected-resource/mcp",
  scope="graph:read graph:write"
```

and it follows that to the metadata, registers itself (CIMD, or `/register`), and opens
`/authorize`. Ask only for `graph:read graph:write` in a first connection.

The sign-in window asks for the mobile number registered on the account, sends a code, and shows
the scopes for approval. If the browser already carries a `vegvisr_token` session cookie from
vegvisr.org, the code step is skipped and only the consent screen appears.

**Tools:** `create_graph`, `get_graph`, `add_node`, `update_node`, `get_graph_links`,
`search_graphs`, `list_my_graphs`, `post_chat_message`, `list_chat_groups`,
`read_chat_messages`, `get_fulltext_elements`, `generate_node_image`, `list_published_sites`, `update_graph_metadata`, `publish_html_node`, plus `search` and `fetch` — the two fixed names ChatGPT's deep research
connectors require, projected onto their `{id,title,url}` / `{id,title,text,url,metadata}` shape
through the same graphService calls.

`generate_node_image` is the counterpart to `get_fulltext_elements`. The element formats ship
with placeholder image URLs — `HEADERIMG.png`, `SIDEIMG.png`, `FANCYIMG.png` — so a model that
copies a format verbatim has already said where an image goes and how big it is. The tool fills
that slot and nothing else: a node with no placeholder is refused rather than guessed at. No
image crosses the wire — Workers AI generates it and photos-worker stores it, server-side, with
the upload running as the authenticated user on a credential read from their own `config` row.
That needs the `PHOTOS_WORKER` service binding in `dev-worker/wrangler.toml`; without it the tool
says so by name instead of failing as a generation error.

`list_published_sites` is the Knowledge Graph Portfolio's "Published sites" chip as data.
brand-worker writes an `html:<hostname>` key into `HTML_PAGES` on every html-node publish, and
its metadata names the graph and node serving that host. The tool returns each live host with
its graph, node id and publish time; `search_graphs` and `list_my_graphs` carry the same
`publishedDomains` per result, and a hostname works as a search term. The registry is KV and
global, so a host whose graph the caller cannot read is dropped before it is described — the
reply says how many were withheld rather than quietly returning a short list.

A node's own `publishedDomain` stamp is written client-side and survives a later publish that
gave the host to another graph, so the registry wins: a stamp it contradicts is dropped, a host
it has no opinion about is kept.

`update_graph_metadata` changes title, description, metaArea or category. Its `expectedVersion`
is optional ON PURPOSE: graph-service's `updateMetadata` compares against `MAX(version)` in the
history table, while `get_graph` reports `metadata.version`. Those agree for 1263 of 1272 graphs
and differ for 9, so a model copying the version it just read would hit an unexplainable
conflict — omitting it defaults from the source the service actually reads. `metaArea` is ONE
space-separated string and a write replaces all of it, so adding a tag means reading the current
value and sending the complete new string. `publicationState` is not in the schema; publishing
stays its own action.

`publish_html_node` is the second tool whose effect leaves the system, after `post_chat_message`,
and it is narrowed twice compared with the same action in the Agent Builder. It requires
`graph:publish`, which stays OUT of `CONNECT_SCOPES` — no client can request it, and it is granted
only by ticking an unticked box on the consent screen. And it can only publish to a host the node
is ALREADY associated with: the Agent Builder lets a Superadmin publish anywhere and override that
with `force:true`, but `force` is not forwarded by the route and is absent from the tool schema, so
a model cannot take over another World's host. A node with no host is refused rather than allowed
to claim one. There is no `create_subdomain` on this surface — new hosts stay a human action.

No publish logic lives in the KG worker. It calls agent-worker's `POST /publish/html-node`, which
wraps the single implementation (`executePublishHtmlNode`). Check `verified` in the result: only
`verified:true` means the page is actually live.

---

## Revoking access and rotating tokens

Access tokens live one hour. Refresh tokens rotate on every use, so a refresh token that is used
twice is a detectable replay and the grant is revoked.

To cut a client off, delete its grant from `OAUTH_KV`:

```bash
wrangler kv key list --binding OAUTH_KV --remote --prefix "grant:"
wrangler kv key delete --binding OAUTH_KV --remote "<key>"
```

The user can also start a new authorization: `completeAuthorization()` revokes existing grants
for the same user, client and resource by default.

---

## Audit trail

`mcp_audit_log` gets one row per call: timestamp, the **validated** user id, the OAuth client,
the tool, the graph id, the result code, and the duration.

```sql
SELECT ts, user_id, client_id, tool, graph_id, result_code, duration_ms
FROM mcp_audit_log ORDER BY ts DESC LIMIT 50;
```

Deliberately not recorded: access tokens, refresh tokens, authorization codes, OTP codes, the
`Authorization` header, and node content. The graph id is enough to find the data through the
normal API; a copy of the content here would only be a second place for it to leak from.

---

## Known limitations

1. ~~The SMS leg and the token exchange are not verified end to end.~~ **Closed 2026-09-28.**
   ChatGPT, Claude and Grok have each completed the whole flow and held working tokens. Their
   grants are in `OAUTH_KV` and their calls are in `mcp_audit_log`.
2. **A user with no phone number cannot connect** unless they arrive with a vegvisr.org session
   cookie. 13 of 53 users in `config` have a number in the `+47XXXXXXXX` form the lookup needs;
   the rest must either be signed in at vegvisr.org in the same browser, or add a number. Note
   the lookup compares the NORMALISED value against the stored column without normalising it, so
   a number stored as `99242829` or `0047…` would never match — today none is, but a new one
   written by hand could be. Non-Norwegian numbers cannot be used at all.
3. ~~`graph:publish` is grantable but has no tool.~~ **Closed 2026-09-28** by
   `publish_html_node`, which republishes an html-node to a host the node ALREADY references.
   `graphService.publishGraph()` — publishing a *graph* rather than a page — still has no tool.
4. **No delete.** Deliberate for v1. `graph:delete` is not offered in the consent screen.
4b. **`post_chat_message` needs `chat:write`, which is never advertised.** It is one of three
   tools whose effect leaves this system — with `publish_html_node` and `register_user` — and
   each sits behind an unadvertised opt-in for the same reason: an ordinary connection cannot
   obtain the scope, because a
   client asking for it is granted `graph:read graph:write` and nothing more. Granting it needs
   a deliberate step-up that this version does not expose. The tool additionally refuses to post
   to a group the CALLER is not a member of — group-chat-worker's `/bot-message` only checks the
   BOT's membership — and appends a non-suppressible line saying an AI assistant wrote it.

   Each MCP client posts as ITS OWN bot, resolved from the host of its client id via
   `MCP_CHAT_BOT_MAP` — `chatgpt.com` → `@chatgpt`, `claude.ai` → `@claude`. The mapping only
   applies when the client id is an https URL, i.e. a Client ID Metadata Document the provider
   fetched, so the host is verified. A client registered through `/register` has an opaque id,
   and is identified instead by its registered **redirect URIs** — the authorization code is
   delivered there, so claiming `grok.com` sends the code to grok.com rather than to the
   claimer, which makes borrowing a host useless. Every redirect must agree on one https host,
   or the client is unmapped: one redirect at `grok.com` and another at the attacker's address
   would otherwise read as Grok while the codes went elsewhere. The self-asserted `clientName`
   is never used. Anything unidentifiable falls back to
   `MCP_CHAT_BOT_FALLBACK_USERNAME` (`@ai-assistant`). The attribution line names the bot from
   the database row, never anything the client sent. Never whichever bot happens to be in the
   group. That makes a group's bot list the access
   control: **adding that bot to a group is what permits an AI to post there**, and removing it
   revokes that — a human decision in the chat app, per group, with no deploy. Resolving the bot
   from the group was tried first and abandoned: DEVMO GROUP has five active bots, so there was
   no single obvious one, and in a group with exactly one it would have borrowed an identity
   created for something else.

   **Granting it** is a user action, not a client one. The scope stays unadvertised, so no
   client requests it; instead the consent screen carries an explicitly unticked checkbox for
   it, with copy saying an AI writes the messages, that only groups carrying the bot can be
   posted to, and that nothing can be deleted afterwards. Ticking it adds the scope to that one
   authorization. RFC 6749 §3.3 permits an authorization server to issue a scope set different
   from the one requested as long as the token response reports it, which the provider does.
5. **Rate limiting is not enforced on `/mcp`.** `api_tokens.rate_limit` has never been enforced
   anywhere in this worker, and that is unchanged. The OTP path is throttled; tool calls are not.
6. **`checkAccess` fails closed on 379 legacy graphs.** Their `created_by` names an app
   (`my-app`, `Unknown`) rather than a person, so they have no owner and only a Superadmin can
   reach them over MCP. Correct, but it is a behaviour change for those graphs.
7. **Trusted origin still grants `graph:read` without a token** on the REST side. The write path
   is closed; anonymous reads are unchanged because `getknowgraph?id=` was always open.
8. **`/mcp` audit rows depend on `ctx.waitUntil`.** If the runtime drops the deferred work the
   call still succeeds but the row is lost. Audit failures never fail a request by design.
