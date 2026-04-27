import React, { useState, useEffect, CSSProperties } from 'react';
import { getPlayerName, sendPlayerColor } from '../../network/Client';
import { getDayNightCycle } from '../../game/scenes/MainScene';
import {
  hasInjectedWallet,
  getStoredPlayerId,
  getStoredAuthToken,
  connectWallet,
  logoutWallet,
} from '../../network/wallet';

const COLOR_PRESETS: { name: string; hex: string }[] = [
  { name: 'Red', hex: '#e53e3e' },
  { name: 'Blue', hex: '#3182ce' },
  { name: 'Green', hex: '#38a169' },
  { name: 'Yellow', hex: '#ecc94b' },
  { name: 'Purple', hex: '#805ad5' },
  { name: 'Orange', hex: '#ed8936' },
  { name: 'White', hex: '#ffffff' },
  { name: 'Black', hex: '#1a1a1a' },
];

interface SettingsMenuProps {
  onClose: () => void;
}

export const SettingsMenu: React.FC<SettingsMenuProps> = ({ onClose }) => {
  const [playerName, setPlayerName] = useState<string>('Unknown');
  const [selectedColor, setSelectedColor] = useState<string>(
    () => localStorage.getItem('thirdlife_player_color') ?? '#3182ce',
  );
  const [volume, setVolume] = useState<number>(
    () => parseInt(localStorage.getItem('thirdlife_volume') ?? '50', 10),
  );
  const [cycleSpeed, setCycleSpeed] = useState<number>(
    () => parseInt(localStorage.getItem('thirdlife_cycle_seconds') ?? '600', 10),
  );
  const [walletAddress, setWalletAddress] = useState<string | null>(() => {
    const pid = getStoredPlayerId();
    return pid && /^0x[a-fA-F0-9]{40}$/.test(pid) && getStoredAuthToken() ? pid : null;
  });
  const [walletBusy, setWalletBusy] = useState(false);
  const [walletError, setWalletError] = useState<string | null>(null);

  useEffect(() => {
    const name = getPlayerName();
    if (name) setPlayerName(name);
  }, []);

  const handleColorSelect = (hex: string) => {
    setSelectedColor(hex);
    localStorage.setItem('thirdlife_player_color', hex);
    sendPlayerColor(hex);
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseInt(e.target.value, 10);
    setVolume(val);
    localStorage.setItem('thirdlife_volume', String(val));
  };

  const handleConnectWallet = async () => {
    setWalletBusy(true);
    setWalletError(null);
    try {
      const result = await connectWallet();
      setWalletAddress(result.address);
      // Reload so the next Colyseus connect uses the wallet identity. Any
      // building/credit data tied to the prior guest UUID is left in the DB
      // (recoverable later via a migrate flow) — we don't merge silently.
      window.location.reload();
    } catch (e) {
      setWalletError((e as Error).message);
    } finally {
      setWalletBusy(false);
    }
  };

  const handleDisconnectWallet = async () => {
    setWalletBusy(true);
    try {
      await logoutWallet();
      setWalletAddress(null);
      window.location.reload();
    } finally {
      setWalletBusy(false);
    }
  };

  const handleCycleToggle = () => {
    const next = cycleSpeed === 300 ? 600 : 300;
    setCycleSpeed(next);
    localStorage.setItem('thirdlife_cycle_seconds', String(next));
    const dayNight = getDayNightCycle();
    if (dayNight) {
      dayNight.setCycleDuration(next);
    }
  };

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.panel} onClick={(e) => e.stopPropagation()}>
        <h2 style={styles.title}>Settings</h2>

        {/* Player Name */}
        <div style={styles.section}>
          <label style={styles.label}>Player</label>
          <span style={styles.value}>{playerName}</span>
        </div>

        {/* Color Picker */}
        <div style={styles.section}>
          <label style={styles.label}>Character Color</label>
          <div style={styles.colorGrid}>
            {COLOR_PRESETS.map((c) => (
              <button
                key={c.name}
                title={c.name}
                style={{
                  ...styles.colorSwatch,
                  backgroundColor: c.hex,
                  outline: selectedColor === c.hex ? '2px solid #fff' : '2px solid transparent',
                }}
                onClick={() => handleColorSelect(c.hex)}
              />
            ))}
          </div>
        </div>

        {/* Volume Slider */}
        <div style={styles.section}>
          <label style={styles.label}>Volume</label>
          <div style={styles.sliderRow}>
            <input
              type="range"
              min={0}
              max={100}
              value={volume}
              onChange={handleVolumeChange}
              style={styles.slider}
            />
            <span style={styles.sliderValue}>{volume}</span>
          </div>
        </div>

        {/* Cycle Speed */}
        <div style={styles.section}>
          <label style={styles.label}>Day/Night Cycle</label>
          <button style={styles.cycleButton} onClick={handleCycleToggle}>
            {cycleSpeed === 300 ? '5 min' : '10 min'}
          </button>
        </div>

        {/* Wallet */}
        <div style={styles.section}>
          <label style={styles.label}>Account</label>
          {walletAddress ? (
            <>
              <span style={styles.value} title={walletAddress}>
                {walletAddress.slice(0, 6)}…{walletAddress.slice(-4)}
              </span>
              <button
                style={styles.cycleButton}
                onClick={handleDisconnectWallet}
                disabled={walletBusy}
              >
                {walletBusy ? '…' : 'Disconnect Wallet'}
              </button>
            </>
          ) : (
            <>
              <span style={styles.value}>Guest (browser-local)</span>
              {hasInjectedWallet() ? (
                <button
                  style={styles.cycleButton}
                  onClick={handleConnectWallet}
                  disabled={walletBusy}
                >
                  {walletBusy ? 'Connecting…' : 'Connect Wallet'}
                </button>
              ) : (
                <span style={{ ...styles.label, opacity: 0.5 }}>
                  Install MetaMask to use a persistent wallet identity.
                </span>
              )}
              {walletError && (
                <span style={{ ...styles.label, color: '#f87171', textTransform: 'none' }}>
                  {walletError}
                </span>
              )}
            </>
          )}
        </div>

        {/* Close */}
        <button style={styles.closeButton} onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
};

