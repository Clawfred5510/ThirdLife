import { Client } from 'colyseus';
import { MessageType } from '@gamestu/shared';
import { isTutorialDone, markTutorialDone } from '../db';

interface TutorialStep {
  delay: number; // milliseconds from join
  message: string;
}

const TUTORIAL_STEPS: TutorialStep[] = [
  { delay: 0, message: 'Welcome to ThirdLife! Use WASD to move around.' },
  { delay: 5000, message: 'Hold right mouse button to look around.' },
  { delay: 10000, message: 'Press Enter to chat with other players.' },
  { delay: 15000, message: 'Press J to open the Job Board and earn credits.' },
  { delay: 20000, message: 'Press E near a building to buy property.' },
  { delay: 25000, message: 'Press T for fast travel between districts. Good luck!' },
];

/** Active tutorial timers per session, so we can cancel on disconnect. */
const activeTutorials = new Map<string, NodeJS.Timeout[]>();

/**
 * Start the tutorial sequence for a player if they haven't completed it yet.
 * Call this from onJoin().
 */
export function startTutorialIfNeeded(playerId: string, client: Client): void {
  if (isTutorialDone(playerId)) return;

  const timers: NodeJS.Timeout[] = [];

  for (const step of TUTORIAL_STEPS) {
    const timer = setTimeout(() => {
      try {
        client.send(MessageType.TUTORIAL, { message: step.message });
      } catch (_) {
        // Client may have disconnected — ignore
      }
    }, step.delay);
    timers.push(timer);
  }

  // After the last step, mark tutorial as done
  const doneTimer = setTimeout(() => {
    markTutorialDone(playerId);
    activeTutorials.delete(playerId);
  }, TUTORIAL_STEPS[TUTORIAL_STEPS.length - 1].delay + 1000);
  timers.push(doneTimer);

  activeTutorials.set(playerId, timers);
}

/**
 * Cancel any pending tutorial timers for a player (call from onLeave).
 */
export function cancelTutorial(playerId: string): void {
  const timers = activeTutorials.get(playerId);
  if (timers) {
    for (const t of timers) clearTimeout(t);
    activeTutorials.delete(playerId);
  }
}
