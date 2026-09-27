# MCP + OAuth 2.1 on knowledge-graph-worker

`https://knowledge.vegvisr.org/mcp` — a stateless Streamable HTTP MCP server, protected by an
OAuth 2.1 authorization server in the same worker.

**Status: LIVE since 2026-09-27**, version `6429904a-245e-43d0-a5f1-8aa3e8bb8105`.

What is verified on the live host, not just locally: all eleven REST routes probed still answer,
OAuth discovery and RFC 9728 metadata are served, the Bearer challenge points at that metadata,
PKCE is enforced with S256 only, an unregistered redirect_uri is refused, the login page renders,
and the three auth bypasses measured at the start of this work are closed — nine rejection probes,
after which the target graph was re-read and still stood at version 21 with 17 nodes, so nothing
got through.

Still NOT verified end to end: the SMS leg and the code-for-token exchange. That needs a phone on
an account. Until someone completes it, no MCP client has ever held a working token here.

> `*.md` and `*.sql` are gitignored in this repo by convention (`.gitignore:79` and `:57`), so
> this file and `database/mcp-oauth-tables.sql` are tracked as force-added exceptions — a deploy
> cannot be reproduced from a file that exists on one machine. **This repository is public.**

---

## What is where

| Path | Role |
|---|---|
| `dev-worker/index.js` | The 58 REST routes, now wrapped as the provider's `defaultHandler`. Its default export is the `OAuthProvider`. |
| `dev-worker/graph-service.js` | The one internal implementation of the graph operations. REST and MCP both call it. |
| `dev-worker/oauth/authorize.js` | `/authorize`: the login page, the OTP step and consent. |
| `dev-worker/oauth/otp.js` | The OTP challenge, bound to one OAuth transaction. |
| `dev-worker/mcp/server.js` | `/mcp`: the stateless transport, plus the audit log. |
| `dev-worker/mcp/tools.js` | The four tools. |
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
  scope="graph:read graph:write graph:publish"
```

and it follows that to the metadata, registers itself (CIMD, or `/register`), and opens
`/authorize`. Ask only for `graph:read graph:write` in a first connection.

The sign-in window asks for the mobile number registered on the account, sends a code, and shows
the scopes for approval. If the browser already carries a `vegvisr_token` session cookie from
vegvisr.org, the code step is skipped and only the consent screen appears.

**Tools:** `create_graph`, `get_graph`, `add_node`, `update_node`, `get_graph_links`,
`search_graphs`, `list_my_graphs`, `post_chat_message`, plus `search` and `fetch` — the two fixed names ChatGPT's deep research
connectors require, projected onto their `{id,title,url}` / `{id,title,text,url,metadata}` shape
through the same graphService calls.

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

1. **The SMS leg and the token exchange are not verified end to end.** Everything up to the code
   form is verified in the Workers runtime, and the OTP logic has 21 unit assertions, but no test
   has taken a real code through `/token` to a real `/mcp` call. That needs a phone.
2. **A user with no phone number cannot connect** unless they arrive with a vegvisr.org session
   cookie. 13 of 46 users in `config` have a number on record; the rest must either be signed in
   at vegvisr.org in the same browser, or add a number to their profile.
3. **`graph:publish` is grantable but has no tool.** `graphService.publishGraph()` exists and is
   tested; no MCP tool calls it yet.
4. **No delete.** Deliberate for v1. `graph:delete` is not offered in the consent screen.
4b. **`post_chat_message` needs `chat:write`, which is never advertised.** It is the only tool
   whose effect reaches other people, so an ordinary connection cannot obtain the scope: a
   client asking for it is granted `graph:read graph:write` and nothing more. Granting it needs
   a deliberate step-up that this version does not expose. The tool additionally refuses to post
   to a group the CALLER is not a member of — group-chat-worker's `/bot-message` only checks the
   BOT's membership — and appends a non-suppressible line saying an AI assistant wrote it.

   It always posts as ONE designated bot, set by `MCP_CHAT_BOT_USERNAME` (default `chatgpt`),
   never whichever bot happens to be in the group. That makes a group's bot list the access
   control: **adding that bot to a group is what permits an AI to post there**, and removing it
   revokes that — a human decision in the chat app, per group, with no deploy. Resolving the bot
   from the group was tried first and abandoned: DEVMO GROUP has five active bots, so there was
   no single obvious one, and in a group with exactly one it would have borrowed an identity
   created for something else.
5. **Rate limiting is not enforced on `/mcp`.** `api_tokens.rate_limit` has never been enforced
   anywhere in this worker, and that is unchanged. The OTP path is throttled; tool calls are not.
6. **`checkAccess` fails closed on 379 legacy graphs.** Their `created_by` names an app
   (`my-app`, `Unknown`) rather than a person, so they have no owner and only a Superadmin can
   reach them over MCP. Correct, but it is a behaviour change for those graphs.
7. **Trusted origin still grants `graph:read` without a token** on the REST side. The write path
   is closed; anonymous reads are unchanged because `getknowgraph?id=` was always open.
8. **`/mcp` audit rows depend on `ctx.waitUntil`.** If the runtime drops the deferred work the
   call still succeeds but the row is lost. Audit failures never fail a request by design.
