# VEGR.AI MCP + OAuth 2.1 — Fase 1: Analyse og teknisk plan

**Dato:** 2026-09-27 · **Status:** analyse levert, venter godkjenning før Fase 2
**Implementasjonsrepo:** `/Volumes/T7/vegvisr-frontend` (worker-monorepoet), primært `dev-worker/`
**Denne filen ligger i:** Agent-Builder (arbeidskatalogen for sesjonen)

Alt under er lest ut av kode eller målt mot live system. Der noe er utledet fra kode
uten å være probet, står det eksplisitt.

---

## 1. Hvilken worker håndterer Knowledge Graph API-et

| | |
|---|---|
| Katalog | `/Volumes/T7/vegvisr-frontend/dev-worker/` |
| Worker-navn | `knowledge-graph-worker` |
| Fil | `index.js` — **11 162 linjer, én fil**, 58 ruter i live `openapi.json` |
| Rute | `knowledge.vegvisr.org/*` — **ikke** i `wrangler.toml`, satt i Cloudflare-dashboardet |
| D1 | binding `vegvisr_org` → database `vegvisr_org` (`507d1efd-…`) |
| KV | `BINDING_NAME`, `THEME_STUDIO_KV`, `HTML_PAGES` |
| Bygg | Har allerede npm-importer (`workers-ai-provider`, `ai`) som løses fra monorepo-roten. Ingen egen `package.json`. |

`api-worker/index.js` importerer lokale moduler (`./html-publish-token.js`). **Både npm-avhengigheter
og fler-fils-oppdeling er altså etablerte mønstre i dette monorepoet** — ingen ny byggverktøykjede
trengs for `graphService` eller for MCP-bibliotekene.

Ingen kollisjoner: `/authorize`, `/token`, `/register`, `/.well-known/*` og `/mcp` finnes **ikke**
i dev-worker i dag.

---

## 2. Hvor OTP sendes, lagres og verifiseres — det finnes TO implementasjoner

### 2a. `sms-worker` (worker-navn `sms-gateway`) — dette er produksjons-innloggingen
Ruter: `POST /api/auth/phone/send-code`, `POST /api/auth/phone/verify-code`,
`GET /api/auth/phone/status`, `POST /api/auth/user/validate`.
`src/views/LoginView.vue:487,520` kaller disse mot `sms-gateway.torarnehave.workers.dev`.

- Kode: 6 siffer, `crypto.getRandomValues`.
- Lagring: **D1 `config`-tabellen**, kolonnene `phone_verification_code` (SHA-256-hash),
  `phone_verification_expires_at` (unix-sek), `phone_verified_at`.
- Levetid 5 min. Ved treff: `phone_verified_at` settes, kode og expiry nulles → **engangsbruk**.
- Utsending: ClickSend via `sendSMSViaClickSend`.
- **Knyttet til brukeridentitet**: slår opp `config` på e-post *eller* telefon og returnerer
  `{ user_id, email, phone, verified_at }`. Dette er den flyten OAuth skal gjenbruke.

**Svakheter (må tettes i OAuth-flyten):**
- Ingen forsøksteller — ubegrenset antall gjettinger på en 6-sifret kode innenfor 5 min.
- Ingen rate limit på utsending.
- `send-code` returnerer **404 «No account registered with this phone number»** → lekker om et
  telefonnummer finnes i systemet (mot sikkerhetskravet).
- `phone_verified_at` er et *permanent* flagg, ikke en sesjon. `handleSaveGraph` i samme worker
  autentiserer på `phone_verified_at IS NOT NULL` alene — altså varig tilgang uten bærer-token.

### 2b. `brand-worker` — kontaktskjemaets OTP (`/__contact/send-otp`, `/__contact/submit`)
KV-basert (`CONTACT_KV`, nøkkel `c:otp:<telefon>`), SHA-256-hash, 5 min, `expirationTtl: 360`.
**Har det sms-worker mangler:** `tries`-teller med tak på 5, 3 kodeforespørsler per nummer per
time, 6 forsøk per IP per time, 200 globalt per time, honeypot og tidsfelle.
Verifiserer bare *telefonnummeret* — kobler ikke til en brukerkonto.

