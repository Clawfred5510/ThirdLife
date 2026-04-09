import React from 'react';
import { useApi } from '../hooks/useApi';

interface Agent {
  name: string;
  department: string;
  role: string;
  status: string;
  path: string;
}

export const AgentRoster: React.FC = () => {
  const { data: agents, loading } = useApi<Agent[]>('/agents');

  if (loading) return <div style={{ color: '#8b949e', padding: 24 }}>Loading agents...</div>;

  const getStatusColor = (status: string) => {
    const s = status.toLowerCase();
    if (s.includes('active') && !s.includes('on-demand')) return '#3fb950';
    if (s.includes('standby')) return '#d29922';
    return '#8b949e';
  };

  const getStatusDot = (status: string) => ({
    width: 8,
    height: 8,
    borderRadius: '50%',
    background: getStatusColor(status),
    display: 'inline-block',
    marginRight: 8,
    flexShrink: 0,
  });

  return (
    <div>
      <h2 style={styles.heading}>Agent Roster</h2>
      <div style={styles.table}>
        <div style={styles.tableHeader}>
          <span style={{ flex: 2 }}>Agent</span>
          <span style={{ flex: 1 }}>Department</span>
          <span style={{ flex: 1 }}>Role</span>
          <span style={{ flex: 2 }}>Status</span>
        </div>
        {agents?.map((agent) => (
          <div key={agent.path} style={styles.tableRow}>
            <span style={{ flex: 2, fontWeight: 600 }}>{agent.name}</span>
            <span style={{ flex: 1, textTransform: 'capitalize', color: '#8b949e' }}>
              {agent.department}
            </span>
            <span style={{ flex: 1, textTransform: 'capitalize', color: '#8b949e' }}>
              {agent.role}
            </span>
            <span style={{ flex: 2, display: 'flex', alignItems: 'center' }}>
              <span style={getStatusDot(agent.status)} />
              {agent.status}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  heading: { fontSize: 28, fontWeight: 700, marginBottom: 24, color: '#f0f6fc' },
  table: {
    background: '#161b22',
    border: '1px solid #30363d',
    borderRadius: 8,
    overflow: 'hidden',
  },
  tableHeader: {
    display: 'flex',
    padding: '12px 16px',
    background: '#21262d',
    borderBottom: '1px solid #30363d',
    fontSize: 13,
    fontWeight: 600,
    color: '#8b949e',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  tableRow: {
    display: 'flex',
    padding: '12px 16px',
    borderBottom: '1px solid #21262d',
    fontSize: 14,
    alignItems: 'center',
  },
};
