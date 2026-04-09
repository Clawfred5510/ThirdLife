import React, { useEffect, useRef, useState, useCallback } from 'react';
import { ChatMessage } from '@gamestu/shared';
import { onChat, sendChat } from '../../network/Client';

const MAX_MESSAGES = 20;

const styles: Record<string, React.CSSProperties> = {
  container: {
    position: 'absolute',
    bottom: 16,
    left: 16,
    width: 380,
    maxHeight: 300,
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
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

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

  return (
    <div style={styles.container}>
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
        placeholder="Press Enter to chat..."
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={handleKeyDown}
        maxLength={200}
      />
    </div>
  );
};
