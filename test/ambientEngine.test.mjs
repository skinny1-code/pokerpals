/**
 * ambientEngine music-theory core tests — pure Node, no AudioContext.
 * Run: node test/ambientEngine.test.mjs
 */
import { noteToFreq, CHORDS, SCALE, nextChordIndex, walkBassSemitone, pickCompSemitones, pickMelodySemitone } from '../src/lib/ambientEngine.js';

let passed = 0, failed = 0;
const check = (n, c, d = '') => { if (c) { passed++; console.log(`  ✅ ${n}`); } else { failed++; console.log(`  ❌ ${n}${d ? ' — ' + d : ''}`); } };
const approx = (a, b, eps = 0.5) => Math.abs(a - b) < eps;

console.log('noteToFreq');
check('semitone 0 = 220 Hz (A3)', approx(noteToFreq(0), 220));
check('semitone 3 ≈ 261.6 Hz (C4 tonic)', approx(noteToFreq(3), 261.63, 1));
check('semitone 12 = 440 Hz (octave up)', approx(noteToFreq(12), 440));

console.log('chords');
check('four-chord turnaround defined', CHORDS.length === 4);
check('every chord has root, voicing (>=3), and 4 walking-bass tones',
  CHORDS.every(c => Number.isFinite(c.root) && c.voicing.length >= 3 && c.bassTones.length === 4));
check('all comp voicings are audible (60–4000 Hz)',
  CHORDS.every(c => c.voicing.every(s => { const f = noteToFreq(s); return f > 60 && f < 4000; })));

console.log('progression walk');
{
  let i = 0; const seq = [];
  for (let k = 0; k < 6; k++) { i = nextChordIndex(i, () => 0.99); seq.push(i); }
  check('cycles I→vi→ii→V→I→vi with wrap', JSON.stringify(seq) === JSON.stringify([1,2,3,0,1,2]), JSON.stringify(seq));
  check('can linger on the tonic (rng low, at I)', nextChordIndex(0, () => 0.01) === 0);
  let j = 0, ok = true;
  for (let k = 0; k < 500; k++) { j = nextChordIndex(j, Math.random); if (j < 0 || j >= CHORDS.length) ok = false; }
  check('index always in range over 500 random steps', ok);
}

console.log('walking bass');
{
  let ok = true, low = true;
  for (let ci = 0; ci < CHORDS.length; ci++) {
    for (let beat = 0; beat < 8; beat++) {
      const s = walkBassSemitone(ci, beat);
      // Must be one of this chord's bass tones, dropped an octave
      if (!CHORDS[ci].bassTones.map(x => x - 12).includes(s)) ok = false;
      if (noteToFreq(s) >= 320) low = false; // stays in the bass register (below ~E4)
    }
  }
  check('bass note is always a chord bass-tone (octave down)', ok);
  check('bass sits in the upright bass register (< 320 Hz)', low);
}

console.log('comp + melody');
{
  check('comp returns the current chord voicing', JSON.stringify(pickCompSemitones(2)) === JSON.stringify(CHORDS[2].voicing));
  let ok = true;
  for (let k = 0; k < 500; k++) {
    const s = pickMelodySemitone(Math.random);
    if (!SCALE.map(x => x + 12).includes(s)) ok = false; // consonant scale tone, octave up
  }
  check('melody note is always a consonant scale tone', ok);
  check('melody sits above the tonic (bright register)', noteToFreq(pickMelodySemitone(() => 0.5)) > noteToFreq(3));
}

console.log('\n══════════════════════════════════════════════════');
console.log(`Results: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
