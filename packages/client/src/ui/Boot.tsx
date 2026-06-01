import React, { useState, useEffect, useCallback, useRef } from 'react';
import { App } from './App';
import { PasswordGate } from './components/PasswordGate';
import { PlayScreen } from './components/PlayScreen';
import { LoadingScreen } from './components/LoadingScreen';
import { WalletPicker } from './components/WalletPicker';
import { getGateStatus, verifyGate } from '../network/siteGate';
import { verifyStoredWallet } from '../network/wallet';

interface Props {
  /**
   * Starts the Babylon game + Colyseus connect, resolving once the scene is
   * render-ready. Injected by main.ts so this UI file never imports the
   * game/ internals (ui → game import boundary).
   */
  startGame: () => Promise<void>;
}

type Phase = 'init' | 'gate' | 'play' | 'wallet' | 'loading' | 'game';

/** The loading curtain stays up at least this long AND until the scene is
 *  ready — whichever is later — so the world never pops in mid-build. */
const MIN_LOADING_MS = 5000;
/** Hard ceiling: if scene-ready never fires (stalled WebGL / slow device),
 *  reveal the game anyway rather than trapping the player on the curtain. */
const MAX_LOADING_MS = 20000;

/**
 * Entry-flow orchestrator. Gates the game behind:
 *   site password gate (if enabled) → Play Game (black) → wallet connect →
 *   loading curtain → live game.
 *
 * The 3D canvas (#game-canvas) is NOT started until the loading phase, so the
 * earlier screens sit over a clean black canvas with nothing running.
 */
export const Boot: React.FC<Props> = ({ startGame }) => {
  const [phase, setPhase] = useState<Phase>('init');
  const [checking, setChecking] = useState(false);
  const startedRef = useRef(false);

  // ── init: decide whether the password gate is needed ──────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const gateEnabled = await getGateStatus();
      if (cancelled) return;
      if (!gateEnabled) { setPhase('play'); return; }
      const gateOk = await verifyGate();
      if (cancelled) return;
      setPhase(gateOk ? 'play' : 'gate');
    })();
    return () => { cancelled = true; };
  }, []);

  // ── Play clicked: require a connected wallet before loading ───────────
  const handlePlay = useCallback(async () => {
    if (checking) return;
    setChecking(true);
    const pid = await verifyStoredWallet();
    setChecking(false);
    setPhase(pid ? 'loading' : 'wallet');
  }, [checking]);

  // ── loading: start the game, hold for MIN_LOADING_MS AND scene-ready ──
  useEffect(() => {
    if (phase !== 'loading' || startedRef.current) return;
    startedRef.current = true;
    let ready = false;
    let elapsed = false;
    let forced = false;
    let done = false;
    const advance = () => {
      if (((ready && elapsed) || forced) && !done) { done = true; setPhase('game'); }
    };
    // Even if the connect fails (server down → offline mode), startGame
    // resolves; we still reveal the world rather than trapping the player.
    startGame().catch(() => { /* offline fallback handled inside Game */ })
      .finally(() => { ready = true; advance(); });
    const tMin = setTimeout(() => { elapsed = true; advance(); }, MIN_LOADING_MS);
    const tMax = setTimeout(() => { forced = true; advance(); }, MAX_LOADING_MS);
    return () => { clearTimeout(tMin); clearTimeout(tMax); };
  }, [phase, startGame]);

  // Mount <App/> as soon as we enter loading (NOT just at 'game') and keep it
  // mounted through to 'game'. App's child effects register the network
  // listeners (credits, resources, parcels) on mount; the server sends those
  // as one-shot messages right after connect — which startGame() fires during
  // loading. Mounting App first (under the opaque loading curtain) guarantees
  // its listeners are live before connect, so no join-time state is missed.
  const showApp = phase === 'loading' || phase === 'game';
  return (
    <>
      {showApp && <App />}
      {phase === 'gate' && <PasswordGate onSuccess={() => setPhase('play')} />}
      {phase === 'play' && <PlayScreen onPlay={handlePlay} busy={checking} />}
      {phase === 'wallet' && (
        <>
          <PlayScreen onPlay={() => { /* picker is open */ }} busy />
          <WalletPicker
            open
            onClose={() => setPhase('play')}
            onConnected={() => setPhase('loading')}
          />
        </>
      )}
      {phase === 'loading' && <LoadingScreen />}
    </>
  );
};
