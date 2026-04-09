import React from 'react';
import { useApi } from '../hooks/useApi';

interface HealthData {
  server: {
    status: string;
    port: number;
    uptime: number;
  };
  timestamp: string;
}

export const HealthMonitor: React.FC = () => {
  const { data, error, loading } = useApi<HealthData>('/health', 5000);

  const formatUptime = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return `${h}h ${m}m ${s}s`;
  };

  return (
    <div>
      <h2 style={styles.heading}>System Health</h2>
      <div style={styles.grid}>
        <div style={styles.card}>
          <div style={styles.cardTitle}>Game Server</div>
          {loading ? (
            <div style={styles.status}>Checking...</div>
          ) : error ? (
            <>
              <div style={{ ...styles.indicator, background: '#f85149' }} />
              <div style={{ ...styles.status, color: '#f85149' }}>Offline</div>
              <div style={styles.detail}>{error}</div>
            </>
          ) : (
            <>
              <div style={{ ...styles.indicator, background: '#3fb950' }} />
              <div style={{ ...styles.status, color: '#3fb950' }}>Running</div>
              <div style={styles.detail}>Port: {data?.server.port}</div>
              <div style={styles.detail}>Uptime: {formatUptime(data?.server.uptime ?? 0)}</div>
            </>
          )}
        </div>

        <div style={styles.card}>
          <div style={styles.cardTitle}>Client Dev Server</div>
          <div style={{ ...styles.indicator, background: '#3fb950' }} />
          <div style={{ ...styles.status, color: '#3fb950' }}>Running</div>
          <div style={styles.detail}>Port: 3000</div>
          <div style={styles.detail}>
            <a
              href="http://localhost:3000"
              target="_blank"
              rel="noopener noreferrer"
              style={styles.link}
            >
              Open in new tab
            </a>
          </div>
        </div>

        <div style={styles.card}>
          <div style={styles.cardTitle}>Dashboard</div>
          <div style={{ ...styles.indicator, background: '#3fb950' }} />
          <div style={{ ...styles.status, color: '#3fb950' }}>Running</div>
          <div style={styles.detail}>Port: 3001</div>
        </div>
      </div>

      {data && (
        <div style={styles.timestamp}>
          Last checked: {new Date(data.timestamp).toLocaleTimeString()}
        </div>
      )}
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  heading: { fontSize: 28, fontWeight: 700, marginBottom: 24, color: '#f0f6fc' },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
    gap: 16,
  },
  card: {
    background: '#161b22',
    border: '1px solid #30363d',
    borderRadius: 8,
    padding: 20,
  },
  cardTitle: { fontSize: 14, fontWeight: 600, marginBottom: 12, color: '#f0f6fc' },
  indicator: {
    width: 12,
    height: 12,
    borderRadius: '50%',
    marginBottom: 8,
  },
  status: { fontSize: 20, fontWeight: 700, marginBottom: 8 },
  detail: { fontSize: 13, color: '#8b949e', marginBottom: 4 },
  link: { color: '#58a6ff', textDecoration: 'none' },
  timestamp: { marginTop: 24, fontSize: 12, color: '#484f58' },
};
