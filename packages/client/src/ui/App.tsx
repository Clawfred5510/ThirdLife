import React from 'react';
import { HUD } from './components/HUD';
import { ChatPanel } from './components/ChatPanel';
import { Toast } from './components/Toast';
import { Minimap } from './components/Minimap';

export const App: React.FC = () => {
  return (
    <>
      <HUD />
      <ChatPanel />
      <Toast />
      <Minimap />
    </>
  );
};