> **Konklusjon:** OAuth-OTP = **identitetsbindingen fra sms-worker** + **tellerne fra brand-worker**.
> Kravet «behold eksisterende mekanismer dersom de er sterkere» peker direkte på 2b sine tellere.

---

## 3. Brukeridentitet, roller og eksisterende token

`config`-tabellen, primærnøkkel = **`email`** (ikke `user_id`):
`user_id` (TEXT, nullable), `email` (PK), `emailVerificationToken`, `Role`, `phone`,
`phone_verification_code`, `phone_verification_expires_at`, `phone_verified_at`, `oauth_id`,
`display_name`, + ~30 per-bruker Cloudflare-kolonner.

**Målt på live D1 (46 brukere):**

| | antall |
|---|---|
| Brukere totalt | 46 |
| Har `phone` | **13** |
| Har verifisert telefon | **12** |
| Har `emailVerificationToken` (sesjonstoken) | 40 |
| Har `user_id` | 43 |

> ⚠️ **33 av 46 brukere har ikke telefonnummer registrert.** Se «Åpne avgjørelser» punkt A.

**Tokenmodell som finnes i dag:**
- `api_tokens` — `id, user_id, token (SHA-256-hash), token_name, token_prefix, scopes (JSON),
  rate_limit, expires_at, last_used_at, is_active, metadata`. Format `vv_prod_<32 hex>`,
  generert i `api-worker/api-token-handlers.js`, lagret **hashet**. Ingen refresh, ingen rotasjon.
- `api_scopes` — scopes er **data i D1**, 14 rader. `graph:read`, `graph:write`, `graph:delete`,
  `node:create/update/delete`, `template:*`, `user:*`, `ai:chat`, `admin:all`.
  **`graph:publish` finnes ikke** — må legges inn som rad.
- `api_token_usage` — tabellen finnes, men **`rate_limit` leses aldri og håndheves ingen steder**
  (kun returnert fra `validateAuth`). Ingen rate limiting er aktiv i dag.
- `emailVerificationToken` i `config` = sesjonstoken fra magic-link-flyten (`email-worker`
  `/login/magic/send`), sendes som `X-Session-Token`.

---

## 4. Hvordan graf-endepunktene er implementert

| Endepunkt | Auth i dag | Versjonskontroll |
|---|---|---|
| `POST /saveGraphWithHistory` (7652) | `validateAuth` + `graph:write` | `override:false` ⇒ 409 `{error, currentVersion}` ved avvik. Ny graf starter på v1. **UUID v4 påkrevd for nye grafer** (eksisterende legacy-id-er får fortsette). |
| `GET /getknowgraph` (7500) | **Ingen.** Token valideres bare *hvis* `X-API-Token` er sendt. | — |
| `POST /addNode` (8125) | `validateAuth` + `graph:write` | — |
| `POST /patchNode` (7864) | `validateAuth` + `graph:write` | `expectedVersion` **påkrevd** (400 om den mangler), 409 + `currentVersion` ved konflikt |
| `POST /patchGraphMetadata` (8002) | `validateAuth` + `graph:write` | `expectedVersion` påkrevd, 409 + `currentVersion` |
| Historikk | `knowledge_graph_history(graph_id, version, …)`; `MAX(version)` er sannheten | `/getknowgraphhistory`, `/getknowgraphversion` |

**Publisering finnes ikke som egen handling.** «Publisert» = `metadata.publicationState === 'published'`
satt via `patchGraphMetadata` med `graph:write`. Listeendepunktene filtrerer på
`publicationState = 'published' OR seoSlug IS NOT NULL`.

**Datagrunnlag (1271 grafer):** `publicationState` = `null` 857, `draft` 333, `published` 81.

