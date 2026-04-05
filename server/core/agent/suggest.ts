import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createLogger } from "../../utils/logger.js";
import { getPreset } from "./roles.js";
import { analyzeProject } from "../project/analyzer.js";

const log = createLogger("agent-suggest");

export interface SuggestedAgent {
  name: string;
  role: string;
  systemPrompt: string;
  reason: string;
  source: "project-agents" | "tech-stack" | "preset";
}

/**
 * Smart team suggestion — 2-layer:
 *
 * 1. .claude/agents/*.md 가 있으면 → 그대로 사용. 파일 = 에이전트.
 *    role 추론은 best-effort. 매칭 안 되면 "custom" — 문제 없음.
 *    CLAUDE.md 내용은 각 에이전트 시스템 프롬프트 앞에 컨텍스트로 주입.
 *
 * 2. .claude/agents/ 없으면 → package.json 분석 + 프리셋 기반 기본 팀.
 *    이 경우만 하드코딩 허용 (기본값이니까).
 *
 * reviewer/qa가 하나도 없으면 마지막에 추가 (Quality Gate 필수).
 */
export function suggestFromProject(
  workdir: string,
  mission?: string,
): SuggestedAgent[] {
  // ─── Layer 1: .claude/agents/*.md → 파일이 곧 에이전트 ────────────────
  const projectAgents = loadProjectAgents(workdir);

  if (projectAgents.length > 0) {
    // CLAUDE.md를 읽어서 각 에이전트에 프로젝트 컨텍스트 주입
    const claudeMd = loadClaudeMd(workdir);
    const contextPrefix = claudeMd
      ? `[Project Context from CLAUDE.md]\n${claudeMd.slice(0, 2000)}\n\n---\n\n`
      : "";

    const agents: SuggestedAgent[] = projectAgents.map((pa) => ({
      name: pa.name,
      role: pa.role,
      systemPrompt: contextPrefix + pa.systemPrompt,
      reason: `.claude/agents/${pa.file}`,
      source: "project-agents" as const,
    }));

    // Quality Gate: reviewer 계열이 없으면 추가
    const hasReviewer = agents.some((a) =>
      a.role === "reviewer" || a.role === "qa" || a.name.toLowerCase().includes("review") || a.name.toLowerCase().includes("qa"),
    );
    if (!hasReviewer) {
      const preset = getPreset("reviewer");
      agents.push({
        name: preset?.name ?? "Code Reviewer",
        role: "reviewer",
        systemPrompt: contextPrefix + (preset?.systemPrompt ?? ""),
        reason: "Quality Gate 필수 (자동 추가)",
        source: "preset",
      });
    }

    log.info(`Loaded ${agents.length} agents from .claude/agents/`, {
      agents: agents.map((a) => `${a.name}(${a.role})`),
    });

    return agents;
  }

  // ─── Layer 2: 프로젝트에 에이전트 정의 없음 → 분석 기반 기본 팀 ──────
  return buildDefaultTeam(workdir, mission);
}

/**
 * .claude/agents/ 없을 때: package.json 분석 + 프리셋 기반 기본 팀 생성
 */
function buildDefaultTeam(workdir: string, mission?: string): SuggestedAgent[] {
  const agents: SuggestedAgent[] = [];
  const seen = new Set<string>();

  const add = (role: string, reason: string, customPrompt?: string) => {
    if (seen.has(role)) return;
    seen.add(role);
    const preset = getPreset(role);
    agents.push({
      name: preset?.name ?? role,
      role,
      systemPrompt: customPrompt ?? preset?.systemPrompt ?? "",
      reason,
      source: customPrompt ? "tech-stack" : "preset",
    });
  };

  try {
    const { techStack } = analyzeProject(workdir);

    const hasFrontend = techStack.frameworks.some((f) =>
      ["React", "Vue", "Svelte", "Next.js"].includes(f),
    );
    const hasBackend = techStack.frameworks.some((f) =>
      ["Express", "Fastify", "NestJS", "Django", "FastAPI", "Flask", "Spring Boot", "Gin", "Echo"].includes(f),
    );

    if (hasFrontend && hasBackend) {
      add("cto", `Full-stack (${techStack.languages.join(", ")})`);
    }
    if (hasBackend || (!hasFrontend && !hasBackend)) {
      add("backend", techStack.frameworks.filter((f) => !["React", "Vue", "Svelte", "Next.js", "TailwindCSS"].includes(f)).join(", ") || techStack.languages.join(", "));
    }
    if (hasFrontend) {
      add("frontend", techStack.frameworks.filter((f) => ["React", "Vue", "Svelte", "Next.js"].includes(f)).join(", "));
    }
    if (techStack.testFramework) {
      add("qa", `${techStack.testFramework} 감지`);
    }
  } catch {
    // Fallback: 분석 실패 시 최소 팀
    add("backend", "기본 구현 에이전트");
    add("frontend", "기본 구현 에이전트");
  }

  add("reviewer", "Quality Gate 필수");

  log.info(`Built default team (${agents.length} agents) for: "${workdir}"`);
  return agents;
}

// ─── Helpers ──────────────────────────────────────────────────────────────

interface ProjectAgentDef {
  name: string;
  role: string;
  systemPrompt: string;
  file: string;
}

