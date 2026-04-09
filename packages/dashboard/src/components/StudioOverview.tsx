import React from 'react';
import { useApi } from '../hooks/useApi';

interface StudioData {
  name: string;
  studioDoc: string | null;
}

interface AgentData {
  name: string;
  department: string;
  status: string;
}

export const StudioOverview: React.FC = () => {
  const { data: studio, loading } = useApi<StudioData>('/studio');
  const { data: agents } = useApi<AgentData[]>('/agents');

  if (loading) return <div style={styles.loading}>Loading studio data...</div>;

  const activeCount = agents?.filter((a) =>
    a.status.toLowerCase().includes('active'),
  ).length ?? 0;
  const totalCount = agents?.length ?? 0;
  const departments = [...new Set(agents?.map((a) => a.department) ?? [])];

  return (
    <div>
      <h2 style={styles.heading}>{studio?.name ?? 'GameStu'}</h2>

      <div style={styles.statGrid}>
        <div style={styles.statCard}>
          <div style={styles.statValue}>{activeCount}</div>
          <div style={styles.statLabel}>Active Agents</div>
        </div>
        <div style={styles.statCard}>
          <div style={styles.statValue}>{totalCount}</div>
          <div style={styles.statLabel}>Total Agents</div>
        </div>
        <div style={styles.statCard}>
          <div style={styles.statValue}>{departments.length}</div>
          <div style={styles.statLabel}>Departments</div>
        </div>
        <div style={styles.statCard}>
          <div style={styles.statValue}>1</div>
          <div style={styles.statLabel}>Active Projects</div>
        </div>
      </div>

      <div style={styles.section}>
        <h3 style={styles.subheading}>Departments</h3>
        <div style={styles.deptGrid}>
          {departments.map((dept) => {
            const deptAgents = agents?.filter((a) => a.department === dept) ?? [];
            const active = deptAgents.filter((a) =>
              a.status.toLowerCase().includes('active'),
            ).length;
            return (
              <div key={dept} style={styles.deptCard}>
                <div style={styles.deptName}>{dept}</div>
                <div style={styles.deptStat}>
                  {active}/{deptAgents.length} active
                </div>
                <div style={styles.agentList}>
                  {deptAgents.map((a) => (
                    <span
                      key={a.name}
                      style={{
                        ...styles.agentChip,
                        background: a.status.toLowerCase().includes('active')
                          ? '#1f6feb33'
                          : '#30363d',
                        color: a.status.toLowerCase().includes('active')
                          ? '#58a6ff'
                          : '#8b949e',
                      }}
                    >
                      {a.name}
                    </span>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  loading: { color: '#8b949e', padding: 24 },
  heading: { fontSize: 28, fontWeight: 700, marginBottom: 24, color: '#f0f6fc' },
  statGrid: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 32 },
  statCard: {
    background: '#161b22',
    border: '1px solid #30363d',
    borderRadius: 8,
    padding: 20,
    textAlign: 'center',
  },
  statValue: { fontSize: 36, fontWeight: 700, color: '#58a6ff' },
  statLabel: { fontSize: 13, color: '#8b949e', marginTop: 4 },
  section: { marginTop: 8 },
  subheading: { fontSize: 18, fontWeight: 600, marginBottom: 16, color: '#f0f6fc' },
  deptGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 },
  deptCard: {
    background: '#161b22',
    border: '1px solid #30363d',
    borderRadius: 8,
    padding: 16,
  },
  deptName: { fontSize: 16, fontWeight: 600, textTransform: 'capitalize', marginBottom: 4 },
  deptStat: { fontSize: 13, color: '#8b949e', marginBottom: 12 },
  agentList: { display: 'flex', flexWrap: 'wrap', gap: 6 },
  agentChip: {
    fontSize: 12,
    padding: '3px 8px',
    borderRadius: 12,
    whiteSpace: 'nowrap',
  },
};
