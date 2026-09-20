// chat-sidebar's pure parts, extracted from the REAL component source so the test can never
// drift from what is served. What these guard, all verified against the live API on 2026-09-13:
//  1. Identity comes from the token vegvisr-auth stores, exchanged at /userdata-from-token —
//     NEVER from GET /userdata?email=, which answers anyone with no auth and hands back the
//     account's phone and emailVerificationToken (its API credential).
//  2. group_messages and group_members carry user_id only — no display name exists anywhere in
//     the API — so a stable short label is derived rather than a raw UUID being printed.
//  3. created_at is written with Date.now() (ms); a seconds value must not render as 1970.
//  4. Polling merges on an `after` cursor, so an overlap must not print a message twice.
//
// Run:  node worker/test-chat-sidebar.mjs   (exit 0 = pass, 1 = fail)

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const dir = path.dirname(fileURLToPath(import.meta.url))
const src = fs.readFileSync(path.join(dir, 'components/chat-sidebar.js'), 'utf8')

// Helpers live at two-space indent inside the component's IIFE (it must not leak globals onto a
// customer page), so split on that rather than on column-zero functions.
const parts = {}
for (const part of src.split(/\n(?=  function\s)/)) {
  const nm = part.match(/^\s*function\s+(\w+)\s*\(/)
  if (nm) parts[nm[1]] = part
}
const need = [
  'parseSide', 'clampPoll', 'clampWidth', 'tokenFromStores', 'isBot', 'isMine',
  'shortLabel', 'messageKind', 'fmtTime', 'mergeMessages', 'lastId', 'sessionToken',
]
for (const n of need) {
  if (!parts[n]) { console.error(`FAIL: function ${n} not found in components/chat-sidebar.js`); process.exit(1) }
}
const consts = src.match(/^\s*var (DEFAULT_POLL) = .*$/gm) || []
if (!consts.length) { console.error('FAIL: DEFAULT_POLL not found'); process.exit(1) }
const api = new Function(`${consts.join('\n')}\n${need.map(n => parts[n]).join('\n')}\nreturn { ${need.join(', ')} }`)()

let failed = 0
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : `\n      ${detail}`}`)
  if (!ok) failed += 1
}

// 1. Side and sizing.
check('data-side="left" is honoured', api.parseSide('left') === 'left')
check('data-side="LEFT " is honoured', api.parseSide('LEFT ') === 'left')
check('anything else is the right edge', api.parseSide('') === 'right' && api.parseSide(null) === 'right' && api.parseSide('top') === 'right')

// A NaN interval is the dangerous one: setInterval(fn, NaN) fires as fast as it can.
check('an unparseable poll falls back to the default', api.clampPoll('abc') === 6 && api.clampPoll(null) === 6)
check('a poll below 2s is raised (D1 worker protection)', api.clampPoll('0.2') === 2 && api.clampPoll('-5') === 6)
check('a poll above 60s is capped', api.clampPoll('600') === 60)
check('a sane poll is kept', api.clampPoll('10') === 10)
check('width is clamped to a usable panel', api.clampWidth('50') === 260 && api.clampWidth('9000') === 720 && api.clampWidth('400') === 400)
check('a missing width is the default', api.clampWidth(null) === 380)

// 2. Reading the token vegvisr-auth left behind — the ONLY identity path this component uses.
check('reads the current vegvisr_user shape',
  api.tokenFromStores({ vegvisr_user: JSON.stringify({ email: 'a@b.c', role: 'User', token: 'tok-1' }) }) === 'tok-1')
check('reads the legacy user shape with emailVerificationToken',
  api.tokenFromStores({ user: JSON.stringify({ user: { email: 'a@b.c', emailVerificationToken: 'tok-2' } }) }) === 'tok-2')
check('reads the legacy userStore shape',
  api.tokenFromStores({ userStore: JSON.stringify({ email: 'a@b.c', token: 'tok-3' }) }) === 'tok-3')
check('a signed-out visitor yields no token', api.tokenFromStores({}) === null)
check('corrupt JSON in one key does not hide a good token in the next',
  api.tokenFromStores({ vegvisr_user: '{not json', user: JSON.stringify({ token: 'tok-4' }) }) === 'tok-4')
check('a stored record without a token yields null',
  api.tokenFromStores({ vegvisr_user: JSON.stringify({ email: 'a@b.c' }) }) === null)

const sessionRoot = value => ({ hasAttribute: () => value !== undefined, getAttribute: () => value })
const previousStore = { vegvisr_user: JSON.stringify({ token: 'previous-user' }) }
check('an explicit session wins over a different stored user',
  api.sessionToken(sessionRoot('current-user'), previousStore) === 'current-user')
check('an explicitly empty session never falls back to a stored user',
  api.sessionToken(sessionRoot(''), previousStore) === null)
check('existing embeds retain storage-based authentication',
  api.sessionToken(sessionRoot(undefined), previousStore) === 'previous-user')

// 3. Who wrote it. No display names exist in this API.
check('a bot id is recognised', api.isBot('bot:2f1c-…') && !api.isBot('2f1c-…'))
check('my own message is mine', api.isMine({ user_id: 'u-1' }, 'u-1'))
check("someone else's message is not", !api.isMine({ user_id: 'u-2' }, 'u-1'))
check('with no identity nothing is mine', !api.isMine({ user_id: 'u-1' }, null))
check('a bot gets the bot label', api.shortLabel('bot:abcd1234', { bot: 'Bot' }) === 'Bot')
check('a uuid becomes a short stable label that fits the 30px avatar',
  api.shortLabel('9f3a2b1c-dead-4f00-9999-000000000001', {}) === '9F3')
check('the same id always gives the same label',
  api.shortLabel('9f3a2b1c-dead', {}) === api.shortLabel('9f3a2b1c-dead', {}))
check('a missing id does not crash the bubble', api.shortLabel('', {}) === '?' && api.shortLabel(null, {}) === '?')

// 4. Message kinds — the panel must render media as media, not as an empty bubble.
check('a plain message is text', api.messageKind({ message_type: 'text', body: 'hei' }) === 'text')
check('no message_type at all is text', api.messageKind({ body: 'hei' }) === 'text')
check('an image message is an image', api.messageKind({ message_type: 'image', media_url: 'u' }) === 'image')
check('a video message is a video', api.messageKind({ message_type: 'video', media_url: 'u' }) === 'video')
check('a voice message is voice', api.messageKind({ message_type: 'voice', audio_url: 'u' }) === 'voice')
check('message_type "audio" is normalised to voice', api.messageKind({ message_type: 'audio' }) === 'voice')
check('kind falls back to the media content type',
  api.messageKind({ media_content_type: 'image/png', media_url: 'u' }) === 'image' &&
  api.messageKind({ media_content_type: 'video/mp4', media_url: 'u' }) === 'video')
check('an audio_url alone still reads as voice', api.messageKind({ audio_url: 'u' }) === 'voice')

// 5. Timestamps. created_at is Date.now() milliseconds.
check('a millisecond timestamp renders', api.fmtTime(1757700000000, 'no').length > 0)
check('a seconds timestamp is not rendered as 1970',
  api.fmtTime(1757700000, 'no') === api.fmtTime(1757700000000, 'no'),
  `${api.fmtTime(1757700000, 'no')} vs ${api.fmtTime(1757700000000, 'no')}`)
check('a missing timestamp is blank, not "NaN"', api.fmtTime(null, 'no') === '' && api.fmtTime(0, 'no') === '')
check('a junk timestamp is blank', api.fmtTime('soon', 'no') === '')

// 6. The polling merge.
const first = [{ id: 1, body: 'a' }, { id: 2, body: 'b' }]
check('new rows append', api.mergeMessages(first, [{ id: 3, body: 'c' }]).length === 3)
check('an overlapping cursor does not duplicate',
  api.mergeMessages(first, [{ id: 2, body: 'b' }, { id: 3, body: 'c' }]).length === 3)
check('order stays ascending by id',
  api.mergeMessages([{ id: 5 }], [{ id: 2 }, { id: 9 }]).map(m => m.id).join(',') === '2,5,9')
check('an empty poll changes nothing', api.mergeMessages(first, []).length === 2)
check('a row with no id is ignored rather than crashing', api.mergeMessages(first, [{ body: 'x' }]).length === 2)
check('merge does not mutate what is on screen', first.length === 2)
check('the cursor is the highest id seen', api.lastId([{ id: 3 }, { id: 11 }, { id: 7 }]) === 11)
check('an empty conversation starts the cursor at 0', api.lastId([]) === 0 && api.lastId(null) === 0)

// 7. The rule that motivated the whole identity design: the leaky endpoint is never called.
// Comments are stripped first — the header explains at length WHY that endpoint is avoided, and
// a naive substring test on the whole file matches that explanation instead of a real call.
const code = src.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n')
check('the component never calls /userdata?email=', !/userdata\?email=/.test(code))
check('the component uses /userdata-from-token', src.indexOf('/userdata-from-token') !== -1)
check('the identity call sends a Bearer token', /Authorization: 'Bearer '/.test(src))

console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll checks passed.')
process.exit(failed ? 1 : 0)