/** Read .claude/agents/*.md — parse frontmatter + body as-is */
function loadProjectAgents(workdir: string): ProjectAgentDef[] {
  const agentsDir = join(workdir, ".claude", "agents");
  if (!existsSync(agentsDir)) return [];

  let files: string[];
  try {
    files = readdirSync(agentsDir).filter((f) => f.endsWith(".md"));
  } catch {
    return [];
  }

  const results: ProjectAgentDef[] = [];
  for (const file of files) {
    try {
      const content = readFileSync(join(agentsDir, file), "utf-8");
      if (!content.trim()) continue;

      const parsed = parseFrontmatter(content);
      const name = parsed.meta.name ?? file.replace(/\.md$/, "");

      // role: best-effort from Nova Orbit preset roles. "custom" is fine.
      const role = inferRole(name, parsed.meta.description ?? "", parsed.body);

      results.push({ name, role, systemPrompt: parsed.body.trim(), file });
    } catch {
      continue;
    }
  }

  return results;
}

function parseFrontmatter(content: string): { meta: Record<string, string>; body: string } {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
  if (!match) return { meta: {}, body: content };

  const meta: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const kv = line.match(/^(\w+)\s*:\s*(.+)/);
    if (kv) meta[kv[1]] = kv[2].trim();
  }
  return { meta, body: match[2] };
}

/**
 * Best-effort role inference — for UI display only, NOT for behavior.
 * Returns "custom" if no confident match. That's perfectly fine.
 */
function inferRole(name: string, description: string, _body: string): string {
  // Only use name + description (short, intentional text).
  // Body is too noisy (mentions "api", "server", "test" in all contexts).
  const text = `${name} ${description}`.toLowerCase();

  const SIGNALS: Array<{ test: (t: string) => boolean; role: string }> = [
    { test: (t) => /\bcto\b|tech lead|architect/.test(t), role: "cto" },
    { test: (t) => /\bbackend\b|api[\s-]dev|\bapi\b.*개발|route handler/.test(t), role: "backend" },
    { test: (t) => /\bfrontend\b|프론트엔드|\bui\b.*개발|\breact\b.*ui/.test(t), role: "frontend" },
    { test: (t) => /\bux\b|\bdesign\b|디자인/.test(t), role: "ux" },
    { test: (t) => /\bqa\b|\breview|검증|품질/.test(t), role: "reviewer" },
    { test: (t) => /\bdevops\b|\bdeploy|인프라|ci\/cd/.test(t), role: "devops" },
    { test: (t) => /\bmarket|seo|growth|마케팅/.test(t), role: "marketer" },
  ];

  for (const { test, role } of SIGNALS) {
    if (test(text)) return role;
  }

  return "custom";
}

function loadClaudeMd(workdir: string): string | null {
  for (const path of [join(workdir, "CLAUDE.md"), join(workdir, ".claude", "CLAUDE.md")]) {
    try {
      if (existsSync(path)) return readFileSync(path, "utf-8");
    } catch { /* skip */ }
  }
  return null;
}

/**
 * Legacy: keyword-only suggestion (used when workdir unavailable).
 */
export function suggestAgentsFromMission(
  mission: string,
  _techStack?: { languages?: string[]; frameworks?: string[] },
): SuggestedAgent[] {
  const agents: SuggestedAgent[] = [];
  const seen = new Set<string>();

  const add = (role: string, reason: string) => {
    if (seen.has(role)) return;
    seen.add(role);
    const preset = getPreset(role);
    agents.push({
      name: preset?.name ?? role,
      role,
      systemPrompt: preset?.systemPrompt ?? "",
      reason,
      source: "preset",
    });
  };

  add("backend", "기본 구현 에이전트");
  add("frontend", "기본 구현 에이전트");
  add("reviewer", "Quality Gate 필수");

  log.info(`Keyword-only suggestion (${agents.length} agents)`);
  return agents;
}

// ─── Team Presets (unchanged) ─────────────────────────────────────────────

export interface TeamPreset {
  id: string;
  name: string;
  description: string;
  agents: Array<{ name: string; role: string; parentRole?: string }>;
}

export function getTeamPresets(): TeamPreset[] {
  return [
    {
      id: "minimal",
      name: "Minimal",
      description: "Backend + Frontend + Reviewer",
      agents: [
        { name: "Backend Developer", role: "backend" },
        { name: "Frontend Developer", role: "frontend" },
        { name: "Code Reviewer", role: "reviewer" },
      ],
    },
    {
      id: "fullstack",
      name: "Full Stack Team",
      description: "CTO → Backend + Frontend + QA",
      agents: [
        { name: "CTO", role: "cto" },
        { name: "Backend Developer", role: "backend", parentRole: "cto" },
        { name: "Frontend Developer", role: "frontend", parentRole: "cto" },
        { name: "QA Engineer", role: "qa", parentRole: "cto" },
      ],
    },
    {
      id: "product",
      name: "Product Team",
      description: "CTO → Frontend + UX + QA",
      agents: [
        { name: "CTO", role: "cto" },
        { name: "Frontend Developer", role: "frontend", parentRole: "cto" },
        { name: "UX Designer", role: "ux", parentRole: "cto" },
        { name: "QA Engineer", role: "qa", parentRole: "cto" },
      ],
    },
    {
      id: "startup",
      name: "Startup Team",
      description: "CTO → Backend + Frontend + UX + QA + Reviewer",
      agents: [
        { name: "CTO", role: "cto" },
        { name: "Backend Developer", role: "backend", parentRole: "cto" },
        { name: "Frontend Developer", role: "frontend", parentRole: "cto" },
        { name: "UX Designer", role: "ux", parentRole: "cto" },
        { name: "QA Engineer", role: "qa", parentRole: "cto" },
        { name: "Code Reviewer", role: "reviewer", parentRole: "cto" },
      ],
    },
  ];
}
