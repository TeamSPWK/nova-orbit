// Nova Orbit — Shared Type Definitions

// ─── Project ───────────────────────────────────────────

export type ProjectSource = "new" | "local_import" | "github";
export type ProjectStatus = "active" | "archived" | "paused";

export interface Project {
  id: string;
  name: string;
  mission: string;
  source: ProjectSource;
  workdir: string;
  github?: GitHubConfig;
  techStack?: TechStack;
  status: ProjectStatus;
  createdAt: string;
  updatedAt: string;
}

export interface GitHubConfig {
  repoUrl: string;
  branch: string;
  autoPush: boolean;
  prMode: boolean;
}

export interface TechStack {
  languages: string[];
  frameworks: string[];
  buildTool?: string;
  testFramework?: string;
  packageManager?: string;
}

// ─── Agent ─────────────────────────────────────────────

export type AgentRole =
  | "coder"
  | "reviewer"
  | "marketer"
  | "designer"
  | "qa"
  | "custom";

export type SessionStatus =
  | "idle"
  | "working"
  | "waiting_approval"
  | "paused"
  | "terminated";

export interface Agent {
  id: string;
  projectId: string;
  name: string;
  role: AgentRole;
  status: SessionStatus;
  systemPrompt: string;
  currentTaskId: string | null;
  createdAt: string;
}

export interface AgentConfig {
  name: string;
  role: AgentRole;
  systemPrompt: string;
  workdir: string;
  skillsDir?: string;
  sessionBehavior: "resume-or-new" | "new";
}

// ─── Goal & Task ───────────────────────────────────────

export type Priority = "critical" | "high" | "medium" | "low";
export type TaskStatus =
  | "todo"
  | "in_progress"
  | "in_review"
  | "done"
  | "blocked";

export interface Goal {
  id: string;
  projectId: string;
  description: string;
  priority: Priority;
  progress: number; // 0-100
  createdAt: string;
}

export interface Task {
  id: string;
  goalId: string;
  projectId: string;
  title: string;
  description: string;
  assigneeId: string | null;
  status: TaskStatus;
  verificationId: string | null;
  createdAt: string;
  updatedAt: string;
}

// ─── Quality Gate (ported from Nova) ───────────────────

export type VerificationScope = "lite" | "standard" | "full";
export type Severity = "auto-resolve" | "soft-block" | "hard-block";
export type Verdict = "pass" | "conditional" | "fail";

export interface Score {
  value: number; // 0-10
  notes: string;
}

export interface VerificationResult {
  id: string;
  taskId: string;
  verdict: Verdict;
  scope: VerificationScope;
  dimensions: {
    functionality: Score;
    dataFlow: Score;
    designAlignment: Score;
    craft: Score;
    edgeCases: Score;
  };
  issues: VerificationIssue[];
  severity: Severity;
  evaluatorSessionId: string;
  createdAt: string;
}

export interface VerificationIssue {
  id: string;
  severity: "critical" | "high" | "warning" | "info";
  file?: string;
  line?: number;
  message: string;
  suggestion?: string;
}

// ─── WebSocket Events ──────────────────────────────────

export type WSEventType =
  | "agent:status"
  | "agent:output"
  | "task:updated"
  | "verification:result"
  | "project:updated";

export interface WSEvent {
  type: WSEventType;
  projectId: string;
  payload: unknown;
  timestamp: string;
}
