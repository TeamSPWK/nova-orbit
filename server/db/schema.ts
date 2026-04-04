import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";

export function createDatabase(dbPath: string): Database.Database {
  const db = new Database(dbPath);

  // Enable WAL mode for better concurrent read performance
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  return db;
}

export function migrate(db: Database.Database): void {
  db.exec(`
    -- Projects
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
      name TEXT NOT NULL,
      mission TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL CHECK (source IN ('new', 'local_import', 'github')),
      workdir TEXT NOT NULL DEFAULT '',
      github_config TEXT, -- JSON: { repoUrl, branch, autoPush, prMode }
      tech_stack TEXT,    -- JSON: { languages, frameworks, buildTool, ... }
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived', 'paused')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Agents
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('coder', 'reviewer', 'marketer', 'designer', 'qa', 'custom')),
      status TEXT NOT NULL DEFAULT 'idle' CHECK (status IN ('idle', 'working', 'waiting_approval', 'paused', 'terminated')),
      system_prompt TEXT NOT NULL DEFAULT '',
      skills_dir TEXT,
      session_behavior TEXT NOT NULL DEFAULT 'resume-or-new',
      current_task_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Goals
    CREATE TABLE IF NOT EXISTS goals (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      description TEXT NOT NULL,
      priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('critical', 'high', 'medium', 'low')),
      progress INTEGER NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Tasks
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
      goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      assignee_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
      status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'in_progress', 'in_review', 'done', 'blocked')),
      verification_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Verification Logs (Nova Quality Gate results)
    CREATE TABLE IF NOT EXISTS verifications (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      verdict TEXT NOT NULL CHECK (verdict IN ('pass', 'conditional', 'fail')),
      scope TEXT NOT NULL DEFAULT 'standard' CHECK (scope IN ('lite', 'standard', 'full')),
      dimensions TEXT NOT NULL DEFAULT '{}', -- JSON: { functionality, dataFlow, ... }
      issues TEXT NOT NULL DEFAULT '[]',     -- JSON array of issues
      severity TEXT NOT NULL DEFAULT 'auto-resolve' CHECK (severity IN ('auto-resolve', 'soft-block', 'hard-block')),
      evaluator_session_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Agent Sessions (Claude Code CLI process tracking)
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
      agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      pid INTEGER,          -- OS process ID
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      ended_at TEXT,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'failed', 'killed')),
      token_usage INTEGER DEFAULT 0,
      last_output TEXT      -- Last output snippet for display
    );

    -- Activity Log (timeline feed)
    CREATE TABLE IF NOT EXISTS activities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
      type TEXT NOT NULL, -- 'task_started', 'task_completed', 'verification_pass', 'verification_fail', etc.
      message TEXT NOT NULL,
      metadata TEXT,     -- JSON
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Indexes
    CREATE INDEX IF NOT EXISTS idx_agents_project ON agents(project_id);
    CREATE INDEX IF NOT EXISTS idx_goals_project ON goals(project_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_goal ON tasks(goal_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks(assignee_id);
    CREATE INDEX IF NOT EXISTS idx_verifications_task ON verifications(task_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_agent ON sessions(agent_id);
    CREATE INDEX IF NOT EXISTS idx_activities_project ON activities(project_id);
  `);
}

export function generateId(): string {
  return randomUUID().replace(/-/g, "").slice(0, 16);
}
