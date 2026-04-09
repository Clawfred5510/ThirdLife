import React, { useState } from 'react';
import { useApi } from '../hooks/useApi';

interface ProjectData {
  current: {
    name: string;
    phase: string;
    gdd: string | null;
    architecture: string | null;
    clientUrl: string;
  };
}

export const ProjectPanel: React.FC = () => {
  const { data, loading } = useApi<ProjectData>('/projects');
  const [showDoc, setShowDoc] = useState<'gdd' | 'arch' | null>(null);

  if (loading) return <div style={{ color: '#8b949e', padding: 24 }}>Loading project...</div>;

  const project = data?.current;
  if (!project) return <div style={{ color: '#8b949e', padding: 24 }}>No active project</div>;

  return (
    <div>
      <h2 style={styles.heading}>{project.name}</h2>
      <div style={styles.phase}>{project.phase}</div>

      <div style={styles.actions}>
        <a
          href={project.clientUrl}
          target="_blank"
          rel="noopener noreferrer"
          style={styles.openBtn}
        >
          Open Game Client
        </a>
        <button
          onClick={() => setShowDoc(showDoc === 'gdd' ? null : 'gdd')}
          style={styles.docBtn}
        >
          {showDoc === 'gdd' ? 'Hide' : 'View'} Game Design Doc
        </button>
        <button
          onClick={() => setShowDoc(showDoc === 'arch' ? null : 'arch')}
          style={styles.docBtn}
        >
          {showDoc === 'arch' ? 'Hide' : 'View'} Architecture
        </button>
      </div>

      {showDoc && (
        <div style={styles.docPanel}>
          <pre style={styles.docContent}>
            {showDoc === 'gdd' ? project.gdd : project.architecture}
          </pre>
        </div>
      )}
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  heading: { fontSize: 28, fontWeight: 700, marginBottom: 8, color: '#f0f6fc' },
  phase: {
    fontSize: 14,
    color: '#58a6ff',
    background: '#1f6feb22',
    display: 'inline-block',
    padding: '4px 12px',
    borderRadius: 12,
    marginBottom: 24,
  },
  actions: { display: 'flex', gap: 12, marginBottom: 24 },
  openBtn: {
    background: '#238636',
    color: '#fff',
    border: 'none',
    borderRadius: 6,
    padding: '10px 20px',
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
    textDecoration: 'none',
    display: 'inline-block',
  },
  docBtn: {
    background: '#21262d',
    color: '#c9d1d9',
    border: '1px solid #30363d',
    borderRadius: 6,
    padding: '10px 20px',
    fontSize: 14,
    fontWeight: 500,
    cursor: 'pointer',
  },
  docPanel: {
    background: '#161b22',
    border: '1px solid #30363d',
    borderRadius: 8,
    padding: 20,
    maxHeight: '60vh',
    overflow: 'auto',
  },
  docContent: {
    fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
    fontSize: 13,
    lineHeight: 1.6,
    color: '#c9d1d9',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    margin: 0,
  },
};
