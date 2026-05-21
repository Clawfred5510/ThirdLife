import React, { useEffect, useState, useCallback } from 'react';
import {
  ParcelData,
  CLAIM_COST,
  CURRENCY_NAME,
  BUILDINGS,
  BUILDING_LIST,
  BuildingType,
  RESERVED_PARCEL_IDS,
  TIER_INDEX,
  TIER_NAMES,
  Tier,
} from '@gamestu/shared';
import {
  sendClaimParcel,
  sendUpdateBusiness,
  sendDemolish,
  onCreditsUpdate,
  onRankUp,
  getSessionId,
} from '../../network/Client';
import { apiGet, hasAuthToken } from '../../network/api';
import { useEscapeKey } from '../hooks/useEscapeKey';
import { useViewport } from '../hooks/useViewport';

const TIER_LABEL: Record<Tier, string> = {
  bronze: 'Bronze', silver: 'Silver', gold: 'Gold', platinum: 'Platinum', diamond: 'Diamond',
};

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
  const [message, setMessage] = useState('');
  const [pickedBuilding, setPickedBuilding] = useState<BuildingType>('apartment');
  const [resources, setResources] = useState<{ food: number; materials: number; energy: number; luxury: number }>(
    { food: 0, materials: 0, energy: 0, luxury: 0 },
  );
  const [rank, setRank] = useState<Tier>('bronze');
  const vp = useViewport();

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

  // Mirror the resource bar's data + the player's rank so the build
  // picker can grey buttons that don't pass the materials / rank check
  // and explain why on the status line below the grid.
  useEffect(() => {
    const onResources = (e: Event) => {
      const detail = (e as CustomEvent<typeof resources>).detail;
      if (detail) setResources(detail);
    };
    window.addEventListener('resource-update', onResources);
    return () => window.removeEventListener('resource-update', onResources);
  }, []);

  useEffect(() => {
    if (!hasAuthToken()) return;
    let cancelled = false;
    const refreshRank = () => {
      apiGet<{ rank: Tier | null }>('/wallet/rank', { authed: true })
        .then((r) => { if (!cancelled && r.rank) setRank(r.rank); })
        .catch(() => {});
    };
    refreshRank();
    const off = onRankUp((e) => {
      // Server-pushed rank promotion — flip the local state immediately
      // so a newly-eligible building unlocks the moment confetti fires.
      if (e.to) setRank(e.to as Tier);
    });
    return () => { cancelled = true; off(); };
  }, []);

  const parcel = selectedParcelData;

  useEscapeKey(() => selectParcel(null), !!parcel);

  // When selection changes, populate edit fields from parcel data
  useEffect(() => {
    if (parcel) {
      setEditName(parcel.business_name || '');
      setEditType(parcel.business_type || '');
      setMessage('');
    }
  }, [parcel?.id]);

  const handleClaim = useCallback(() => {
    if (!parcel) return;
    sendClaimParcel(parcel.id, pickedBuilding);
    setMessage(`Claiming & building ${BUILDINGS[pickedBuilding].label}...`);
  }, [parcel, pickedBuilding]);

  const handleUpdate = useCallback(() => {
    if (!parcel) return;
    // Owner can rename their business; type/color/height are locked.
    sendUpdateBusiness(parcel.id, { name: editName });
    setMessage('Updating...');
  }, [parcel, editName]);

  const handleDemolish = useCallback(() => {
    if (!parcel) return;
    if (!confirm('Demolish this building? You will get back 50% of the build cost. The land stays yours.')) return;
    sendDemolish(parcel.id);
    setMessage('Demolishing...');
  }, [parcel]);

  if (!parcel) return null;

  const isOwnedByMe = parcel.owner_id !== '' && parcel.owner_id === sessionId;
  const isOwnedByOther = parcel.owner_id !== '' && parcel.owner_id !== sessionId;

  const panelStyle: React.CSSProperties = vp.isMobile
    ? {
        position: 'absolute',
        bottom: 8,
        left: 8,
        right: 8,
        maxHeight: '70vh',
        overflowY: 'auto',
        background: 'rgba(0, 0, 0, 0.88)',
        color: '#e0e0e0',
        padding: '12px 14px',
        borderRadius: 10,
        fontFamily: 'monospace',
        fontSize: 12,
        zIndex: 100,
        border: '1px solid rgba(255,255,255,0.12)',
        boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
      }
    : {
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

      {!parcel.owner_id && RESERVED_PARCEL_IDS.includes(parcel.id) && (
        <div style={{ marginBottom: 8, opacity: 0.8 }}>
          🚀 Reserved landmark plot — this parcel hosts the world rocket and
          can&apos;t be built on.
        </div>
      )}

      {!parcel.owner_id && !RESERVED_PARCEL_IDS.includes(parcel.id) && (
        <>
          <div style={{ marginBottom: 8, opacity: 0.8 }}>
            Unclaimed parcel — <span style={{ opacity: 0.6 }}>pick what to build:</span>
          </div>
          <div
            role="radiogroup"
            aria-label="Building type"
            style={{
              display: 'grid',
              gridTemplateColumns: vp.isMobile ? 'repeat(3, 1fr)' : 'repeat(5, 1fr)',
              gap: 4,
              marginBottom: 10,
            }}
          >
            {BUILDING_LIST.filter((b) => b.category !== 'legacy').map((b) => {
              const total = b.cost + CLAIM_COST;
              const enoughCredits = credits >= total;
              const enoughMaterials = b.materialCost === 0 || resources.materials >= b.materialCost;
              const rankOk = TIER_INDEX[rank] >= TIER_INDEX[b.minRank];
              const canBuild = enoughCredits && enoughMaterials && rankOk;
              const selected = pickedBuilding === b.type;
              // Tooltip lists every blocker so the player knows what to fix.
              const blockers: string[] = [];
              if (!rankOk) blockers.push(`Requires ${TIER_LABEL[b.minRank]} rank`);
              if (!enoughCredits) blockers.push(`Need ${(total - credits).toLocaleString()} more $${CURRENCY_NAME}`);
              if (!enoughMaterials) blockers.push(`Need ${(b.materialCost - resources.materials).toLocaleString()} more materials`);
              const title = canBuild
                ? `${b.label} · Tier ${b.tier} · ${total.toLocaleString()} $${CURRENCY_NAME}${b.materialCost > 0 ? ` + ${b.materialCost.toLocaleString()} materials` : ''}`
                : `${b.label} — ${blockers.join(' · ')}`;
              return (
                <button
                  key={b.type}
                  role="radio"
                  aria-checked={selected}
                  aria-label={title}
                  title={title}
                  disabled={!canBuild}
                  onClick={() => setPickedBuilding(b.type)}
                  style={{
                    background: selected
                      ? '#facc15'
                      : (canBuild ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.03)'),
                    color: selected ? '#1a1409' : (canBuild ? '#e0e0e0' : 'rgba(224,224,224,0.35)'),
                    border: selected
                      ? '1px solid #facc15'
                      : (!rankOk ? '1px solid rgba(181,86,58,0.45)' : '1px solid rgba(255,255,255,0.15)'),
                    borderRadius: 4,
                    padding: '6px 4px',
                    fontSize: 10,
                    fontFamily: 'monospace',
                    cursor: canBuild ? 'pointer' : 'not-allowed',
                    textAlign: 'center',
                    lineHeight: 1.3,
                    position: 'relative',
                  }}
                >
                  <div style={{ fontWeight: 'bold' }}>{b.label}</div>
                  <div style={{ opacity: 0.6, fontSize: 8, textTransform: 'uppercase', letterSpacing: 0.3 }}>
                    T{b.tier} · {b.category.replace('luxury-', '')}
                  </div>
                  <div style={{ opacity: 0.75, fontSize: 9 }}>{b.cost.toLocaleString()}</div>
                  {b.materialCost > 0 && (
                    <div style={{
                      opacity: enoughMaterials ? 0.6 : 0.9,
                      fontSize: 8,
                      color: enoughMaterials ? '#e0e0e0' : '#fca5a5',
                    }}>
                      +{b.materialCost.toLocaleString()} mat
                    </div>
                  )}
                  {!rankOk && (
                    <div style={{
                      position: 'absolute', top: 2, right: 3,
                      fontSize: 7, fontWeight: 700,
                      color: '#fca5a5', letterSpacing: 0.4,
                    }}>
                      🔒 {TIER_LABEL[b.minRank].slice(0, 3).toUpperCase()}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
          {/* Selected-building status line — explains every blocker so
              the player isn't left guessing why the Claim & Build button
              is disabled. */}
          {(() => {
            const b = BUILDINGS[pickedBuilding];
            if (!b) return null;
            const total = b.cost + CLAIM_COST;
            const blockers: string[] = [];
            if (TIER_INDEX[rank] < TIER_INDEX[b.minRank]) {
              blockers.push(`Requires ${TIER_LABEL[b.minRank]} rank (you are ${TIER_LABEL[rank]})`);
            }
            if (credits < total) {
              blockers.push(`Need ${(total - credits).toLocaleString()} more $${CURRENCY_NAME}`);
            }
            if (b.materialCost > 0 && resources.materials < b.materialCost) {
              blockers.push(`Need ${(b.materialCost - resources.materials).toLocaleString()} more materials (you have ${Math.floor(resources.materials).toLocaleString()})`);
            }
            if (blockers.length === 0) return null;
            return (
              <div style={{
                fontSize: 11,
                color: '#fca5a5',
                background: 'rgba(181,86,58,0.10)',
                borderLeft: '2px solid #B5563A',
                padding: '4px 6px',
                marginBottom: 6,
                borderRadius: 2,
                lineHeight: 1.35,
              }}>
                {blockers.map((b, i) => <div key={i}>• {b}</div>)}
              </div>
            );
          })()}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 12 }}>
              Total: <strong style={{ color: '#facc15' }}>
                {(BUILDINGS[pickedBuilding].cost + CLAIM_COST).toLocaleString()} ${CURRENCY_NAME}
              </strong>
              <span style={{ opacity: 0.55, marginLeft: 6 }}>
                (land {CLAIM_COST.toLocaleString()} + {BUILDINGS[pickedBuilding].label.toLowerCase()} {BUILDINGS[pickedBuilding].cost.toLocaleString()})
              </span>
            </span>
            {(() => {
              const b = BUILDINGS[pickedBuilding];
              const total = b.cost + CLAIM_COST;
              const canBuild =
                credits >= total &&
                (b.materialCost === 0 || resources.materials >= b.materialCost) &&
                TIER_INDEX[rank] >= TIER_INDEX[b.minRank];
              return (
                <button
                  style={{
                    ...buttonStyle,
                    opacity: canBuild ? 1 : 0.45,
                    cursor: canBuild ? 'pointer' : 'not-allowed',
                  }}
                  onClick={handleClaim}
                  disabled={!canBuild}
                >
                  Claim &amp; Build
                </button>
              );
            })()}
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
          <div style={{ ...labelStyle, opacity: 0.85, marginTop: 4 }}>
            Type — <span style={{ color: '#facc15' }}>{BUILDINGS[(editType as BuildingType)]?.label ?? editType ?? '—'}</span>
          </div>
          <div style={{ marginTop: 10, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            {editType && (
              <button
                style={{ ...buttonStyle, background: '#B5563A' }}
                onClick={handleDemolish}
                aria-label="Demolish this building (50% refund)"
              >
                Demolish
              </button>
            )}
            <button style={buttonStyle} onClick={handleUpdate}>
              Save Name
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
            <div style={{ opacity: 0.85 }}>
              <strong>{parcel.business_name}</strong>
            </div>
          )}
          {parcel.business_type && (
            <div style={{ ...labelStyle, opacity: 0.75 }}>
              Type — <span style={{ color: '#facc15' }}>{BUILDINGS[(parcel.business_type as BuildingType)]?.label ?? parcel.business_type}</span>
            </div>
          )}
          <div style={{ fontSize: 11, opacity: 0.55, marginTop: 6 }}>
            Read-only — you don&apos;t own this parcel.
          </div>
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
