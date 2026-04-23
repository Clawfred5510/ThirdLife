import React, { useState, useEffect, useCallback, useRef } from 'react';
import { CURRENCY_NAME } from '@gamestu/shared';
import { sendJobStart, sendJobBoard, onJobUpdate, onJobComplete } from '../../network/Client';

interface JobDef {
  type: string;
  name: string;
  description: string;
  payRange: string;
}

const JOBS: JobDef[] = [
  {
    type: 'delivery',
    name: 'Delivery Driver',
    description: 'Pick up packages and deliver them across the city before time runs out.',
    payRange: '50 - 120 $AMETA',
  },
  {
    type: 'security',
    name: 'Security Patrol',
    description: 'Walk a patrol route through the district and check in at each waypoint.',
    payRange: '80 - 150 $AMETA',
  },
  {
    type: 'construction',
    name: 'Construction Work',
    description: 'Visit construction sites and complete building tasks for contractors.',
    payRange: '100 - 200 $AMETA',
  },
  {
    type: 'fishing',
    name: 'Commercial Fishing',
    description: 'Head to the waterfront and catch fish to sell at the market.',
    payRange: '30 - 180 $AMETA',
  },
];

interface ActiveJob {
  jobType: string;
  objective: string;
  timeRemaining: number;
  progress: string;
}

