import { Router } from 'express';
import * as fs from 'fs';
import * as path from 'path';

const router = Router();

const STUDIO_ROOT = path.resolve(__dirname, '../../../../studio');
const DOCS_ROOT = path.resolve(__dirname, '../../../../docs');

function readMd(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}

function parseFrontmatter(content: string): { meta: Record<string, string>; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { meta: {}, body: content };
  const meta: Record<string, string> = {};
  match[1].split('\n').forEach((line) => {
    const [key, ...rest] = line.split(':');
    if (key && rest.length) meta[key.trim()] = rest.join(':').trim();
  });
  return { meta, body: match[2] };
}

// Studio overview
router.get('/studio', (_req, res) => {
  const studioMd = readMd(path.resolve(__dirname, '../../../../STUDIO.md'));
  res.json({
    name: 'GameStu',
    studioDoc: studioMd,
  });
});

// Agent roster with status
router.get('/agents', (_req, res) => {
  const agents: Array<{
    name: string;
    department: string;
    role: string;
    status: string;
    path: string;
  }> = [];

  const deptDir = path.join(STUDIO_ROOT, 'departments');
  if (!fs.existsSync(deptDir)) return res.json(agents);

  const departments = fs.readdirSync(deptDir);
  for (const dept of departments) {
    // Check for direct role.md (direction)
    const directRole = path.join(deptDir, dept, 'role.md');
    if (fs.existsSync(directRole)) {
      const content = readMd(directRole) || '';
      const firstLine = content.split('\n').find((l) => l.startsWith('# '));
      agents.push({
        name: firstLine?.replace('# ', '') || dept,
        department: dept,
        role: 'lead',
        status: 'active',
        path: `departments/${dept}/role.md`,
      });
    }

    // Check leads
    const leadsDir = path.join(deptDir, dept, 'leads');
    if (fs.existsSync(leadsDir)) {
      const leads = fs.readdirSync(leadsDir);
      for (const lead of leads) {
        const roleFile = path.join(leadsDir, lead, 'role.md');
        if (fs.existsSync(roleFile)) {
          const content = readMd(roleFile) || '';
          const firstLine = content.split('\n').find((l) => l.startsWith('# '));
          const statusMatch = content.match(/Status:\s*(.+)/i);
          agents.push({
            name: firstLine?.replace('# ', '') || lead,
            department: dept,
            role: 'lead',
            status: statusMatch ? statusMatch[1].trim() : 'Active',
            path: `departments/${dept}/leads/${lead}/role.md`,
          });
        }
      }
    }

    // Check agents
    const agentsDir = path.join(deptDir, dept, 'agents');
    if (fs.existsSync(agentsDir)) {
      const agentDirs = fs.readdirSync(agentsDir);
      for (const agent of agentDirs) {
        const roleFile = path.join(agentsDir, agent, 'role.md');
        if (fs.existsSync(roleFile)) {
          const content = readMd(roleFile) || '';
          const firstLine = content.split('\n').find((l) => l.startsWith('# '));
          const statusMatch = content.match(/Status:\s*(.+)/i);
          agents.push({
            name: firstLine?.replace('# ', '') || agent,
            department: dept,
            role: 'agent',
            status: statusMatch ? statusMatch[1].trim() : 'Active',
            path: `departments/${dept}/agents/${agent}/role.md`,
          });
        }
      }
    }
  }

  res.json(agents);
});

// Taskboard
router.get('/tasks', (_req, res) => {
  const boardMd = readMd(path.join(STUDIO_ROOT, 'taskboard', 'BOARD.md'));
  const categories = ['backlog', 'in-progress', 'review', 'done'];
  const taskFiles: Record<string, string[]> = {};

  for (const cat of categories) {
    const dir = path.join(STUDIO_ROOT, 'taskboard', cat);
    if (fs.existsSync(dir)) {
      taskFiles[cat] = fs.readdirSync(dir).filter((f) => f.endsWith('.md'));
    } else {
      taskFiles[cat] = [];
    }
  }

  res.json({
    board: boardMd,
    categories: taskFiles,
  });
});

// Project info
router.get('/projects', (_req, res) => {
  const gdd = readMd(path.join(DOCS_ROOT, 'game-design', 'thirdlife-gdd.md'));
  const architecture = readMd(path.join(DOCS_ROOT, 'technical', 'architecture.md'));

  res.json({
    current: {
      name: 'ThirdLife',
      phase: 'Phase 1 — Multiplayer Core',
      gdd,
      architecture,
      clientUrl: 'http://localhost:3000',
    },
  });
});

// Health check for processes
router.get('/health', (_req, res) => {
  res.json({
    server: { status: 'running', port: process.env.PORT || 2567, uptime: process.uptime() },
    timestamp: new Date().toISOString(),
  });
});

// Department info
router.get('/departments', (_req, res) => {
  const deptDir = path.join(STUDIO_ROOT, 'departments');
  if (!fs.existsSync(deptDir)) return res.json([]);

  const departments = fs.readdirSync(deptDir);
  const result = departments.map((dept) => {
    const deptMd = readMd(path.join(deptDir, dept, 'department.md'));
    return {
      name: dept,
      doc: deptMd,
    };
  });

  res.json(result);
});

export default router;
