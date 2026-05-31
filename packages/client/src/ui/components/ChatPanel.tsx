import React, { useEffect, useRef, useState, useCallback } from 'react';
import { ChatMessage } from '@gamestu/shared';
import { onChat, sendChat } from '../../network/Client';
import { useViewport } from '../hooks/useViewport';

const MAX_MESSAGES = 20;

const styles: Record<string, React.CSSProperties> = {
  container: {
    // In-flow inside App's desktop left-stack flex column (App.tsx owns the
    // top-left anchoring + spacing now, so chat can never collide with the
    // HUD/Wallet above it regardless of their height).
    position: 'relative',
    width: 380,
    maxHeight: 260,
    display: 'flex',
    flexDirection: 'column',
    background: 'rgba(0, 0, 0, 0.55)',
    borderRadius: 6,
    padding: 8,
    fontFamily: '"Courier New", Courier, monospace',
    fontSize: 13,
    color: '#ffffff',
    pointerEvents: 'auto',
  },
  containerMobile: {
    position: 'absolute',
    // Bottom-left dock. `right: 80` keeps the input clear of the phone
    // FAB. `maxWidth: 400` keeps the panel a chat-sized card on iPad
    // landscape instead of stretching across the whole width.
    bottom: 16,
    left: 8,
    right: 80,
    maxWidth: 400,
    maxHeight: '30vh',
    display: 'flex',
    flexDirection: 'column',
    background: 'rgba(0, 0, 0, 0.78)',
    borderRadius: 10,
    padding: 8,
    paddingTop: 24,
    fontFamily: '"Courier New", Courier, monospace',
    fontSize: 12,
    color: '#ffffff',
    pointerEvents: 'auto',
  },
  mobileFab: {
    position: 'absolute',
    top: 16,
    left: 16,
    width: 44, height: 44,
    borderRadius: 22,
    background: 'rgba(0, 0, 0, 0.65)',
    border: '1px solid rgba(216,148,56,0.35)',
    color: '#F5E6D0',
    fontSize: 20,
    cursor: 'pointer',
    pointerEvents: 'auto',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  mobileClose: {
    position: 'absolute',
    top: 4, right: 6,
    width: 24, height: 24, borderRadius: 12,
    background: 'rgba(255,255,255,0.1)',
    border: 'none',
    color: '#ffffff',
    fontSize: 12,
    cursor: 'pointer',
  },
  messageList: {
    flex: 1,
    overflowY: 'auto',
    marginBottom: 6,
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
  },
  message: {
    wordBreak: 'break-word' as const,
    lineHeight: 1.4,
  },
  senderName: {
    fontWeight: 'bold',
    color: '#90caf9',
  },
  input: {
    background: 'rgba(255, 255, 255, 0.1)',
    border: '1px solid rgba(255, 255, 255, 0.2)',
    borderRadius: 4,
    padding: '4px 8px',
    color: '#ffffff',
    fontFamily: '"Courier New", Courier, monospace',
    fontSize: 13,
    outline: 'none',
  },
};

export const ChatPanel: React.FC = () => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [mobileOpen, setMobileOpen] = useState(false);
  const [phoneOpen, setPhoneOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const vp = useViewport();

  // Hide the chat overlay while the phone is open — the bezel covers
  // both the FAB (top-left) and the docked panel (bottom).
  useEffect(() => {
    const onToggle = (e: Event) => {
      const d = (e as CustomEvent<{ open: boolean }>).detail;
      setPhoneOpen(!!d?.open);
    };
    window.addEventListener('tl-phone-toggle', onToggle);
    return () => window.removeEventListener('tl-phone-toggle', onToggle);
  }, []);

  useEffect(() => {
    const unsub = onChat((msg: ChatMessage) => {
      setMessages((prev) => {
        const next = [...prev, msg];
        return next.length > MAX_MESSAGES ? next.slice(next.length - MAX_MESSAGES) : next;
      });
    });
    return unsub;
  }, []);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSend = useCallback(() => {
    const text = draft.trim();
    if (text.length === 0) return;
    sendChat(text);
    setDraft('');
  }, [draft]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      // Stop propagation so game input handler doesn't pick up keystrokes while typing
      e.stopPropagation();

      if (e.key === 'Enter') {
        handleSend();
      } else if (e.key === 'Escape') {
        inputRef.current?.blur();
      }
    },
    [handleSend],
  );

  // Hide entire overlay while the phone is open on mobile — the bezel
  // covers the chat anyway and stray taps go through the wrong layer.
  if (vp.isMobile && phoneOpen) return null;

  // Mobile: chat collapses to a 💬 button in the corner; tap to expand
  // into a slim popup that doesn't cover the game view. Desktop: always
  // visible top-left panel under the wallet balance.
  if (vp.isMobile && !mobileOpen) {
    const unread = messages.length;
    return (
      <button
        onClick={() => setMobileOpen(true)}
        style={styles.mobileFab}
        aria-label={`Open chat${unread > 0 ? ` (${unread} messages)` : ''}`}
      >
        💬
      </button>
    );
  }

  const containerStyle = vp.isMobile ? styles.containerMobile : styles.container;
  return (
    <div style={containerStyle}>
      {vp.isMobile && (
        <button
          onClick={() => setMobileOpen(false)}
          style={styles.mobileClose}
          aria-label="Collapse chat"
        >
          ✕
        </button>
      )}
      <div ref={listRef} style={styles.messageList}>
        {messages.map((msg, i) => (
          <div key={i} style={styles.message}>
            <span style={styles.senderName}>{msg.senderName}: </span>
            {msg.text}
          </div>
        ))}
      </div>
      <input
        ref={inputRef}
        type="text"
        style={styles.input}
        placeholder={vp.isMobile ? 'Type & Enter' : 'Press Enter to chat...'}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={handleKeyDown}
        maxLength={200}
      />
    </div>
  );
};
