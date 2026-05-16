/**
 * Tiny module-level event bus for agent lifecycle. Used to bridge the
 * REST agent-api (which adds/removes/edits agents) and the GameRoom
 * (which renders them as virtual players in the 3D world).
 *
 * Without this, the GameRoom only picks up DB changes once per autopilot
 * tick (every 60 s) — newly-created agents wouldn't visibly appear in
 * the world for up to a minute, and the same for deletes.
 *
 * Subscribers receive the affected agent id. They are expected to look
 * up the current state themselves (getAgentById, getAllAgents, etc.)
 * rather than relying on a payload, so we don't drift between the bus
 * and the DB.
 */

type AgentChangedCb = (agentId: string) => void;

const listeners: AgentChangedCb[] = [];

/** Subscribe to agent lifecycle changes. Returns an unsubscribe fn. */
export function onAgentChanged(cb: AgentChangedCb): () => void {
  listeners.push(cb);
  return () => {
    const i = listeners.indexOf(cb);
    if (i >= 0) listeners.splice(i, 1);
  };
}

/** Fire after registering, deleting, reassigning, or toggling autopilot
 *  on an agent. The bus swallows handler errors so one bad subscriber
 *  can't break the API request that triggered the change. */
export function notifyAgentChanged(agentId: string): void {
  for (const cb of listeners) {
    try { cb(agentId); } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[agentEvents] listener threw:', (e as Error).message);
    }
  }
}
