/**
 * A pasted wall of text must never reach the model, and the stand-in must tell the agent exactly
 * how to place it (2026-09-12: an 80 KB transcript timed out the turn twice and never became a node).
 *
 * Run:  node_modules/.bin/esbuild src/lib/largePaste.test.ts --bundle --platform=node
 *         --format=esm --outfile=/tmp/lp.mjs && node /tmp/lp.mjs
 */
import {
  LARGE_PASTE_CHARS,
  PASTE_PREVIEW_CHARS,
  isLargePaste,
  derivePasteTitle,
  buildPasteStandIn,
  holdLargePaste,
} from './largePaste';

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : `\n      ${detail}`}`);
  if (!ok) failed += 1;
};

const short = 'Legg til en ny fulltext node som er tom';
const transcript =
  '[0:00 – 2:00] Ja sant, på en fin dag så går det meste an. Det er veldig koselig faktisk.\n' +
  '[2:00 – 4:00] Men du har hatt en fin sommer. Har du vært ute og reist?\n'.repeat(900);

check('a normal message is not held', holdLargePaste(short, 'tx_1') === null);
check('a transcript-sized paste is held', !!holdLargePaste(transcript, 'tx_1'));
check('the threshold is characters, not lines', isLargePaste('x'.repeat(LARGE_PASTE_CHARS)) && !isLargePaste('x'.repeat(LARGE_PASTE_CHARS - 1)));

const held = holdLargePaste(transcript, 'tx_1')!;
check('the handle is carried', held.handle === 'tx_1' && held.standIn.includes('[transcript:tx_1]'));
check('the full text is kept for the browser', held.text === transcript);
check('the stand-in is orders of magnitude smaller', held.standIn.length < transcript.length / 10, `${held.standIn.length} vs ${transcript.length}`);
check('only a bounded preview is shown', held.standIn.length < PASTE_PREVIEW_CHARS + 800);
check('the stand-in names the tool that places it', held.standIn.includes('save_transcript_to_graph'));
check('the stand-in forbids asking the user to paste again', /never ask the user to paste it again/i.test(held.standIn));
check('the stand-in says the body is not in the conversation', /not in this conversation/i.test(held.standIn));
check('the character count is stated', held.standIn.includes(transcript.length.toLocaleString('en-US')));

check('a leading timestamp is stripped from the title', !derivePasteTitle(transcript).startsWith('[0:00'));
check('the title is a usable node label', derivePasteTitle(transcript).length > 3 && derivePasteTitle(transcript).length <= 60);
check('an empty paste still yields a title', derivePasteTitle('') === 'Innlimt tekst');
check('a stand-in can be built for any handle', buildPasteStandIn('tx_9', 'Tittel', 'abc').includes('[transcript:tx_9]'));

console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll large-paste checks passed.');
process.exit(failed ? 1 : 0);
