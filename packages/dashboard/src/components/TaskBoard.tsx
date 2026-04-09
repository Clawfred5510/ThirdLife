import React from 'react';
import { useApi } from '../hooks/useApi';

interface TaskData {
  board: string | null;
  categories: Record<string, string[]>;
}

export const TaskBoard: React.FC = () => {
  const { data, loading } = useApi<TaskData>('/tasks', 10000);

  if (loading) return <div style={{ color: '#8b949e', padding: 24 }}>Loading tasks...</div>;

  const board = data?.board ?? '';
  const sections = parseBoard(board);

  return (
    <div>
      <h2 style={styles.heading}>Task Board</h2>
      <div style={styles.columns}>
        {['In Progress', 'Backlog', 'Done'].map((col) => {
          const tasks = sections[col] ?? [];
          const colColor =
            col === 'In Progress' ? '#1f6feb' : col === 'Done' ? '#3fb950' : '#30363d';
          return (
            <div key={col} style={styles.column}>
              <div style={{ ...styles.columnHeader, borderTopColor: colColor }}>
                <span>{col}</span>
                <span style={styles.count}>{tasks.length}</span>
              </div>
              <div style={styles.cardList}>
                {tasks.length === 0 ? (
                  <div style={styles.empty}>No tasks</div>
                ) : (
                  tasks.map((task, i) => (
                    <div key={i} style={styles.card}>
                      {task}
                    </div>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

function parseBoard(md: string): Record<string, string[]> {
  const sections: Record<string, string[]> = {};
  let currentSection = '';

  for (const line of md.split('\n')) {
    if (line.startsWith('### ')) {
      currentSection = line.replace('### ', '').trim();
      sections[currentSection] = [];
    } else if (line.startsWith('- [')) {
      const text = line.replace(/- \[[ x]\] /, '').trim();
      if (currentSection && text) {
        sections[currentSection].push(text);
      }
    }
  }

  return sections;
}

const styles: Record<string, React.CSSProperties> = {
  heading: { fontSize: 28, fontWeight: 700, marginBottom: 24, color: '#f0f6fc' },
  columns: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: 16,
    alignItems: 'start',
  },
  column: {
    background: '#161b22',
    border: '1px solid #30363d',
    borderRadius: 8,
    overflow: 'hidden',
  },
  columnHeader: {
    padding: '12px 16px',
    background: '#21262d',
    borderTop: '3px solid',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    fontWeight: 600,
    fontSize: 14,
  },
  count: {
    background: '#30363d',
    borderRadius: 10,
    padding: '2px 8px',
    fontSize: 12,
    color: '#8b949e',
  },
  cardList: { padding: 8 },
  card: {
    background: '#0d1117',
    border: '1px solid #21262d',
    borderRadius: 6,
    padding: '10px 12px',
    marginBottom: 6,
    fontSize: 13,
    lineHeight: 1.4,
  },
  empty: { padding: 12, color: '#484f58', fontSize: 13, textAlign: 'center' },
};
