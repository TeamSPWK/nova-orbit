import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, statSync } from "node:fs";
import { join } from "node:path";

const MAX_MEMORY_SIZE = 3 * 1024; // 3KB — keeps system prompt lean

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
  const timestamp = new Date().toISOString();
  const newContent = `\n\n---\n${timestamp}\n${entry}`;

  // Use appendFileSync for atomic append (no read-modify-write race)
  appendFileSync(filePath, newContent, "utf-8");

  // Trim if over size limit (separate step — occasional, not every write)
  try {
    const size = statSync(filePath).size;
    if (size > MAX_MEMORY_SIZE) {
      const full = readFileSync(filePath, "utf-8");
      writeFileSync(filePath, full.slice(full.length - MAX_MEMORY_SIZE), "utf-8");
    }
  } catch { /* trim failure is non-critical */ }
}