export const JobBoard: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [activeJob, setActiveJob] = useState<ActiveJob | null>(null);
  const [completionMsg, setCompletionMsg] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Countdown timer for active job
  useEffect(() => {
    if (activeJob && activeJob.timeRemaining > 0) {
      timerRef.current = setInterval(() => {
        setActiveJob((prev) => {
          if (!prev) return prev;
          const next = prev.timeRemaining - 1;
          if (next <= 0) return { ...prev, timeRemaining: 0 };
          return { ...prev, timeRemaining: next };
        });
      }, 1000);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [activeJob?.jobType]);

  // Network listeners
  useEffect(() => {
    const unsubUpdate = onJobUpdate((update) => {
      setActiveJob({
        jobType: update.jobType,
        objective: update.objective,
        timeRemaining: update.timeRemaining,
        progress: update.progress,
      });
    });
    const unsubComplete = onJobComplete((result) => {
      setActiveJob(null);
      setCompletionMsg(`Job complete! Earned ${result.reward} $${CURRENCY_NAME}`);
      setTimeout(() => setCompletionMsg(null), 4000);
    });
    return () => {
      unsubUpdate();
      unsubComplete();
    };
  }, []);

  // Toggle with J key
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.code !== 'KeyJ') return;
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      e.preventDefault();
      setOpen((prev) => !prev);
    },
    [],
  );

  // Close on Escape
  const handleEscape = useCallback(
    (e: KeyboardEvent) => {
      if (e.code === 'Escape' && open) {
        setOpen(false);
      }
    },
    [open],
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keydown', handleEscape);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keydown', handleEscape);
    };
  }, [handleKeyDown, handleEscape]);

  // Request job list when opening
  useEffect(() => {
    if (open) sendJobBoard();
  }, [open]);

  const handleAcceptJob = (jobType: string) => {
    sendJobStart(jobType);
    setOpen(false);
    // Optimistically set a placeholder active job
    const def = JOBS.find((j) => j.type === jobType);
    setActiveJob({
      jobType,
      objective: def ? def.description : 'Starting job...',
      timeRemaining: 300,
      progress: 'Checkpoint 0/4',
    });
  };

  const handleCancelJob = () => {
    setActiveJob(null);
    // Server will handle cleanup via next JOB_UPDATE / timeout
  };

  const formatTime = (seconds: number): string => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  // Completion toast
  if (completionMsg && !open) {
    return (
      <div
        style={{
          position: 'absolute',
          top: 80,
          left: '50%',
          transform: 'translateX(-50%)',
          backgroundColor: 'rgba(34, 197, 94, 0.25)',
          border: '1px solid rgba(34, 197, 94, 0.5)',
          borderRadius: 6,
          padding: '10px 20px',
          color: '#22c55e',
          fontFamily: 'monospace',
          fontSize: 14,
          fontWeight: 'bold',
          zIndex: 120,
          pointerEvents: 'none',
        }}
      >
        {completionMsg}
      </div>
    );
  }

  // Active job tracker overlay (always visible when a job is active, regardless of panel)
  if (activeJob && !open) {
    return (
      <div
        style={{
          position: 'absolute',
          top: 80,
          right: 16,
          width: 260,
          backgroundColor: 'rgba(0, 0, 0, 0.8)',
          border: '1px solid rgba(255, 255, 255, 0.15)',
          borderRadius: 8,
          padding: 16,
          color: 'white',
          fontFamily: 'monospace',
          zIndex: 110,
        }}
      >
        <div style={{ fontSize: 11, opacity: 0.5, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 1 }}>
          Active Job
        </div>
        <div style={{ fontSize: 14, fontWeight: 'bold', marginBottom: 8 }}>
          {JOBS.find((j) => j.type === activeJob.jobType)?.name ?? activeJob.jobType}
        </div>
        <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 8, lineHeight: 1.4 }}>
          {activeJob.objective}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 10 }}>
          <span style={{ color: '#facc15' }}>{formatTime(activeJob.timeRemaining)}</span>
          <span style={{ opacity: 0.7 }}>{activeJob.progress}</span>
        </div>
        <button
          onClick={handleCancelJob}
          style={{
            width: '100%',
            padding: '6px 0',
            backgroundColor: 'rgba(239, 68, 68, 0.2)',
            border: '1px solid rgba(239, 68, 68, 0.4)',
            borderRadius: 4,
            color: '#ef4444',
            cursor: 'pointer',
            fontFamily: 'monospace',
            fontSize: 12,
          }}
        >
          Cancel Job
        </button>
      </div>
    );
  }

  if (!open) return null;

  // Full job board panel
  return (
    <div
      style={{
        position: 'absolute',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        width: 350,
        maxHeight: '80vh',
        backgroundColor: 'rgba(0, 0, 0, 0.88)',
        border: '1px solid rgba(255, 255, 255, 0.2)',
        borderRadius: 8,
        padding: 24,
        color: 'white',
        fontFamily: 'monospace',
        zIndex: 120,
        overflowY: 'auto',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>Job Board</h2>
        <button
          onClick={() => setOpen(false)}
          style={{
            background: 'none',
            border: 'none',
            color: 'rgba(255,255,255,0.6)',
            cursor: 'pointer',
            fontSize: 16,
            fontFamily: 'monospace',
          }}
        >
          [X]
        </button>
      </div>

      {activeJob && (
        <div
          style={{
            backgroundColor: 'rgba(250, 204, 21, 0.15)',
            border: '1px solid rgba(250, 204, 21, 0.3)',
            borderRadius: 4,
            padding: '8px 12px',
            marginBottom: 16,
            fontSize: 12,
            color: '#facc15',
          }}
        >
          You already have an active job. Cancel it to take a new one.
        </div>
      )}

      {/* Job listings */}
      {JOBS.map((job) => (
        <div
          key={job.type}
          style={{
            backgroundColor: 'rgba(255, 255, 255, 0.05)',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            borderRadius: 6,
            padding: 14,
            marginBottom: 10,
          }}
        >
          <div style={{ fontSize: 14, fontWeight: 'bold', marginBottom: 4 }}>{job.name}</div>
          <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 8, lineHeight: 1.4 }}>{job.description}</div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: '#facc15' }}>{job.payRange}</span>
            <button
              onClick={() => handleAcceptJob(job.type)}
              disabled={!!activeJob}
              style={{
                padding: '5px 14px',
                backgroundColor: activeJob ? 'rgba(255,255,255,0.05)' : 'rgba(34, 197, 94, 0.25)',
                border: `1px solid ${activeJob ? 'rgba(255,255,255,0.1)' : 'rgba(34, 197, 94, 0.5)'}`,
                borderRadius: 4,
                color: activeJob ? 'rgba(255,255,255,0.3)' : '#22c55e',
                cursor: activeJob ? 'not-allowed' : 'pointer',
                fontFamily: 'monospace',
                fontSize: 12,
                fontWeight: 'bold',
              }}
            >
              Accept
            </button>
          </div>
        </div>
      ))}

      <div style={{ marginTop: 8, opacity: 0.4, fontSize: 11, textAlign: 'center' }}>
        Press J or ESC to close
      </div>
    </div>
  );
};
