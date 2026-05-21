/**
 * Module-level event bus for wallet credit changes.
 *
 * REST endpoints (POST /agents/register, /actions/buy-land, etc.) and
 * the economy() backend mutate player credits directly in the DB. The
 * Colyseus GameRoom never sees those writes — it only broadcasts
 * CREDITS_UPDATE messages from its own message handlers (claim, build).
 * Without a bridge, the wallet UI on a connected client never refreshes
 * after a REST debit, even though the DB is correct. Players see "no
 * cost was charged" when actually the cost WAS charged, just silently.
 *
 * GameRoom subscribes here; whenever a REST handler (or any economy
 * call) fires this, the room scans its connected players, finds the
 * one whose wallet id matches, reloads the credits from the DB, and
 * sends them a fresh CREDITS_UPDATE.
 *
 * Mirror of events/agentEvents.ts.
 */

type WalletChangedCb = (walletId: string) => void;

const listeners: WalletChangedCb[] = [];

export function onWalletChanged(cb: WalletChangedCb): () => void {
  listeners.push(cb);
  return () => {
    const i = listeners.indexOf(cb);
    if (i >= 0) listeners.splice(i, 1);
  };
}

export function notifyWalletChanged(walletId: string): void {
  if (!walletId) return;
  for (const cb of listeners) {
    try { cb(walletId); } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[walletEvents] listener threw:', (e as Error).message);
    }
  }
}
