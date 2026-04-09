import React, { useState } from 'react';
import { StudioOverview } from './components/StudioOverview';
import { AgentRoster } from './components/AgentRoster';
import { TaskBoard } from './components/TaskBoard';
import { ProjectPanel } from './components/ProjectPanel';
import { HealthMonitor } from './components/HealthMonitor';

type Tab = 'overview' | 'agents' | 'tasks' | 'project' | 'health';

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<Tab>('overview');

  const tabs: { id: Tab; label: string }[] = [
    { id: 'overview', label: 'Studio' },
    { id: 'agents', label: 'Agents' },
    { id: 'tasks', label: 'Tasks' },
    { id: 'project', label: 'Project' },
    { id: 'health', label: 'Health' },
  ];

  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <h1 style={styles.title}>GameStu Dashboard</h1>
        <nav style={styles.nav}>
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                ...styles.tab,
                ...(activeTab === tab.id ? styles.tabActive : {}),
              }}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </header>
      <main style={styles.main}>
        {activeTab === 'overview' && <StudioOverview />}
        {activeTab === 'agents' && <AgentRoster />}
        {activeTab === 'tasks' && <TaskBoard />}
        {activeTab === 'project' && <ProjectPanel />}
        {activeTab === 'health' && <HealthMonitor />}
      </main>
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  container: {
    fontFamily: "'Segoe UI', system-ui, -apple-system, sans-serif",
    background: '#0f1117',
    color: '#e1e4e8',
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
  },
  header: {
    background: '#161b22',
    borderBottom: '1px solid #30363d',
    padding: '16px 24px',
    display: 'flex',
    alignItems: 'center',
    gap: 32,
  },
  title: {
    fontSize: 20,
    fontWeight: 700,
    color: '#58a6ff',
    margin: 0,
    whiteSpace: 'nowrap',
  },
  nav: {
    display: 'flex',
    gap: 4,
  },
  tab: {
    background: 'transparent',
    border: '1px solid transparent',
    borderRadius: 6,
    color: '#8b949e',
    padding: '8px 16px',
    cursor: 'pointer',
    fontSize: 14,
    fontWeight: 500,
    transition: 'all 0.15s',
  },
  tabActive: {
    background: '#21262d',
    border: '1px solid #30363d',
    color: '#f0f6fc',
  },
  main: {
    flex: 1,
    padding: 24,
    overflow: 'auto',
  },
};