### Eierskap — svakt datagrunnlag
| felt | utfylt |
|---|---|
| `knowledge_graphs.created_by` (kolonne) | 1271 / 1271 — men bare **892 er e-postformet**, 379 er app-navn/«Unknown» |
| `data.metadata.createdBy` (JSON) | 1194 / 1271, 892 e-postformet |
| `knowledge_graphs.user_id` (kolonne, migrasjon `add-graph-ownership-columns.sql`) | **258 / 1271** |

`createdBy` settes fra **request-body** (`graphData.metadata.createdBy`), aldri fra autentisert
bruker. OpenAPI-skjemaet dokumenterer det til og med som «Creator identifier (app name)».

---

## 5. Hva kan flyttes til `graphService`

Uttrekk fra `dev-worker/index.js` til `dev-worker/graph-service.js`, rent refaktor uten
kontraktsendring. Eksisterende REST-handlere blir tynne wrappere.

| `graphService`-funksjon | Trekkes ut fra |
|---|---|
| `getGraph(id)` | 7500–7650 (D1-select + `sanitizeGraphData` + node/edge-normalisering) |
| `saveGraph({id, graphData, override, actor})` | 7652–7862 (UUID v4-sjekk, versjonsoppslag, enrichment, historikk-insert) |
| `addNode({graphId, node, expectedVersion, actor})` | 8125–… |
| `updateNode(...)` / `updateMetadata(...)` | 7864 / 8002 (les-modifiser-skriv + `expectedVersion`) |
| `getHistory` / `getVersion` | `/getknowgraphhistory`, `/getknowgraphversion` |
| `nextVersion(graphId)` | `MAX(version)`-spørringen, duplisert i 4 handlere i dag |
| `publishGraph({graphId, actor})` | **Ny** — innkapsler `publicationState`-overgangen som egen handling |
| `checkAccess({actor, graphId, action})` | **Ny** — finnes ikke i noen form i dag |

Alt som allerede er felles (`validateAuth`, `hasScope`, `hashToken`, `sanitizeGraphData`) blir liggende.

---

## 6. Autentisering og tilgangskontroll i dag — `validateAuth` (linje 1021)

Fem metoder, i rekkefølge:
1. **Service binding** — `INTERNAL_SERVICE_HOSTS = {'knowledge-graph-worker'}` matchet på
   `new URL(request.url).hostname`. Gir `scopes: ['all']`, `userId: null`. Ikke forfalskbar utenfra
   (Cloudflare leverer bare på mappede ruter). Tillitsgrensen er *hver kallende worker autentiserer
   sine egne sluttbrukere*.
2. **`X-API-Token`** → SHA-256 → `api_tokens`, sjekker `is_active` + `expires_at`, oppdaterer
   `last_used_at`, returnerer `user_id` + scopes.
3. **`x-user-role` + `X-Session-Token`** → `config.emailVerificationToken`. Rolle/e-post leses fra
   *raden*, ikke fra headerne. Gir `scopes: ['all']`, `userId = email`. Herdet 2026-09-26.
4. **`x-plugin-authenticated: true`** → `scopes: ['all']`, `userId` fra klientvalgt `x-user-id`.
5. **Trusted origin** — `Origin` i en liste på 6 → `scopes: ['all']`, `userId: null`.

**Identiteten er ikke konsistent:** `userId` er `api_tokens.user_id` for metode 2, `email` for
metode 3, `null` for metode 1 og 5. Et `graphService` som skal eie `createdBy` og `checkAccess`
trenger én normalisert aktør (`{ userId, email, role, authMethod }`).

### Beviste sikkerhetsfunn (probet live, ikke utledet)

