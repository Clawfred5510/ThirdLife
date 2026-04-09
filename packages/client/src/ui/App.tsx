import React from 'react';
import { HUD } from './components/HUD';
import { ChatPanel } from './components/ChatPanel';
import { Toast } from './components/Toast';
import { Minimap } from './components/Minimap';
import { Wallet } from './components/Wallet';
import { PropertyPanel } from './components/PropertyPanel';
import { GameMenu } from './components/GameMenu';
import { JobBoard } from './components/JobBoard';
import { FastTravel } from './components/FastTravel';

export const App: React.FC = () => {
  return (
    <>
      <HUD />
      <Wallet />
      <ChatPanel />
      <Toast />
      <Minimap />
      <PropertyPanel />
      <GameMenu />
      <JobBoard />
      <FastTravel />
    </>
  );
};
