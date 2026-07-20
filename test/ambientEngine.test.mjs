/**
 * ambientEngine music-theory core tests — pure Node, no AudioContext.
 * Run: node test/ambientEngine.test.mjs
 */
import { noteToFreq, CHORDS, SCALE, nextChordIndex, pickBellSemitone } from '../src/lib/ambientEngine.js';

let passed = 0, failed = 0;
const check = (n, c, d = '') => { if (c) { passed++; console.log(`  ✅ ${n}`); } else { failed++; console.log(`  ❌ ${n}${d ? ' — ' + d : ''}`); } };
const approx = (a, b, eps = 0.5) => Math.abs(a - b) < eps;

console.log('noteToFreq');
check('semitone 0 = 220 Hz (A3)', approx(noteToFreq(0), 220));
check('semitone 12 = 440 Hz (octave up)', approx(noteToFreq(12), 440));
check('semitone -12 = 110 Hz (octave down)', approx(noteToFreq(-12), 110));
check('semitone 7 ≈ 329.6 Hz (E)', approx(noteToFreq(7), 329.63, 1));

console.log('chords');
check('four chords defined', CHORDS.length === 4);
check('every chord has named voicing with >= 3 notes',
  CHORDS.every(c => c.name && Array.isArray(c.notes) && c.notes.length >= 3));
check('all chord notes produce audible frequencies (50–4000 Hz)',
  CHORDS.every(c => c.notes.every(s => { const f = noteToFreq(s - 24); return f > 50 && f < 4000; })));

console.log('progression walk');
{
  // Advance branch (rng high) always steps forward and wraps
  let i = 0; const seq = [];
  for (let k = 0; k < 6; k++) { i = nextChordIndex(i, () => 0.99); seq.push(i); }
  check('advances 0→1→2→3→0→1→2 with wrap', JSON.stringify(seq) === JSON.stringify([1,2,3,0,1,2]), JSON.stringify(seq));
}
{
  // Linger branch (rng low) holds the current chord
  check('lingers on the current chord when rng < 0.15', nextChordIndex(2, () => 0.01) === 2);
}
{
  // Never produces an out-of-range index over many random walks
  let i = 0, ok = true;
  for (let k = 0; k < 500; k++) { i = nextChordIndex(i, Math.random); if (i < 0 || i >= CHORDS.length) ok = false; }
  check('index always in range over 500 random steps', ok);
}

console.log('bell notes');
{
  let ok = true;
  for (let k = 0; k < 500; k++) {
    const s = pickBellSemitone(Math.random);
    // Must be a scale tone raised an octave (in SCALE + 12)
    if (!SCALE.map(x => x + 12).includes(s)) ok = false;
  }
  check('bell note is always a consonant scale tone (octave up)', ok);
  check('bells sit in the shimmer register (> chord root freq)',
    noteToFreq(pickBellSemitone(() => 0.5)) > noteToFreq(0));
}

console.log('\n══════════════════════════════════════════════════');
console.log(`Results: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