**F1 — private grafer er ikke private ved direkte lesing.**
```
curl "https://knowledge.vegvisr.org/getknowgraph?id=<draft-graf>"      → HTTP 200, 33 419 B, 17 noder
```
Ingen headere i det hele tatt. Grafen har `publicationState: "draft"`. `publicationState` skjuler
grafer fra *lister*, men `getknowgraph?id=` har **ingen eierskapssjekk overhodet**. Krav 4
(«brukeren kan bare lese grafer brukeren har tilgang til») er altså ikke oppfylt i dag, og kan ikke
oppfylles ved å gjenbruke `getknowgraph` som den står.

**F2 — `Origin`-header omgår ugyldig token.**
```
X-API-Token: <oppdiktet>                                → HTTP 401
X-API-Token: <oppdiktet>  +  Origin: https://www.vegvisr.org → HTTP 200
```
`isTrustedOrigin` får et *ugyldig* token til å falle gjennom til metode 5, som gir `scopes: ['all']`.
`Origin` er klientkontrollert — `curl -H` setter den fritt. Dette er samme klasse som hullet som ble
lukket 2026-09-26 (den gang «manglende Origin»); trusted-origin-grenen står fortsatt åpen.
*Lesing er probet (200 over). At samme gren også gir skrivetilgang er lest ut av koden —
`hasScope(['all'], 'graph:write')` returnerer true — og er **ikke** probet, fordi en probe ville
skrevet til produksjonsdata.*

**F3** — `x-plugin-authenticated: true` er en ren klientpåstand som gir `scopes: ['all']` med
klientvalgt `x-user-id`. Nøyaktig det mønsteret oppgaven forbyr.

**F4** — `createdBy` kommer fra request-body, aldri fra autentisert bruker (krav 3 ikke oppfylt).

**F5** — ingen rate limiting er aktiv, selv om `rate_limit` og `api_token_usage` finnes.

---

## 7. Eksisterende OAuth-/MCP-avhengigheter

Ingen MCP-**server** finnes noe sted i monorepoet (`grep` på `tools/list`, `jsonrpc`,
`StreamableHTTP` → 0 treff). Ingen `oauth`-tabeller i D1.

I monorepo-roten: `@openauthjs/openauth@0.4.3` (ubrukt i workerne), `hono@4.7.4`, `jose@6.0.10`,
`jsonwebtoken`, `uuid@11`. Agent-Builder har en MCP-**klient** (`mcp_call` i
`worker/tool-executors.js`) og `agents@^0.10.1`.

**Versjoner sjekket i dag mot npm (ikke antatt):**

| pakke | siste | kommentar |
|---|---|---|
| `@modelcontextprotocol/sdk` | **1.30.1** | — |
| `@cloudflare/workers-oauth-provider` | **1.1.0** | 1.x har brytende endringer fra 0.x |
| `agents` | **0.24.0** | Agent-Builder ligger på 0.10.1 — langt bak |
| `zod` | **4.6.5** | MCP SDK-en bruker zod-skjemaer |

`workers-oauth-provider@1.1.0` er lest lokalt (`npm pack` + README/docs). Relevant for arkitekturen:
- Enkel-worker-formen `new OAuthProvider({ apiRoute: '/mcp', apiHandler, defaultHandler })` sender
  **alt som ikke er et OAuth-endepunkt til `defaultHandler` urørt**.
- Den publiserer selv RFC 9728 `/.well-known/oauth-protected-resource<path>` og
  authorization-server-metadata, håndterer PKCE, dynamisk klientregistrering, refresh-rotasjon og
  `insufficientScope()`-403 med scope-challenge.
- Krever KV bundet som `OAUTH_KV`.
- `/authorize` er **vår** kode (`defaultHandler`) — biblioteket er ikke en identitetsleverandør.
  Der plugges OTP-en inn, via `parseAuthRequest()` → egen OTP-UI → `completeAuthorization({ props, scope })`.
- `agents`' `McpAgent` er Durable-Object-basert (stateful) og **passer ikke** kravet om stateless
  Streamable HTTP. Droppes.

---

## Målarkitektur — anbefaling

**Alternativ A (anbefalt): `/mcp` inne i `knowledge-graph-worker`.**

