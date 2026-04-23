import React, { useEffect, useState, useCallback } from 'react';
import { ParcelData, CLAIM_COST, CURRENCY_NAME } from '@gamestu/shared';
import {
  sendClaimParcel,
  sendUpdateBusiness,
  onCreditsUpdate,
  getSessionId,
} from '../../network/Client';
import { useEscapeKey } from '../hooks/useEscapeKey';

// ── Module-level selection state ────────────────────────────────────────────
// MainScene calls these functions when a parcel is clicked.

let selectedParcelData: ParcelData | null = null;
const selectionListeners: (() => void)[] = [];

/** Called from MainScene when a parcel ground tile is clicked. */
export function selectParcel(data: ParcelData | null): void {
  selectedParcelData = data;
  for (const cb of selectionListeners) cb();
}

/** Get the currently selected parcel data. */
export function getSelectedParcel(): ParcelData | null {
  return selectedParcelData;
}

// ── Component ──────────────────────────────────────────────────────────────

export const ParcelPanel: React.FC = () => {
  const [, forceUpdate] = useState(0);
  const [credits, setCredits] = useState(0);
  const [editName, setEditName] = useState('');
  const [editType, setEditType] = useState('');
  const [editColor, setEditColor] = useState('#4a90d9');
  const [editHeight, setEditHeight] = useState(4);
  const [message, setMessage] = useState('');

  const sessionId = getSessionId();

  // Listen for selection changes
  useEffect(() => {
    const handler = () => forceUpdate((n) => n + 1);
    selectionListeners.push(handler);
    return () => {
      const idx = selectionListeners.indexOf(handler);
      if (idx !== -1) selectionListeners.splice(idx, 1);
    };
  }, []);

  // Listen for credits updates
  useEffect(() => {
    const unsub = onCreditsUpdate((c: number) => setCredits(c));
    return unsub;
  }, []);

  const parcel = selectedParcelData;

  useEscapeKey(() => selectParcel(null), !!parcel);

  // When selection changes, populate edit fields from parcel data
  useEffect(() => {
    if (parcel) {
      setEditName(parcel.business_name || '');
      setEditType(parcel.business_type || '');
      setEditColor(parcel.color || '#4a90d9');
      setEditHeight(parcel.height || 4);
      setMessage('');
    }
  }, [parcel?.id]);

  const handleClaim = useCallback(() => {
    if (!parcel) return;
    sendClaimParcel(parcel.id);
    setMessage('Claiming...');
  }, [parcel]);

  const handleUpdate = useCallback(() => {
    if (!parcel) return;
    sendUpdateBusiness(parcel.id, {
      name: editName,
      type: editType,
      color: editColor,
      height: editHeight,
    });
    setMessage('Updating...');
  }, [parcel, editName, editType, editColor, editHeight]);

  if (!parcel) return null;

  const isOwnedByMe = parcel.owner_id !== '' && parcel.owner_id === sessionId;
  const isOwnedByOther = parcel.owner_id !== '' && parcel.owner_id !== sessionId;

  const panelStyle: React.CSSProperties = {
    position: 'absolute',
    bottom: 20,
    left: '50%',
    transform: 'translateX(-50%)',
    background: 'rgba(0, 0, 0, 0.82)',
    color: '#e0e0e0',
    padding: '14px 20px',
    borderRadius: 8,
    fontFamily: 'monospace',
    fontSize: 13,
    minWidth: 320,
    maxWidth: 400,
    zIndex: 100,
    border: '1px solid rgba(255,255,255,0.12)',
    boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
  };

  const labelStyle: React.CSSProperties = {
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: 1,
    opacity: 0.5,
    marginBottom: 4,
  };

  const inputStyle: React.CSSProperties = {
    background: 'rgba(255,255,255,0.08)',
    border: '1px solid rgba(255,255,255,0.15)',
    borderRadius: 4,
    color: '#e0e0e0',
    padding: '4px 8px',
    fontSize: 13,
    fontFamily: 'monospace',
    width: '100%',
    marginBottom: 6,
    boxSizing: 'border-box' as const,
  };

  const buttonStyle: React.CSSProperties = {
    background: '#4a90d9',
    border: 'none',
    borderRadius: 4,
    color: 'white',
    padding: '6px 16px',
    fontSize: 13,
    fontFamily: 'monospace',
    cursor: 'pointer',
    fontWeight: 'bold' as const,
  };

  return (
    <div
      style={panelStyle}
      role="dialog"
      aria-label={`Parcel ${parcel.id} details`}
      aria-modal="false"
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontSize: 14, fontWeight: 'bold' }}>
          Parcel #{parcel.id}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 11, opacity: 0.6 }}>
            ({parcel.grid_x}, {parcel.grid_y})
          </span>
          <button
            onClick={() => selectParcel(null)}
            aria-label="Close parcel details (Escape)"
            style={{
              background: 'transparent', border: 'none', color: '#e0e0e0',
              fontSize: 16, cursor: 'pointer', padding: '0 4px', lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>
      </div>

      {!parcel.owner_id && (
        <>
          <div style={{ marginBottom: 8, opacity: 0.7 }}>Unclaimed parcel</div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>Claim for <strong style={{ color: '#facc15' }}>{CLAIM_COST.toLocaleString()} ${CURRENCY_NAME}</strong></span>
            <button style={buttonStyle} onClick={handleClaim}>
              Claim
            </button>
          </div>
          <div style={{ fontSize: 11, opacity: 0.5, marginTop: 4 }}>
            Your balance: {credits.toLocaleString()} ${CURRENCY_NAME}
          </div>
        </>
      )}

      {isOwnedByMe && (
        <>
          <div style={{ marginBottom: 8, color: '#4ade80', fontWeight: 'bold' }}>
            Your Parcel
          </div>
          <div style={labelStyle}>Business Name</div>
          <input
            style={inputStyle}
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            placeholder="e.g. Joe's Cafe"
          />
          <div style={labelStyle}>Business Type</div>
          <input
            style={inputStyle}
            value={editType}
            onChange={(e) => setEditType(e.target.value)}
            placeholder="e.g. restaurant"
          />
          <div style={{ display: 'flex', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <div style={labelStyle}>Color</div>
              <input
                type="color"
                value={editColor}
                onChange={(e) => setEditColor(e.target.value)}
                style={{ width: '100%', height: 28, border: 'none', background: 'none', cursor: 'pointer' }}
              />
            </div>
            <div style={{ flex: 1 }}>
              <div style={labelStyle}>Height: {editHeight}</div>
              <input
                type="range"
                min={1}
                max={20}
                step={0.5}
                value={editHeight}
                onChange={(e) => setEditHeight(Number(e.target.value))}
                style={{ width: '100%' }}
              />
            </div>
          </div>
          <div style={{ marginTop: 8, textAlign: 'right' }}>
            <button style={buttonStyle} onClick={handleUpdate}>
              Update Business
            </button>
          </div>
        </>
      )}

      {isOwnedByOther && (
        <>
          <div style={{ marginBottom: 6, color: '#fb923c' }}>
            Owned by another player
          </div>
          {parcel.business_name && (
            <div style={{ opacity: 0.8 }}>
              <strong>{parcel.business_name}</strong>
              {parcel.business_type && <span style={{ opacity: 0.6 }}> ({parcel.business_type})</span>}
            </div>
          )}
        </>
      )}

      {message && (
        <div style={{ marginTop: 8, fontSize: 11, opacity: 0.6, textAlign: 'center' }}>
          {message}
        </div>
      )}
    </div>
  );
};