const styles: Record<string, CSSProperties> = {
  overlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    width: '100vw',
    height: '100vh',
    backgroundColor: 'rgba(0,0,0,0.6)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9000,
  },
  panel: {
    width: 400,
    maxHeight: 500,
    backgroundColor: 'rgba(0,0,0,0.85)',
    borderRadius: 12,
    padding: '24px 28px',
    color: '#fff',
    fontFamily: 'monospace',
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
    overflowY: 'auto',
  },
  title: {
    margin: 0,
    fontSize: 22,
    textAlign: 'center',
    letterSpacing: 2,
  },
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  label: {
    fontSize: 13,
    opacity: 0.6,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  value: {
    fontSize: 16,
  },
  colorGrid: {
    display: 'flex',
    gap: 8,
    flexWrap: 'wrap',
  },
  colorSwatch: {
    width: 30,
    height: 30,
    border: 'none',
    borderRadius: 4,
    cursor: 'pointer',
    transition: 'outline 0.15s',
  },
  sliderRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  },
  slider: {
    flex: 1,
    accentColor: '#3182ce',
  },
  sliderValue: {
    fontSize: 14,
    width: 30,
    textAlign: 'right',
  },
  cycleButton: {
    alignSelf: 'flex-start',
    padding: '6px 16px',
    fontSize: 14,
    fontFamily: 'monospace',
    backgroundColor: 'rgba(255,255,255,0.1)',
    color: '#fff',
    border: '1px solid rgba(255,255,255,0.25)',
    borderRadius: 6,
    cursor: 'pointer',
  },
  closeButton: {
    marginTop: 8,
    padding: '10px 0',
    fontSize: 15,
    fontFamily: 'monospace',
    backgroundColor: 'rgba(255,255,255,0.1)',
    color: '#fff',
    border: '1px solid rgba(255,255,255,0.25)',
    borderRadius: 8,
    cursor: 'pointer',
    textAlign: 'center',
  },
};
