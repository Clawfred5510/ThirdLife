import React from 'react';
import { focusRingStyle } from './theme';
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
  return (
    <>
      <style>{focusRingStyle}</style>
      <HUD />
      <ResourceBar />
      <Wallet />
      <Phone />
      <Joystick />
      <ChatPanel />
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
