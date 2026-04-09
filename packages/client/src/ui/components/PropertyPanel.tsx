import React, { useEffect, useState, useCallback } from 'react';
import {
  ALL_BUILDINGS,
  BuildingDef,
} from '../../game/entities/buildings';
import {
  onPlayerChange,
  onPropertyUpdate,
  onCreditsUpdate,
  getSessionId,
  sendBuyProperty,
} from '../../network/Client';

interface PropertyOwnership {
  propertyId: number;
  ownerId: string;
  ownerName: string;
}

interface NearbyBuilding {
  index: number;
  def: BuildingDef;
  distance: number;
}

/**
 * Convert design coordinates to Babylon world coordinates (same transform
 * used in buildings.ts spawnBuildings).
 */
function designToWorld(x: number, z: number): { wx: number; wz: number } {
  return { wx: x - 1000, wz: z - 1000 };
}

const INTERACT_RANGE = 15;

export const PropertyPanel: React.FC = () => {
  const [localPos, setLocalPos] = useState<{ x: number; z: number } | null>(null);
  const [credits, setCredits] = useState(0);
  const [selectedBuilding, setSelectedBuilding] = useState<NearbyBuilding | null>(null);
  const [propertyOwners, setPropertyOwners] = useState<Map<number, PropertyOwnership>>(new Map());

  // Track local player position
  useEffect(() => {
    onPlayerChange((sessionId, player) => {
      if (sessionId === getSessionId()) {
        setLocalPos({ x: player.x, z: player.z });
      }
    });
    onCreditsUpdate((amount: number) => {
      setCredits(amount);
    });
    onPropertyUpdate((update: { propertyId: number; ownerId: string; ownerName: string }) => {
      setPropertyOwners((prev) => {
        const next = new Map(prev);
        next.set(update.propertyId, update);
        return next;
      });
    });
  }, []);

  // Find the nearest building within range
  const findNearbyBuilding = useCallback((): NearbyBuilding | null => {
    if (!localPos) return null;

    let best: NearbyBuilding | null = null;

    for (let i = 0; i < ALL_BUILDINGS.length; i++) {
      const def = ALL_BUILDINGS[i];
      const { wx, wz } = designToWorld(def.x, def.z);
      const dx = localPos.x - wx;
      const dz = localPos.z - wz;
      const dist = Math.sqrt(dx * dx + dz * dz);

      if (dist <= INTERACT_RANGE && (!best || dist < best.distance)) {
        best = { index: i, def, distance: dist };
      }
    }

    return best;
  }, [localPos]);

  // Listen for "E" key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'KeyE' && !e.repeat) {
        // Don't trigger when typing in chat or other inputs
        const tag = (e.target as HTMLElement).tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA') return;

        const nearby = findNearbyBuilding();
        if (nearby) {
          setSelectedBuilding(nearby);
        } else {
          setSelectedBuilding(null);
        }
      }
      if (e.code === 'Escape') {
        setSelectedBuilding(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [findNearbyBuilding]);

  if (!selectedBuilding) return null;

  const { index, def } = selectedBuilding;
  const ownership = propertyOwners.get(index);
  const sessionId = getSessionId();
  const isOwned = !!ownership;
  const isOwnedByLocal = isOwned && ownership.ownerId === sessionId;
  const canAfford = !isOwned && def.purchasable && credits > 0;

  // Simple price based on building size (placeholder formula)
  const price = def.purchasable
    ? Math.round(def.width * def.depth * def.height * 0.5)
    : 0;

  const handleBuy = () => {
    sendBuyProperty(index);
    setSelectedBuilding(null);
  };

  return (
    <div
      style={{
        position: 'absolute',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        backgroundColor: 'rgba(0, 0, 0, 0.85)',
        border: '1px solid rgba(255, 255, 255, 0.2)',
        borderRadius: 8,
        padding: 24,
        color: 'white',
        fontFamily: 'monospace',
        minWidth: 280,
        textShadow: '1px 1px 2px rgba(0,0,0,0.8)',
        zIndex: 100,
      }}
    >
      {/* Close button */}
      <button
        onClick={() => setSelectedBuilding(null)}
        style={{
          position: 'absolute',
          top: 8,
          right: 8,
          background: 'none',
          border: 'none',
          color: 'rgba(255,255,255,0.6)',
          cursor: 'pointer',
          fontSize: 16,
          fontFamily: 'monospace',
        }}
      >
        [X]
      </button>

      <h3 style={{ margin: '0 0 12px 0', fontSize: 18 }}>
        {def.name.replace(/_/g, ' ')}
      </h3>

      <div style={{ opacity: 0.7, fontSize: 12, marginBottom: 12 }}>
        District: {def.district}
      </div>

      {/* Ownership status */}
      {isOwnedByLocal && (
        <div
          style={{
            backgroundColor: 'rgba(34, 197, 94, 0.2)',
            border: '1px solid rgba(34, 197, 94, 0.5)',
            borderRadius: 4,
            padding: '8px 12px',
            marginBottom: 12,
            color: '#22c55e',
            fontSize: 13,
          }}
        >
          Your Property
        </div>
      )}

      {isOwned && !isOwnedByLocal && (
        <div
          style={{
            opacity: 0.7,
            fontSize: 13,
            marginBottom: 12,
          }}
        >
          Owner: {ownership.ownerName}
        </div>
      )}

      {/* Price and buy */}
      {def.purchasable && !isOwned && (
        <>
          <div style={{ marginBottom: 12, fontSize: 14 }}>
            <span style={{ opacity: 0.7 }}>Price: </span>
            <span style={{ color: '#facc15', fontWeight: 'bold' }}>
              {price.toLocaleString()} CR
            </span>
          </div>
          <button
            onClick={handleBuy}
            disabled={!canAfford || credits < price}
            style={{
              width: '100%',
              padding: '10px 16px',
              backgroundColor:
                canAfford && credits >= price
                  ? 'rgba(34, 197, 94, 0.3)'
                  : 'rgba(255, 255, 255, 0.1)',
              border: `1px solid ${
                canAfford && credits >= price
                  ? 'rgba(34, 197, 94, 0.5)'
                  : 'rgba(255, 255, 255, 0.2)'
              }`,
              borderRadius: 4,
              color:
                canAfford && credits >= price
                  ? '#22c55e'
                  : 'rgba(255, 255, 255, 0.4)',
              cursor: canAfford && credits >= price ? 'pointer' : 'not-allowed',
              fontFamily: 'monospace',
              fontSize: 14,
              fontWeight: 'bold',
            }}
          >
            {credits < price ? 'Not enough credits' : 'Buy Property'}
          </button>
        </>
      )}

      {!def.purchasable && (
        <div style={{ opacity: 0.5, fontSize: 12, fontStyle: 'italic' }}>
          Landmark — not for sale
        </div>
      )}

      <div
        style={{
          marginTop: 12,
          opacity: 0.4,
          fontSize: 11,
          textAlign: 'center',
        }}
      >
        Press ESC to close
      </div>
    </div>
  );
};
