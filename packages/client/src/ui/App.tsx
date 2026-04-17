import React from 'react';
import { HUD } from './components/HUD';
import { ChatPanel } from './components/ChatPanel';
import { Toast } from './components/Toast';
import { Minimap } from './components/Minimap';
import { Wallet } from './components/Wallet';
import { PropertyPanel } from './components/PropertyPanel';
import { ParcelPanel } from './components/ParcelPanel';
import { GameMenu } from './components/GameMenu';
import { CharacterCreator } from './components/CharacterCreator';
import { ResourceBar } from './components/ResourceBar';
import { features } from '@gamestu/shared';
import { FastTravel } from './components/FastTravel';

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
      <HUD />
      <ResourceBar />
      <Wallet />
      <ChatPanel />
      <Toast />
      <Minimap />
      <PropertyPanel />
      <ParcelPanel />
      <GameMenu />
      <CharacterCreator />
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
