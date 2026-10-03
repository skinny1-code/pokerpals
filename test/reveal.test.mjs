/**
 * Card-visibility and seat-choice rules. Run: node test/reveal.test.mjs
 *
 * The reveal rule decides what one player learns about another's play, so the
 * tests are written from the leak's point of view: which hands must stay down.
 */
import { canRevealHand, canElectToShow } from '../server/reveal.js';
import { chooseSeat } from '../server/seating.js';

let passed = 0, failed = 0;
function check(name, cond, detail = '') {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else      { failed++; console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); }
}

const HERO = '0xhero', VILLAIN = '0xvillain', FOLDER = '0xfolder';
const seat = (addr, o = {}) => ({ addr, folded: false, revealed: false, hand: ['AH','KD'], ...o });

// A hand contested to the end by hero and villain, with a third player folded.
const contested = {
  phase: 'showdown', wentToShowdown: true,
  showdownSeats: new Set([HERO, VILLAIN]),
};
// A hand where everyone folded to hero — nobody called.
const uncalled = {
  phase: 'showdown', wentToShowdown: false,
  showdownSeats: new Set([HERO]),
};

console.log('nobody called: the winner\'s cards stay down');
{
  check('villain cannot see hero\'s hand',
    !canRevealHand({ player: seat(HERO), forAddr: VILLAIN, ...uncalled }));
  check('the broadcast view cannot see it either',
    !canRevealHand({ player: seat(HERO), forAddr: null, ...uncalled }));
  check('hero still sees their own',
    canRevealHand({ player: seat(HERO), forAddr: HERO, ...uncalled }));
  check('once hero chooses to show, villain sees it',
    canRevealHand({ player: seat(HERO, { revealed: true }), forAddr: VILLAIN, ...uncalled }));
  check('and so does the broadcast view',
    canRevealHand({ player: seat(HERO, { revealed: true }), forAddr: null, ...uncalled }));
}

console.log('contested to the end: the survivors show');
{
  check('villain sees hero', canRevealHand({ player: seat(HERO), forAddr: VILLAIN, ...contested }));
  check('hero sees villain', canRevealHand({ player: seat(VILLAIN), forAddr: HERO, ...contested }));
  check('the broadcast view sees both',
    canRevealHand({ player: seat(HERO), forAddr: null, ...contested }) &&
    canRevealHand({ player: seat(VILLAIN), forAddr: null, ...contested }));
}

console.log('a fold is never shown');
{
  check('folded player stays down at a real showdown',
    !canRevealHand({ player: seat(FOLDER, { folded: true }), forAddr: HERO, ...contested }));
  check('folded player stays down when nobody called',
    !canRevealHand({ player: seat(FOLDER, { folded: true }), forAddr: HERO, ...uncalled }));
  check('folded player still sees their own cards',
    canRevealHand({ player: seat(FOLDER, { folded: true }), forAddr: FOLDER, ...contested }));
  check('a folded player who elects to show is honoured',
    canRevealHand({ player: seat(FOLDER, { folded: true, revealed: true }), forAddr: HERO, ...contested }));
}

console.log('nothing is ever shown mid-hand');
{
  for (const phase of ['preflop', 'flop', 'turn', 'river', 'waiting']) {
    check(`${phase}: villain cannot see hero`, !canRevealHand({
      player: seat(HERO), forAddr: VILLAIN, phase, wentToShowdown: true,
      showdownSeats: new Set([HERO, VILLAIN]),
    }));
    check(`${phase}: hero sees their own`, canRevealHand({
      player: seat(HERO), forAddr: HERO, phase, wentToShowdown: false, showdownSeats: new Set(),
    }));
  }
}

console.log('someone who did not reach the showdown is not exposed by it');
{
  // Reached showdown between hero and villain; a third all-in player left
  // earlier and is not in showdownSeats.
  const stranger = seat('0xleft');
  check('not in showdownSeats → not shown',
    !canRevealHand({ player: stranger, forAddr: HERO, ...contested }));
}

console.log('degenerate inputs');
{
  check('no player', !canRevealHand({ player: null, forAddr: HERO, ...contested }));
  check('missing showdownSeats', !canRevealHand({
    player: seat(HERO), forAddr: VILLAIN, phase: 'showdown', wentToShowdown: true, showdownSeats: null,
  }));
}

console.log('electing to show');
{
  check('allowed at showdown', canElectToShow({ player: seat(HERO), phase: 'showdown' }).ok);
  check('refused mid-hand', !canElectToShow({ player: seat(HERO), phase: 'river' }).ok);
  check('refused when not seated', !canElectToShow({ player: undefined, phase: 'showdown' }).ok);
  check('refused with no cards',
    !canElectToShow({ player: seat(HERO, { hand: [] }), phase: 'showdown' }).ok);
  check('each refusal says why',
    ['river', 'waiting'].every(p => typeof canElectToShow({ player: seat(HERO), phase: p }).error === 'string'));
}

console.log('seat choice: a named seat is honoured or refused, never swapped');
{
  const nine = { taken: [0, 2, 5], maxPlayers: 9 };
  check('a free named seat is given', chooseSeat({ ...nine, preferredSeat: 4 }).seatIndex === 4);
  const taken = chooseSeat({ ...nine, preferredSeat: 2 });
  check('a taken seat is refused, not substituted', !taken.ok && taken.reason === 'seat-taken',
    JSON.stringify(taken));
  check('seat 0 is a real choice, not treated as absent',
    chooseSeat({ taken: [1], maxPlayers: 9, preferredSeat: 0 }).seatIndex === 0);
  check('an out-of-range seat is refused',
    !chooseSeat({ ...nine, preferredSeat: 9 }).ok && !chooseSeat({ ...nine, preferredSeat: -1 }).ok);
  check('a non-integer seat is refused',
    !chooseSeat({ ...nine, preferredSeat: 1.5 }).ok && !chooseSeat({ ...nine, preferredSeat: '3' }).ok);
}

console.log('seat choice: no preference takes the first open seat');
{
  check('first gap wins', chooseSeat({ taken: [0, 1, 3], maxPlayers: 9, preferredSeat: null }).seatIndex === 2);
  check('undefined behaves as no preference',
    chooseSeat({ taken: [0], maxPlayers: 9 }).seatIndex === 1);
  check('empty table gives seat 0', chooseSeat({ taken: [], maxPlayers: 6 }).seatIndex === 0);
  const full = chooseSeat({ taken: [0, 1, 2, 3, 4, 5], maxPlayers: 6 });
  check('a full table is refused', !full.ok && full.reason === 'table-full', JSON.stringify(full));
  check('a Set works as well as an array',
    chooseSeat({ taken: new Set([0, 1]), maxPlayers: 9 }).seatIndex === 2);
}

console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
