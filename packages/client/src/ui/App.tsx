import React from 'react';
import { focusRingStyle } from './theme';
import { useViewport } from './hooks/useViewport';
import { HUD } from './components/HUD';
import { ChatPanel } from './components/ChatPanel';
import { Toast } from './components/Toast';
import { Minimap } from './components/Minimap';
import { Wallet } from './components/Wallet';
import { ParcelPanel } from './components/ParcelPanel';
import { GameMenu } from './components/GameMenu';
import { CharacterCreator } from './components/CharacterCreator';
import { ResourceBar } from './components/ResourceBar';
import { Phone } from './components/Phone';
import { BigMap } from './components/BigMap';
import { Joystick } from './components/Joystick';
import { features } from '@gamestu/shared';
import { FastTravel } from './components/FastTravel';
import { AgentInfoPanel } from './components/AgentInfoPanel';
import { RankUpModal } from './components/RankUpModal';
import { OnboardingModal } from './components/OnboardingModal';

/** Lazy-loaded components gated by feature flags. */
const JobBoard = React.lazy(() =>
  import('./components/JobBoard').then((m) => ({ default: m.JobBoard })),
);
const TutorialOverlay = React.lazy(() =>
  import('./components/TutorialOverlay').then((m) => ({ default: m.TutorialOverlay })),
);

export const App: React.FC = () => {
  const vp = useViewport();
  // Desktop top-left stack: HUD title, Wallet pill, and ChatPanel share one
  // flex column anchored at (16,16) so they stack with real spacing instead
  // of each guessing a fixed `top:` offset (the old HUD/Wallet/Chat
  // 16/120/160 offsets assumed a ~100px HUD height; the HUD is taller, so
  // its bottom line printed over the Wallet — the reported HUD overlap).
  // The column lets the canvas receive clicks (pointerEvents:none); ChatPanel
  // re-enables pointer events on itself. On mobile each piece self-positions
  // (top-right dot / pill / chat FAB), so they render as bare siblings.
  const leftStack = (
    <>
      <HUD />
      <Wallet />
      <ChatPanel />
    </>
  );
  return (
    <>
      <style>{focusRingStyle}</style>
      {vp.isMobile ? leftStack : (
        <div
          style={{
            position: 'absolute',
            top: 16,
            left: 16,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-start',
            gap: 12,
            pointerEvents: 'none',
            zIndex: 10,
          }}
        >
          {leftStack}
        </div>
      )}
      <ResourceBar />
      <Phone />
      <Joystick />
      <Toast />
      <Minimap />
      <BigMap />
      <ParcelPanel />
      <GameMenu />
      <CharacterCreator />
      <AgentInfoPanel />
      <RankUpModal />
      <OnboardingModal />
      {features.JOBS && (
        <React.Suspense fallback={null}>
          <JobBoard />
        </React.Suspense>
      )}
      <FastTravel />
      {features.TUTORIAL && (
        <React.Suspense fallback={null}>
          <TutorialOverlay />
        </React.Suspense>
      )}
    </>
  );
};
