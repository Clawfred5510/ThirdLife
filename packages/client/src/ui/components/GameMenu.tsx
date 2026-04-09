import React, { useState, useEffect, useCallback } from 'react';
import { SettingsMenu } from './SettingsMenu';

type MenuState = 'none' | 'settings';

export const GameMenu: React.FC = () => {
  const [menu, setMenu] = useState<MenuState>('none');

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.code !== 'Escape') return;

      e.preventDefault();
      e.stopPropagation();

      setMenu((prev) => (prev === 'none' ? 'settings' : 'none'));
    },
    [],
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  if (menu === 'none') return null;

  return <SettingsMenu onClose={() => setMenu('none')} />;
};
