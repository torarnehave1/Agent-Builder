/**
 * Photo Album / Image Management Subagent
 *
 * Handles album listing, browsing, creation, image add/remove, publishing
 * (with shareId), upload-from-url, and soft-delete cascades.
 *
 * Backing workers (via service bindings):
 *   - ALBUMS_WORKER (albums.vegvisr.org)  → /photo-album*
 *   - PHOTOS_WORKER (photos-api.vegvisr.org) → /upload, /list-r2-images, /delete-r2-image
 *
 * Auth: X-API-Token = the user's emailVerificationToken, plumbed via
 * authContext.authToken from the main agent loop.
 *
 * Three gotchas the subagent must respect:
 *   1. album_list is NOT owner-filtered server-side. Filter by createdBy
 *      matching the user's email/userId for "show MY albums".
 *   2. /upload and /delete-r2-image are NOT auth-gated in the underlying
 *      workers. The subagent still passes the token (no harm) and treats
 *      destructive ops conservatively.
 *   3. photos_delete CASCADES — it removes the key from every album that
 *      references it. The subagent should warn the user before calling on
 *      a key referenced by multiple albums.
 */

import { TOOL_DEFINITIONS } from './tool-definitions.js'
import { DEFAULT_MODEL } from './models.js'

// ---------------------------------------------------------------------------
// System Prompt
// ---------------------------------------------------------------------------

const ALBUM_SUBAGENT_SYSTEM_PROMPT = `You are a Photo Album & Image specialist for the Vegvisr platform. You manage photo albums (records in KV) and the images inside them (objects in R2).

## Your Tools

Album CRUD (albums.vegvisr.org):
1. \`album_list\` — list all album names, or with includeMeta:true return {name, createdBy, createdAt, updatedAt} for each
2. \`album_get\` — fetch one album by name (images, share state, audit log, SEO fields)
3. \`album_create_or_update\` — create or fully upsert an album (images REPLACES the array; use album_add_images for incremental adds)
4. \`album_delete\` — delete an album entirely (does NOT delete the underlying R2 images)
5. \`album_add_images\` — append R2 keys to an album (deduped; re-adding is a no-op)
6. \`album_remove_images\` — remove R2 keys from an album (auto-rewrites seoImageKey if the removed key was the cover)
7. \`album_publish\` — set isShared:true and mint a shareId UUID
8. \`album_rotate_share\` — issue a fresh shareId (invalidates old share URLs)

Photo operations (photos-api.vegvisr.org):
9. \`photos_list\` — list images: no params (all in bucket), ?album=<name> (one album), ?share=<shareId> (public read of a shared album)
10. \`photos_upload_from_url\` — upload an image to R2 by fetching it from a public URL; optionally attach to an album in the same call
11. \`photos_delete\` — soft-delete an image (moves to trash/) AND CASCADES: walks every album in KV and removes the key. Recoverable via restore.

## Critical rules

- The album list is NOT owner-filtered. Every authenticated user sees every album. When the user asks for "my albums", filter the result client-side by \`createdBy\` matching the user's email or userId.
- \`photos_delete\` cascades. Before calling it on a key, consider calling \`album_list\` + \`album_get\` to count how many albums reference the key. If more than one, surface that to the user and confirm before proceeding.
- When uploading from a URL, the resulting R2 key is what goes into albums — capture the \`key\` field from the response, not the imgix URL.
- \`album_create_or_update\` is a full upsert. If the user wants to add an image to an existing album, use \`album_add_images\` (incremental, deduped), NOT album_create_or_update with the new array.
- \`isShared:true\` mints a shareId only if none exists. Use \`album_rotate_share\` to force a new one.
- Album names are normalised by trim() server-side. Whitespace at edges is stripped silently.
- **Per-image metadata lives in \`photos_list\`, not \`album_get\`.** \`album_get\` returns the album RECORD — image *keys*, album-level SEO fields (seoTitle / seoDescription / seoImageKey), share state, audit log. It does NOT include per-image \`displayName\`, \`name\`, or \`tags\`. For any user question about image-level metadata (tags, descriptive names, captions per image), use \`photos_list\` with \`album:<name>\` — that endpoint populates \`displayName\` / \`name\` / \`tags\` from the \`image-meta:{key}\` KV.

## Workflows

### Show the user their albums
1. \`album_list\` with \`includeMeta:true\`
2. Filter by createdBy matching the user's identity
3. Summarise: name + createdAt + image count (if known)

### Show what is in an album
1. \`photos_list\` with \`album:<name>\` — returns image keys + imgix URLs (and per-image metadata if populated).
2. Render image URLs as markdown images: \`![<displayName or key>](<url>)\`.

### Show image-level metadata for an album
For "what tags/names/labels are on the images in album X" or any question about per-image metadata (NOT album-level fields):
1. \`photos_list\` with \`album:<name>\` — NOT \`album_get\`.
2. Inspect the \`displayName\` / \`name\` / \`tags\` fields on each returned image. Untagged images simply have these fields null or empty — that means metadata was never set, not that the endpoint doesn't expose it.
3. Summarise: how many images have metadata, sample of tags, any patterns. Mention untagged count if relevant.

### Add an image (URL or existing key) to an album
- If user gave a public URL: \`photos_upload_from_url\` with \`url\` + \`album\` — one call.
- If user gave an R2 key already in the bucket: \`album_add_images\` with the key.

### Publish an album for sharing
1. \`album_publish\` with the album name
2. Report the resulting share URL: \`https://seo.vegvisr.org/album/{shareId}\`

### Remove an image
- From one album only: \`album_remove_images\`.
- From everywhere (soft-delete from R2): \`photos_delete\`. WARN the user first if the key is in multiple albums (it cascades).

After completing your task, provide a brief summary of what you did. Include any keys, share URLs, or album names that the main agent should surface to the user.`