```
dev-worker/
  index.js            ← uendret rutetabell, wrappet av OAuthProvider sin defaultHandler
  graph-service.js    ← NY: felles lag
  mcp/
    server.js         ← stateless Streamable HTTP på POST /mcp
    tools.js          ← 4 verktøy, zod-validert
  oauth/
    authorize.js      ← OTP-innloggingsside + samtykke
    otp.js            ← sms-worker sin identitetsbinding + brand-worker sine tellere
```

```
REST-handler ─┐
              ├── graphService ── D1 (vegvisr_org)
MCP-verktøy ──┘
```

Hvorfor A: gir nøyaktig `https://knowledge.vegvisr.org/mcp` som spesifisert; `graphService` blir en
**delt modul i samme worker** — bokstavelig talt diagrammet i oppgaven, ikke et HTTP-hopp; ruten
`knowledge.vegvisr.org/*` finnes allerede; npm- og fler-fils-mønstrene er bevist i repoet.

Risiko: en 11k-linjers produksjonsworker med 58 ruter berøres. Dempet av at `OAuthProvider`
delegerer alt ikke-OAuth til `defaultHandler` uendret, og av at ingen av OAuth-stiene kolliderer
med eksisterende ruter (verifisert).

**Alternativ B: egen `mcp-worker` på en mer spesifikk rute `knowledge.vegvisr.org/mcp*`.**
Mindre blast radius, men `graphService` må da nås over service binding — som gir `scopes:['all']`
og **ingen brukeridentitet** (metode 1) — eller dupliseres. Det bryter med «samme interne
tjenestefunksjoner». Krever dashboard-endring for ruten. **Anbefales ikke** med mindre du vil
holde dev-worker helt urørt.

### Tilgangsmodell for MCP (F1 er ikke løsbar ved gjenbruk alene)
`checkAccess` i `graphService` håndheves **på MCP-stien**, med `actor` fra validert OAuth-token:
eier = `metadata.createdBy` / `created_by` lik aktørens e-post, eller `user_id`-match, eller
`publicationState === 'published'` for lesing, eller rolle Superadmin.
REST-handlerne beholder dagens kontrakt uendret (krav: eksisterende klienter skal fortsette å virke).
**379 grafer har ikke e-postformet eier** — de blir utilgjengelige over MCP for andre enn Superadmin.
Det er riktig standardvalg (fail closed), men det er en atferdsendring å være klar over.

### Migreringer
1. `api_scopes` += rad `graph:publish` (og `graph:delete` finnes allerede).
2. Nye tabeller **eller** KV for OAuth-tilstand. `workers-oauth-provider` bruker **KV** (`OAUTH_KV`)
   for klienter, grants, koder og tokens → **ny KV-namespace**, ingen D1-migrasjon for OAuth-kjernen.
3. Ny D1-tabell `oauth_otp_challenges` (eller KV-nøkler) som binder OTP-utfordringen til
   OAuth-transaksjonen: `tx_id, phone_hash, code_hash, expires_at, tries, sends, client_id, created_at`.
   Egen lagring — ikke `config.phone_verification_code`, slik at en OAuth-OTP ikke kan gjenbrukes
   som web-innlogging og ikke setter det permanente `phone_verified_at`-flagget.
4. Revisjonstabell `mcp_audit_log`: `ts, user_id, client_id, tool, graph_id, result_code, duration_ms`.

### Verifisert: URL-formatene
`https://editor.vegvisr.org/?graphId=…` → 200 og `https://editor.vegvisr.org/view?graphId=…` → 200.
(Begge er SPA-skallet, så 200 beviser at vertsnavnet og rutingen finnes, ikke at grafen laster.)

---

## Fase 2 — implementasjonsplan (rekkefølge)

1. **`graph-service.js`** — rent uttrekk, ingen kontraktsendring. REST-handlere blir wrappere.
   Regresjonstest de 58 rutene før noe annet bygges.
