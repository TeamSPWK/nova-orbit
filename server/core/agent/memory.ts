import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const MAX_MEMORY_SIZE = 50 * 1024; // 50KB

function sanitizeAgentId(agentId: string): string {
  return agentId.replace(/[^a-zA-Z0-9_-]/g, "");
}

export function getMemoryPath(dataDir: string, agentId: string): string {
  const safe = sanitizeAgentId(agentId);
  if (!safe) throw new Error("Invalid agentId for memory path");
  const memoryDir = join(dataDir, "memory");
  mkdirSync(memoryDir, { recursive: true });
  return join(memoryDir, `${safe}.md`);
}

export function loadMemory(dataDir: string, agentId: string): string {
  const filePath = getMemoryPath(dataDir, agentId);
  if (!existsSync(filePath)) return "";

  const content = readFileSync(filePath, "utf-8");
  if (content.length <= MAX_MEMORY_SIZE) return content;

  // 50KB 초과 시 뒤에서 잘라냄 (최근 내용 유지)
  return content.slice(content.length - MAX_MEMORY_SIZE);
}

export function appendMemory(dataDir: string, agentId: string, entry: string): void {
  const filePath = getMemoryPath(dataDir, agentId);
  const existing = existsSync(filePath) ? readFileSync(filePath, "utf-8") : "";
  const timestamp = new Date().toISOString();
  const appended = existing + `\n\n---\n${timestamp}\n${entry}`;

  // 50KB 초과 시 앞 잘라냄 (최근 내용 유지)
  const final = appended.length > MAX_MEMORY_SIZE
    ? appended.slice(appended.length - MAX_MEMORY_SIZE)
    : appended;

  writeFileSync(filePath, final, "utf-8");
}