// ---------------------------------------------------------------------------
// Tool set
// ---------------------------------------------------------------------------

const ALBUM_SUBAGENT_TOOL_NAMES = new Set([
  'album_list',
  'album_get',
  'album_create_or_update',
  'album_delete',
  'album_add_images',
  'album_remove_images',
  'album_publish',
  'album_rotate_share',
  'photos_list',
  'photos_upload_from_url',
  'photos_delete',
])

function getAlbumSubagentTools() {
  return TOOL_DEFINITIONS.filter(t => ALBUM_SUBAGENT_TOOL_NAMES.has(t.name))
}

// ---------------------------------------------------------------------------
// Inner agent loop
// ---------------------------------------------------------------------------

async function runAlbumSubagent(input, env, onProgress, executeTool) {
  const { task, albumName, userId, authContext } = input
  const maxTurns = 10
  const model = env.SUBAGENT_MODEL || DEFAULT_MODEL
  let inputTokens = 0
  let outputTokens = 0

  const log = (msg) => console.log(`[album-subagent] ${msg}`)
  const progress = typeof onProgress === 'function' ? onProgress : () => {}

  const thinkingMessages = [
    'Opening the photo library...',
    'Looking through albums...',
    'Loading the image list...',
    'Working with R2 storage...',
    'Updating album metadata...',
    'Confirming the changes...',
    'Tidying up...',
    'Almost done...',
    'Finalising...',
    'Complete.',
  ]

  const toolMessages = {
    album_list:              ['Listing albums...', 'Browsing the photo library...'],
    album_get:               ['Loading album details...', 'Reading the album...'],
    album_create_or_update:  ['Saving album...', 'Writing the album record...'],
    album_delete:            ['Deleting album...', 'Removing from the library...'],
    album_add_images:        ['Adding images to album...', 'Linking images...'],
    album_remove_images:     ['Removing images from album...', 'Unlinking images...'],
    album_publish:           ['Publishing album...', 'Generating share link...'],
    album_rotate_share:      ['Rotating share link...', 'Issuing new shareId...'],
    photos_list:             ['Listing photos...', 'Reading the bucket...'],
    photos_upload_from_url:  ['Uploading image...', 'Fetching and storing...'],
    photos_delete:           ['Soft-deleting image...', 'Moving to trash and updating albums...'],
  }

  let userMessage = `## Task\n${task}`
  if (albumName) userMessage += `\n\n## Context\n- albumName: ${albumName}`
  if (authContext?.email) userMessage += `\n- user email: ${authContext.email}`
  if (authContext?.userId) userMessage += `\n- user userId: ${authContext.userId}`

  const messages = [{ role: 'user', content: userMessage }]
  const tools = getAlbumSubagentTools()
  let turn = 0
  const actions = []

  log(`started | albumName=${albumName || 'none'} task="${task.slice(0, 100)}"`)
  progress('Opening the photo library...')

  while (turn < maxTurns) {
    turn++
    log(`turn ${turn}/${maxTurns}`)
    progress(thinkingMessages[turn - 1] || `Still working... (${turn})`)

    const response = await env.ANTHROPIC.fetch('https://anthropic.vegvisr.org/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: userId || 'album-subagent',
        apiKey: env.ANTHROPIC_API_KEY || undefined,
        messages,
        model,
        max_tokens: 4096,
        temperature: 0.2,
        system: ALBUM_SUBAGENT_SYSTEM_PROMPT,
        tools,
      }),
    })

    const data = await response.json()
    if (!response.ok) {
      log(`ERROR: ${JSON.stringify(data.error)}`)
      return {
        success: false,
        error: data.error || 'Anthropic API error',
        turns: turn,
        actions,
        inputTokens,
        outputTokens,
      }
    }

    if (data.usage) {
      inputTokens += data.usage.input_tokens || 0
      outputTokens += data.usage.output_tokens || 0
    }

    if (data.stop_reason === 'end_turn') {
      const text = (data.content || []).filter(c => c.type === 'text').map(b => b.text).join('\n')
      log(`end_turn — summary: ${text.slice(0, 200)} | tokens in=${inputTokens} out=${outputTokens}`)
      return {
        success: true,
        summary: text,
        turns: turn,
        actions,
        model,
        albumName: albumName || actions.find(a => a.albumName)?.albumName,
        inputTokens,
        outputTokens,
      }
    }

    if (data.stop_reason === 'tool_use') {
      const toolUses = (data.content || []).filter(c => c.type === 'tool_use')
      log(`tool_use — ${toolUses.length} tools: [${toolUses.map(t => t.name).join(', ')}]`)

      const toolResults = []
      for (const toolUse of toolUses) {
        const msgs = toolMessages[toolUse.name] || [`Working on ${toolUse.name}...`]
        progress(msgs[Math.floor(Math.random() * msgs.length)])
        try {
          const result = await executeTool(
            toolUse.name,
            { ...toolUse.input, userId, authContext },
            env,
            {},
          )

          const resultStr = JSON.stringify(result)
          actions.push({
            tool: toolUse.name,
            success: true,
            albumName: toolUse.input?.name || toolUse.input?.album || result?.albumName,
            summary: result?.message || `${toolUse.name} ok`,
          })

          const truncated = resultStr.length > 8000
            ? resultStr.slice(0, 8000) + '... [truncated]'
            : resultStr

          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: truncated,
          })
        } catch (error) {
          log(`${toolUse.name} FAILED: ${error.message}`)
          actions.push({ tool: toolUse.name, success: false, error: error.message })
          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: JSON.stringify({ error: error.message }),
          })
        }
      }

      messages.push(
        { role: 'assistant', content: data.content },
        { role: 'user', content: toolResults },
      )
    } else {
      log(`stop_reason: ${data.stop_reason}`)
      messages.push(
        { role: 'assistant', content: data.content },
        { role: 'user', content: 'Continue. You have more turns available.' },
      )
    }
  }

  log(`max turns reached (${maxTurns}) | tokens in=${inputTokens} out=${outputTokens}`)
  return {
    success: actions.some(a => a.success),
    summary: `Album subagent completed ${actions.length} actions in ${turn} turns (max turns reached).`,
    turns: turn,
    actions,
    model,
    albumName: albumName || actions.find(a => a.albumName)?.albumName,
    inputTokens,
    outputTokens,
    maxTurnsReached: true,
  }
}

export { runAlbumSubagent }