2. **Aktør-normalisering** — `validateAuth` returnerer `{ userId, email, role, authMethod }` konsist.
   `graphService` tar `actor` som eksplisitt argument; `createdBy` settes fra `actor`, aldri fra body.
3. **`checkAccess`** — håndhevet på MCP-stien.
4. **OAuth-lag** — `OAuthProvider` med `apiRoute: '/mcp'`, `defaultHandler` = dagens `fetch`.
   KV `OAUTH_KV`. Discovery og protected-resource-metadata kommer fra biblioteket.
5. **OTP i `/authorize`** — `parseAuthRequest` → telefonskjema → `send-otp` (tellere fra brand-worker,
   identitetsoppslag fra sms-worker, uniform respons uansett om nummeret finnes) → kodeskjema →
   verifisering → scope-samtykke → `completeAuthorization({ props: { userId, email, role }, scope })`.
6. **Stateless Streamable HTTP `/mcp`** — `POST` med JSON-RPC, `sessionIdGenerator: undefined`.
   `tools/list` + `tools/call`.
7. **De fire verktøyene** — `create_graph`, `get_graph`, `add_node`, `get_graph_links`, zod-validert,
   strukturerte feilkoder (`UNAUTHENTICATED`, `INSUFFICIENT_SCOPE`, `FORBIDDEN_GRAPH`,
   `INVALID_INPUT`, `GRAPH_NOT_FOUND`, `VERSION_CONFLICT`, `RATE_LIMITED`, `INTERNAL_ERROR`).
8. **Revisjonslogg** — uten OTP, tokens, koder eller Authorization-header.

### Sikkerhetsfunn som *ikke* er del av MCP-oppgaven, men bør besluttes
F2 (Origin-omgåelse) og F3 (`x-plugin-authenticated`) ligger i `validateAuth` og rammer dagens REST
API, ikke MCP-stien. MCP-stien blir trygg uansett fordi identiteten der kommer fra et validert
OAuth-token. Men så lenge F2 står åpen, kan *hvem som helst* skrive til enhver graf over REST —
og da er MCP-lagets eierskapskontroll verdt mindre i praksis. Anbefaling: lukk F2/F3 i en egen,
liten endring før eller parallelt med Fase 2. Krever egen godkjenning fordi den kan brekke klienter
som i dag lener seg på trusted-origin.

---

## Åpne avgjørelser (trenger svar før Fase 2)

**A. Telefondekning — 33 av 46 brukere har ikke telefonnummer.**
Ren telefon-OTP som eneste OAuth-innlogging stenger dem ute til de registrerer nummer.
- **A1** Telefon-OTP som spesifisert. De 33 må registrere nummer først. *(matcher oppgaven)*
- **A2** E-post magic-link (dagens primære flyt) **eller** telefon-OTP i samme `/authorize`-side.
- **A3** Magic-link først, så OTP — speiler `LoginView.vue` sin faktiske rekkefølge i dag.

**B. Alternativ A eller B for hvor `/mcp` bor.** (Anbefaling: A.)

**C. Lukke F2/F3 nå, parallelt, eller senere?**

---

# Fase 2 — framdrift

**Besluttet 2026-09-27:** A3 (magic-link først, så OTP) · Alternativ A (`/mcp` i dev-worker) ·
F2/F3 lukkes parallelt.

## Increment 1 — LEVERT, commit `ef36f9b` i vegvisr-frontend (ikke deployet)

`dev-worker/graph-service.js` (764 linjer) er nå den ENE interne implementasjonen.
`/getknowgraph`, `/saveGraphWithHistory` og `/addNode` er koblet til den. Duplikatene
`insertNodeIntoGraph`, inline `sanitizeGraphData` og data-node-kryptohjelperne er fjernet.
index.js: 11 162 → 10 884 linjer.

Nytt som ikke fantes: `checkAccess()`, normalisert `actor`, `createdBy` stemplet fra
autentisert bruker. Håndheves på MCP-stien; REST beholder sin kontrakt.

