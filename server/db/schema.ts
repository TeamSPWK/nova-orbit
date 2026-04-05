import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";

export function createDatabase(dbPath: string): Database.Database {
  const db = new Database(dbPath);

  // Enable WAL mode for better concurrent read performance
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");

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
      autopilot TEXT NOT NULL DEFAULT 'off' CHECK (autopilot IN ('off', 'goal', 'full')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Agents
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('coder', 'reviewer', 'marketer', 'designer', 'qa', 'custom', 'cto', 'backend', 'frontend', 'ux', 'devops')),
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
      parent_task_id TEXT REFERENCES tasks(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'pending_approval', 'in_progress', 'in_review', 'done', 'blocked')),
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
      cost_usd REAL DEFAULT 0,
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

  // Incremental migrations for existing databases

  // prompt_source 컬럼 추가 (기존 DB 호환)
  const agentColumnsEarly = db.prepare("PRAGMA table_info(agents)").all() as { name: string }[];
  const hasPromptSource = agentColumnsEarly.some((c) => c.name === "prompt_source");
  if (!hasPromptSource) {
    db.exec("ALTER TABLE agents ADD COLUMN prompt_source TEXT NOT NULL DEFAULT 'auto'");
  }

  const sessionColumns = db.prepare("PRAGMA table_info(sessions)").all() as { name: string }[];
  const hasTokenUsage = sessionColumns.some((c) => c.name === "token_usage");
  const hasCostUsd = sessionColumns.some((c) => c.name === "cost_usd");

  if (!hasTokenUsage) {
    db.exec("ALTER TABLE sessions ADD COLUMN token_usage INTEGER DEFAULT 0");
  }
  if (!hasCostUsd) {
    db.exec("ALTER TABLE sessions ADD COLUMN cost_usd REAL DEFAULT 0");
  }

  // Agent hierarchy: parent_id + expanded roles
  // SQLite cannot ALTER CHECK constraints, so we recreate the table if needed
  const agentColumns = db.prepare("PRAGMA table_info(agents)").all() as { name: string }[];
  const hasParentId = agentColumns.some((c) => c.name === "parent_id");

  if (!hasParentId) {
    // Recreate agents table with expanded role CHECK + parent_id + prompt_source
    db.exec("DROP TABLE IF EXISTS agents_new");
    db.exec(`
      CREATE TABLE agents_new (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('coder', 'reviewer', 'marketer', 'designer', 'qa', 'custom', 'cto', 'backend', 'frontend', 'ux', 'devops')),
        status TEXT NOT NULL DEFAULT 'idle' CHECK (status IN ('idle', 'working', 'waiting_approval', 'paused', 'terminated')),
        system_prompt TEXT NOT NULL DEFAULT '',
        prompt_source TEXT NOT NULL DEFAULT 'auto',
        skills_dir TEXT,
        session_behavior TEXT NOT NULL DEFAULT 'resume-or-new',
        current_task_id TEXT,
        parent_id TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO agents_new (id, project_id, name, role, status, system_prompt, prompt_source, skills_dir, session_behavior, current_task_id, created_at)
        SELECT id, project_id, name, role, status, COALESCE(system_prompt, ''), 'auto', skills_dir, COALESCE(session_behavior, 'resume-or-new'), current_task_id, COALESCE(created_at, datetime('now')) FROM agents;
      DROP TABLE agents;
      ALTER TABLE agents_new RENAME TO agents;
      CREATE INDEX IF NOT EXISTS idx_agents_project ON agents(project_id);
    `);
  } else {
    // parent_id exists but CHECK might still be old — test by inserting a dummy
    let needsAgentsRecreate = false;
    try {
      db.pragma("foreign_keys = OFF");
      db.exec("INSERT INTO agents (project_id, name, role) VALUES ('__check__', '__check__', 'cto')");
      db.exec("DELETE FROM agents WHERE project_id = '__check__'");
    } catch {
      needsAgentsRecreate = true;
    } finally {
      db.pragma("foreign_keys = ON");
    }
    if (needsAgentsRecreate) {
      // CHECK failed — recreate
      db.exec("DROP TABLE IF EXISTS agents_new");
      db.exec(`
        CREATE TABLE agents_new (
          id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
          project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          role TEXT NOT NULL CHECK (role IN ('coder', 'reviewer', 'marketer', 'designer', 'qa', 'custom', 'cto', 'backend', 'frontend', 'ux', 'devops')),
          status TEXT NOT NULL DEFAULT 'idle' CHECK (status IN ('idle', 'working', 'waiting_approval', 'paused', 'terminated')),
          system_prompt TEXT NOT NULL DEFAULT '',
          prompt_source TEXT NOT NULL DEFAULT 'auto',
          skills_dir TEXT,
          session_behavior TEXT NOT NULL DEFAULT 'resume-or-new',
          current_task_id TEXT,
          parent_id TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        INSERT INTO agents_new (id, project_id, name, role, status, system_prompt, prompt_source, skills_dir, session_behavior, current_task_id, parent_id, created_at)
          SELECT id, project_id, name, role, status, COALESCE(system_prompt, ''), COALESCE(prompt_source, 'auto'), skills_dir, COALESCE(session_behavior, 'resume-or-new'), current_task_id, parent_id, COALESCE(created_at, datetime('now')) FROM agents;
        DROP TABLE agents;
        ALTER TABLE agents_new RENAME TO agents;
        CREATE INDEX IF NOT EXISTS idx_agents_project ON agents(project_id);
      `);
    }
  }

  // Autopilot column on projects (off | goal | full)
  const projectColumns = db.prepare("PRAGMA table_info(projects)").all() as { name: string }[];
  if (!projectColumns.some((c) => c.name === "autopilot")) {
    db.exec("ALTER TABLE projects ADD COLUMN autopilot TEXT NOT NULL DEFAULT 'off'");
  }

  // parent_task_id on tasks (for hierarchical delegation subtasks)
  const taskColumns = db.prepare("PRAGMA table_info(tasks)").all() as { name: string }[];
  if (!taskColumns.some((c) => c.name === "parent_task_id")) {
    db.exec("ALTER TABLE tasks ADD COLUMN parent_task_id TEXT REFERENCES tasks(id) ON DELETE CASCADE");
  }

  // started_at on tasks (Sprint 2: crash recovery)
  if (!taskColumns.some((c) => c.name === "started_at")) {
    db.exec("ALTER TABLE tasks ADD COLUMN started_at TEXT");
  }

  // result_summary on tasks (Sprint 6: context chain, added here early)
  if (!taskColumns.some((c) => c.name === "result_summary")) {
    db.exec("ALTER TABLE tasks ADD COLUMN result_summary TEXT");
  }

  // retry_count + reassign_count on tasks (auto-retry blocked tasks)
  if (!taskColumns.some((c) => c.name === "retry_count")) {
    db.exec("ALTER TABLE tasks ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0");
  }
  if (!taskColumns.some((c) => c.name === "reassign_count")) {
    db.exec("ALTER TABLE tasks ADD COLUMN reassign_count INTEGER NOT NULL DEFAULT 0");
  }

  // pending_approval status on tasks (Sprint 5: Trust UX)
  // SQLite cannot ALTER CHECK constraints — test with FK disabled to avoid false positive
  let needsTasksRecreate = false;
  try {
    db.pragma("foreign_keys = OFF");
    db.exec("INSERT INTO tasks (goal_id, project_id, title, status) VALUES ('__check__', '__check__', '__check__', 'pending_approval')");
    db.exec("DELETE FROM tasks WHERE goal_id = '__check__'");
  } catch {
    needsTasksRecreate = true;
  } finally {
    db.pragma("foreign_keys = ON");
  }

  if (needsTasksRecreate) {
    // CHECK failed — recreate tasks table with expanded status values
    // FK must be OFF during data migration to avoid self-reference violations
    // Wrapped in try/finally to guarantee FK is re-enabled even on crash
    try {
      db.pragma("foreign_keys = OFF");
      db.exec("DROP TABLE IF EXISTS tasks_new");
      db.exec(`
        CREATE TABLE tasks_new (
          id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
          goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
          project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          title TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          assignee_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
          parent_task_id TEXT,
          status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'pending_approval', 'in_progress', 'in_review', 'done', 'blocked')),
          verification_id TEXT,
          started_at TEXT,
          result_summary TEXT,
          retry_count INTEGER NOT NULL DEFAULT 0,
          reassign_count INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        INSERT INTO tasks_new (id, goal_id, project_id, title, description, assignee_id, parent_task_id, status, verification_id, started_at, result_summary, retry_count, reassign_count, created_at, updated_at)
          SELECT id, goal_id, project_id, title, COALESCE(description, ''), assignee_id, parent_task_id,
                 COALESCE(status, 'todo'), verification_id, started_at, result_summary, 0, 0,
                 COALESCE(created_at, datetime('now')), COALESCE(updated_at, datetime('now'))
          FROM tasks;
        DROP TABLE tasks;
        ALTER TABLE tasks_new RENAME TO tasks;
        CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
        CREATE INDEX IF NOT EXISTS idx_tasks_goal ON tasks(goal_id);
        CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks(assignee_id);
      `);
    } finally {
      db.pragma("foreign_keys = ON");
    }
  }

  // Composite index for session context chain queries (Sprint 6)
  db.exec("CREATE INDEX IF NOT EXISTS idx_tasks_assignee_done ON tasks(assignee_id, status, updated_at DESC)");

}

export function generateId(): string {
  return randomUUID().replace(/-/g, "").slice(0, 16);
}
