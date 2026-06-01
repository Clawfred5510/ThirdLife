import React, { useState, useEffect, useCallback } from 'react';
import { listWallets, refreshWallets, connectWallet, WalletOption } from '../../network/wallet';

interface Props {
  open: boolean;
  onClose: () => void;
  /**
   * Called after a successful connect instead of reloading the page. The
   * wallet-gate entry flow passes this to advance to the loading screen
   * without a reload; in-game callers (Settings, Phone) omit it and get the
   * default `window.location.reload()` so the next Colyseus connect rebinds
   * to the new wallet identity.
   */
  onConnected?: () => void;
}

/**
 * Wallet chooser backed by EIP-6963 multi-injected-provider discovery. Lists
 * every installed EVM wallet (MetaMask, Coinbase/Base, Phantom-EVM, Backpack,
 * Rabby, …) and runs the existing SIWE connect flow against the chosen one.
 * On success it reloads so the next Colyseus connect binds to the wallet
 * identity (same hand-off the previous single-button flow used).
 */
export const WalletPicker: React.FC<Props> = ({ open, onClose, onConnected }) => {
  const [wallets, setWallets] = useState<WalletOption[]>([]);
  const [discovering, setDiscovering] = useState(true);
  const [connectingId, setConnectingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Re-poll discovery while open — wallets announce asynchronously, and some
  // extensions announce a few hundred ms after page load.
  useEffect(() => {
    if (!open) return;
    setError(null);
    setConnectingId(null);
    setDiscovering(true);
    refreshWallets();
    setWallets(listWallets());
    const iv = setInterval(() => setWallets(listWallets()), 150);
    const stop = setTimeout(() => { clearInterval(iv); setDiscovering(false); }, 700);
    return () => { clearInterval(iv); clearTimeout(stop); };
  }, [open]);

  const doConnect = useCallback(async (w: WalletOption) => {
    setError(null);
    setConnectingId(w.id);
    try {
      await connectWallet(w.provider);
      if (onConnected) onConnected();
      else window.location.reload();
    } catch (e) {
      setError((e as Error).message);
      setConnectingId(null);
    }
  }, [onConnected]);

  if (!open) return null;

  return (
    <div style={S.backdrop} role="dialog" aria-modal="true" aria-label="Connect a wallet" onClick={onClose}>
      <div style={S.panel} onClick={(e) => e.stopPropagation()}>
        <div style={S.title}>Connect a wallet</div>

        {wallets.length > 0 ? (
          <div style={S.list}>
            {wallets.map((w) => (
              <button
                key={w.id}
                style={{ ...S.walletBtn, opacity: connectingId && connectingId !== w.id ? 0.5 : 1 }}
                onClick={() => doConnect(w)}
                disabled={connectingId !== null}
              >
                {w.icon
                  ? <img src={w.icon} alt="" width={26} height={26} style={S.icon} />
                  : <span style={S.iconFallback} aria-hidden>🔗</span>}
                <span style={S.walletName}>{w.name}</span>
                {connectingId === w.id && <span style={S.spinner}>connecting…</span>}
              </button>
            ))}
          </div>
        ) : discovering ? (
          <div style={S.hint}>Detecting wallets…</div>
        ) : (
          <div style={S.hint}>
            No EVM wallet detected. Install one — MetaMask, Coinbase / Base, Phantom,
            Backpack, or Rabby — then reopen this. On mobile, open the game inside your
            wallet app&apos;s built-in browser.
          </div>
        )}

        {error && <div style={S.error}>{error}</div>}

        <button style={S.cancel} onClick={onClose} disabled={connectingId !== null}>
          {connectingId ? 'Connecting…' : 'Cancel'}
        </button>
      </div>
    </div>
  );
};

const S: Record<string, React.CSSProperties> = {
  backdrop: {
    position: 'absolute', inset: 0, zIndex: 200,
    background: 'rgba(15,17,21,0.6)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    pointerEvents: 'auto',
  },
  panel: {
    width: 320, maxWidth: '90vw',
    background: '#1b1f27', color: '#F5E6D0',
    border: '1px solid rgba(216,148,56,0.35)', borderRadius: 14,
    padding: 18, boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
    fontFamily: '"Nunito", system-ui, sans-serif',
  },
  title: { fontSize: 17, fontWeight: 800, marginBottom: 12, fontFamily: '"Fraunces", Georgia, serif' },
  list: { display: 'flex', flexDirection: 'column', gap: 8 },
  walletBtn: {
    display: 'flex', alignItems: 'center', gap: 12,
    padding: '10px 12px', borderRadius: 10,
    background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)',
    color: '#F5E6D0', cursor: 'pointer', textAlign: 'left', fontSize: 14, fontWeight: 600,
  },
  icon: { borderRadius: 6, flexShrink: 0 },
  iconFallback: { width: 26, height: 26, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 },
  walletName: { flex: 1 },
  spinner: { fontSize: 11, opacity: 0.7 },
  hint: { fontSize: 13, lineHeight: 1.4, opacity: 0.85 },
  error: { marginTop: 10, fontSize: 12, color: '#f87171', lineHeight: 1.4 },
  cancel: {
    marginTop: 14, width: '100%', padding: '8px 12px', borderRadius: 10,
    background: 'transparent', border: '1px solid rgba(255,255,255,0.2)',
    color: '#F5E6D0', cursor: 'pointer', fontSize: 13, fontWeight: 600,
  },
};
