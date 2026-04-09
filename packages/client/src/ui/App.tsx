import React from 'react';
import { HUD } from './components/HUD';
import { ChatPanel } from './components/ChatPanel';
import { Toast } from './components/Toast';

export const App: React.FC = () => {
  return (
    <>
      <HUD />
      <ChatPanel />
      <Toast />
    </>
  );
};