**F2 lukket (stage 1):** ugyldig/inaktivt/utløpt `X-API-Token` faller ikke lenger gjennom til
trusted-origin. Den gamle gjennomfallet bar én legitim last — frontenden sender sesjonstokenet
i `X-API-Token` — og det er nå håndtert ordentlig: `api_tokens` først, deretter
`config.emailVerificationToken`. Disse kallerne autentiseres nå som seg selv.

**F3 lukket:** `x-plugin-authenticated` autentiserer ikke lenger. Identiteten rir på en
modul-privat `Symbol` på Request-objektet (HTTP kan ikke sette en Symbol). Fikset samtidig at
plugin-proxyen returnerte 401 fordi `x-user-role` traff sesjons-grenen først.

**Verifikasjon:** 41 unit-assertions mot ekte SQLite med produksjonsskjemaet +
28/28 prober mot en lokalt kjørende worker (`wrangler dev --local`), inkludert regresjon av
REST-kontraktene og re-probe av begge hullene.

### F2 stage 2 — LEVERT, commit `47d2de5` (ikke deployet)

Trusted-origin-grenen er **kappet til `graph:read`** i stedet for slettet. Lesing gjennom den
koster ingenting som ikke alt er tilgjengelig (`getknowgraph?id=` er åpent uansett), mens sletting
ville kuttet lesetrafikk fra hello.vegvisr.org, dashboard.vegvisr.org og mystmkra.io som dette
repoet ikke kan kartlegge.

Frontenden sluttet først å være avhengig av den: 30 kallsteder som sendte **ingen** auth-header
sender nå sesjonstokenet gjennom `src/utils/kgAuth.js` — én hjelper, ikke 30 inline-literaler.
Revisjon over alle KG-skrivekall i `src/`: **63 med auth, 0 uten**.

Verifisert i Workers-runtime: `addNode`, `saveGraphWithHistory`, `patchNode` og
`patchGraphMetadata` gjennom trusted origin uten token gir nå **403** der de ga 200. Lesing gir
fortsatt 200. Header-paret `kgAuthHeaders` produserer skriver OK. 14/14 prober, bygget går,
41 + 6 unit-assertions.

**WATCH ON DEPLOY:** en trusted origin utenfor dette repoet som skriver uten token får nå 403.
Workerens egen kommentar navngir helloworlds `save-hello.js`; den filen ligger i et annet repo og
kunne ikke leses herfra.

### Pre-eksisterende arbeid jeg ikke sjekket først
`c215cf4` (2026-09-26 22:59) la `X-Session-Token` på 28 kallsteder i GrokChatPanel, GNewViewer,
GnewAdmin, GraphPortfolio — de som *feilet* med 401. `346c820` (2026-09-27 08:05) lukket
no-Origin-hullet. Mitt arbeid er komplementært (mine 30 sendte ingen header i det hele tatt), men
historikken i vegvisr-frontend burde vært lest før redigering.

### Opprinnelig kartlegging (for historikken)
Trusted origin UTEN token gir fortsatt `scopes:['all']`. Verifisert fortsatt åpen (200).
Årsak: ~45 kallsteder kaller `/saveGraphWithHistory` uten auth-header i det hele tatt:

| fil | kall |
|---|---|
| `views/GraphViewer.vue` | 17 |
| `views/GNewViewer.vue` | 17 (sender X-Session-Token — OK) |
| `components/GNewImageEditHandler.vue` | 5 |
| `views/GraphCanvas.vue` | 3 |
| `components/CopyNodeModal.vue` | 2 |
| `components/GNewNodes/GNewPasswordProtectionNode.vue` | 2 |
| `views/GraphAdmin.vue` | 1 |

Å lukke det i workeren alene brekker editoren. Krever at disse sender `X-Session-Token`
(mønsteret finnes allerede i `GNewViewer.vue`/`GrokChatPanel.vue`). Egen slice, egen
Pages-deploy.
