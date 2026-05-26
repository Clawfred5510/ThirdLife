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

  // Cartoon palette — warm parchment surface, terra cotta CTAs, soft
  // drop shadows. All panels in this file inherit from this; the
  // overrides below just tweak position/size per mobile vs desktop.
  const COLORS = {
    surface: '#FAF3E0',
    surfaceAlt: '#F0E5C9',
    border: '#E3CBA8',
    text: '#3A2A1F',
    textMuted: '#8B6E4E',
    accent: '#D86E4A',
    accentText: '#FFFFFF',
    gold: '#E5A845',
    food: '#5BAA5A',
    materials: '#A26B3F',
    energy: '#E5A845',
    luxury: '#9B6BBE',
    housing: '#5C8FB3',
    civic: '#C77B4F',
    soft: 'rgba(58,42,31,0.18)',
  };
  const panelStyleBase: React.CSSProperties = {
    background: COLORS.surface,
    color: COLORS.text,
    fontFamily: '"Nunito", system-ui, sans-serif',
    boxShadow: `0 8px 24px ${COLORS.soft}, inset 0 0 0 1px ${COLORS.border}`,
    zIndex: 100,
  };
  const panelStyle: React.CSSProperties = vp.isMobile
    ? {
        ...panelStyleBase,
        position: 'absolute',
        // Top inset clears the wallet/minimap row (~120). Bottom inset
        // clears the phone FAB strip (~80). Centered with a max-width so
        // iPad landscape doesn't get a panel stretched across the whole
        // viewport; narrow phones still get full-width via the 16px insets.
        top: 120, bottom: 80,
        left: '50%',
        transform: 'translateX(-50%)',
        width: 'calc(100% - 16px)',
        maxWidth: 560,
        overflowY: 'auto',
        WebkitOverflowScrolling: 'touch' as 'touch',
        padding: '14px 16px',
        borderRadius: 16,
        fontSize: 13,
      }
    : {
        ...panelStyleBase,
        position: 'absolute',
        bottom: 20, left: '50%', transform: 'translateX(-50%)',
        padding: '18px 22px',
        borderRadius: 18,
        fontSize: 14,
        minWidth: 340,
        maxWidth: 440,
      };

  const labelStyle: React.CSSProperties = {
    fontSize: 11,
    textTransform: 'uppercase' as const,
    letterSpacing: 1,
    color: COLORS.textMuted,
    fontWeight: 700,
    marginBottom: 6,
  };

  const inputStyle: React.CSSProperties = {
    background: '#FFFCF2',
    border: `2px solid ${COLORS.border}`,
    borderRadius: 10,
    color: COLORS.text,
    padding: '8px 12px',
    fontSize: 14,
    fontFamily: '"Nunito", system-ui, sans-serif',
    fontWeight: 500,
    width: '100%',
    marginBottom: 8,
    boxSizing: 'border-box' as const,
    outline: 'none',
  };

  const buttonStyle: React.CSSProperties = {
    background: COLORS.accent,
    border: 'none',
    borderRadius: 12,
    color: COLORS.accentText,
    padding: '10px 22px',
    fontSize: 14,
    fontFamily: '"Nunito", system-ui, sans-serif',
    cursor: 'pointer',
    fontWeight: 800 as const,
    boxShadow: `0 4px 0 #B0573B, 0 6px 12px ${COLORS.soft}`,
    transition: 'transform 0.08s ease',
  };

  // Per-category accent — building tiles pick up a small color band so
  // the grid reads at a glance.
  const CATEGORY_TINT: Record<string, string> = {
    food: COLORS.food,
    materials: COLORS.materials,
    energy: COLORS.energy,
    'luxury-housing': COLORS.housing,
    'luxury-civic': COLORS.civic,
    legacy: COLORS.textMuted,
  };

  return (
    <div
      style={panelStyle}
      role="dialog"
      aria-label={`Parcel ${parcel.id} details`}
      aria-modal="false"
    >
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 10,
        paddingBottom: 8,
        borderBottom: `2px solid ${COLORS.border}`,
      }}>
        <span style={{
          fontSize: 14,
          fontWeight: 800,
          color: COLORS.text,
        }}>
          📍 Parcel #{parcel.id}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 11, color: COLORS.textMuted, fontWeight: 600 }}>
            ({parcel.grid_x}, {parcel.grid_y})
          </span>
          <button
            onClick={() => selectParcel(null)}
            aria-label="Close parcel details (Escape)"
            style={{
              background: COLORS.surfaceAlt,
              border: 'none',
              color: COLORS.text,
              fontSize: 14,
              cursor: 'pointer',
              padding: 0,
              lineHeight: 1,
              width: 24, height: 24, borderRadius: 12,
              fontWeight: 800,
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
          <div style={{
            marginBottom: 10,
            fontFamily: '"Fraunces", Georgia, serif',
            fontSize: 18, fontWeight: 800,
            color: COLORS.text,
          }}>
            Pick what to build
            <span style={{
              display: 'block',
              fontFamily: '"Nunito", system-ui, sans-serif',
              fontSize: 11, fontWeight: 600,
              color: COLORS.textMuted,
              marginTop: 2,
            }}>
              Unclaimed parcel
            </span>
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
            {BUILDING_LIST.map((b) => {
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
              const tint = CATEGORY_TINT[b.category] ?? COLORS.textMuted;
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
                    background: selected ? COLORS.surfaceAlt : '#FFFCF2',
                    color: canBuild ? COLORS.text : 'rgba(58,42,31,0.35)',
                    border: selected
                      ? `2.5px solid ${COLORS.accent}`
                      : `2px solid ${!rankOk ? 'rgba(226,92,77,0.35)' : COLORS.border}`,
                    borderRadius: 12,
                    padding: '8px 6px 6px',
                    fontFamily: '"Nunito", system-ui, sans-serif',
                    fontSize: 11,
                    fontWeight: 700,
                    cursor: canBuild ? 'pointer' : 'not-allowed',
                    textAlign: 'center',
                    lineHeight: 1.25,
                    position: 'relative',
                    boxShadow: selected
                      ? `0 4px 0 #B0573B, 0 6px 12px ${COLORS.soft}`
                      : (canBuild ? `0 2px 0 ${COLORS.border}` : 'none'),
                    opacity: canBuild ? 1 : 0.6,
                  }}
                >
                  {/* Chain accent band */}
                  <div style={{
                    height: 4,
                    background: tint,
                    borderRadius: 2,
                    margin: '-2px -2px 6px',
                    opacity: canBuild ? 1 : 0.5,
                  }} />
                  <div style={{ fontWeight: 800, fontSize: 11 }}>{b.label}</div>
                  <div style={{ fontSize: 9, color: COLORS.textMuted, marginTop: 2 }}>
                    T{b.tier} · {b.category.replace('luxury-', '')}
                  </div>
                  <div style={{
                    fontSize: 11,
                    color: COLORS.gold,
                    fontWeight: 700,
                    marginTop: 4,
                    fontVariantNumeric: 'tabular-nums' as const,
                  }}>
                    {b.cost.toLocaleString()}
                  </div>
                  {b.materialCost > 0 && (
                    <div style={{
                      fontSize: 9,
                      fontWeight: 600,
                      color: enoughMaterials ? COLORS.materials : '#C04331',
                    }}>
                      +{b.materialCost.toLocaleString()} ⛏️
                    </div>
                  )}
                  {!rankOk && (
                    <div style={{
                      position: 'absolute', top: 4, right: 5,
                      padding: '1px 4px',
                      borderRadius: 6,
                      fontSize: 8, fontWeight: 800,
                      color: '#FFFFFF',
                      background: 'rgba(226,92,77,0.85)',
                      letterSpacing: 0.4,
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
                fontSize: 12,
                color: '#7A2E1F',
                background: '#FBE5D6',
                border: `2px solid ${COLORS.accent}`,
                padding: '8px 10px',
                marginBottom: 10,
                borderRadius: 10,
                lineHeight: 1.45,
                fontWeight: 600,
              }}>
                {blockers.map((b, i) => <div key={i}>⚠️ {b}</div>)}
              </div>
            );
          })()}
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 12,
            flexWrap: 'wrap' as const,
          }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>
              Total: <strong style={{ color: COLORS.gold, fontSize: 16, fontWeight: 800 }}>
                {(BUILDINGS[pickedBuilding].cost + CLAIM_COST).toLocaleString()} ${CURRENCY_NAME}
              </strong>
              <span style={{ color: COLORS.textMuted, marginLeft: 6, fontSize: 11, display: 'block' }}>
                land {CLAIM_COST.toLocaleString()} + {BUILDINGS[pickedBuilding].label.toLowerCase()} {BUILDINGS[pickedBuilding].cost.toLocaleString()}
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
          <div style={{
            fontSize: 11,
            color: COLORS.textMuted,
            marginTop: 8,
            fontWeight: 600,
          }}>
            Your balance: <span style={{ color: COLORS.gold }}>{credits.toLocaleString()} ${CURRENCY_NAME}</span>
          </div>
        </>
      )}

      {isOwnedByMe && (
        <>
          <div style={{
            marginBottom: 10,
            color: COLORS.food,
            fontWeight: 800,
            fontSize: 16,
            fontFamily: '"Fraunces", Georgia, serif',
          }}>
            🏠 Your Parcel
          </div>
          <div style={labelStyle}>Business Name</div>
          <input
            style={inputStyle}
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            placeholder="e.g. Joe's Cafe"
          />
          <div style={{ ...labelStyle, marginTop: 6 }}>
            Type — <span style={{ color: COLORS.gold }}>{BUILDINGS[(editType as BuildingType)]?.label ?? editType ?? '—'}</span>
          </div>
          <div style={{ marginTop: 12, display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            {editType && (
              <button
                style={{ ...buttonStyle, background: '#C04331', boxShadow: '0 4px 0 #8E2F22, 0 6px 12px rgba(58,42,31,0.18)' }}
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
          <div style={{
            marginBottom: 8,
            color: COLORS.accent,
            fontWeight: 700,
            fontSize: 13,
          }}>
            Owned by another player
          </div>
          {parcel.business_name && (
            <div style={{ fontSize: 16, fontWeight: 800, fontFamily: '"Fraunces", serif' }}>
              {parcel.business_name}
            </div>
          )}
          {parcel.business_type && (
            <div style={{ ...labelStyle, marginTop: 4 }}>
              Type — <span style={{ color: COLORS.gold }}>{BUILDINGS[(parcel.business_type as BuildingType)]?.label ?? parcel.business_type}</span>
            </div>
          )}
          <div style={{ fontSize: 11, color: COLORS.textMuted, marginTop: 6 }}>
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
