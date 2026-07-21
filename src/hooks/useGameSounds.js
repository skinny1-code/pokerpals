// src/hooks/useGameSounds.js
// Watches the live game state and fires poker-room sound effects on the moments
// that matter: cards dealt, streets flipping, players acting (chip/check/fold/
// all-in), your turn arriving, and the pot being won. Pure side-effect hook —
// it renders nothing and only plays sound when SFX are enabled.

import { useEffect, useRef } from 'react';
import { playSfx } from '../lib/soundFx';

function labelSound(label) {
  if (!label) return null;
  const l = label.toUpperCase();
  if (l.startsWith('ALL')) return 'allin';
  if (l.startsWith('RAISE') || l.startsWith('BET') || l.startsWith('CALL')) return 'chip';
  if (l.startsWith('CHECK')) return 'check';
  if (l.startsWith('FOLD')) return 'fold';
  return null;
}

export function useGameSounds(gameState, handOver, address) {
  const prevPhase   = useRef(null);
  const prevCommLen = useRef(0);
  const prevLabels  = useRef({});   // addr -> last actionLabel we sounded
  const prevTurn    = useRef(false);
  const lastHand    = useRef(-1);

  // Phase / community-card transitions → deal + flip sounds
  useEffect(() => {
    if (!gameState) return;
    const phase = gameState.phase;
    const commLen = (gameState.community || []).length;

    // New hand dealt (entering preflop from waiting/showdown)
    if (phase === 'preflop' && prevPhase.current !== 'preflop') {
      playSfx('deal');
      prevLabels.current = {}; // reset per-hand action memory
    }
    // A street was revealed (more community cards than before)
    if (commLen > prevCommLen.current && commLen > 0) {
      playSfx('flip');
    }
    prevPhase.current = phase;
    prevCommLen.current = commLen;
  }, [gameState]);

  // Player actions → chip / check / fold / all-in, when a label first appears
  useEffect(() => {
    if (!gameState?.players) return;
    const meLower = address?.toLowerCase();
    for (const p of gameState.players) {
      const key = p.addr?.toLowerCase();
      if (!key) continue;
      const label = p.actionLabel || '';
      if (label && label !== prevLabels.current[key]) {
        prevLabels.current[key] = label;
        // Skip the hero's own action here (their client already reacted on click);
        // still play for opponents so the table feels alive.
        if (key !== meLower) {
          const s = labelSound(label);
          if (s) playSfx(s);
        }
      } else if (!label) {
        // street reset — forget so the next action re-triggers
        delete prevLabels.current[key];
      }
    }
  }, [gameState, address]);

  // Hero's turn arriving → chime (once per turn)
  useEffect(() => {
    if (!gameState) return;
    const isHeroTurn = !!address &&
      gameState.activeAddr?.toLowerCase() === address.toLowerCase() &&
      gameState.phase !== 'waiting' && gameState.phase !== 'showdown';
    if (isHeroTurn && !prevTurn.current) playSfx('yourTurn');
    prevTurn.current = isHeroTurn;
  }, [gameState, address]);

  // Hand over → pot sweep + win/lose for the hero
  useEffect(() => {
    if (!handOver) return;
    const id = handOver.handNonce ?? 0;
    if (id === lastHand.current) return;
    lastHand.current = id;

    playSfx('potSweep');
    const meLower = address?.toLowerCase();
    const won = (handOver.winners || []).some(w => w?.toLowerCase?.() === meLower);
    // Give the sweep a beat before the verdict jingle
    setTimeout(() => playSfx(won ? 'win' : 'lose'), 380);
  }, [handOver, address]);
}
