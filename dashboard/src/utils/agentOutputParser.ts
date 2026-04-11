/**
 * Parse Claude Code stream-json output into human-readable activity messages.
 * Converts raw JSON lines into meaningful descriptions of what the agent is doing.
 */

const TOOL_LABELS: Record<string, (input: any) => string> = {
  Read:       (i) => `${shorten(i?.file_path ?? i?.path ?? "")}`,
  Edit:       (i) => `${shorten(i?.file_path ?? "")}`,
  Write:      (i) => `${shorten(i?.file_path ?? "")}`,
  Bash:       (i) => `${shorten(i?.command ?? i?.description ?? "", 60)}`,
  Grep:       (i) => `"${shorten(i?.pattern ?? "", 30)}" ${i?.path ? `in ${shorten(i.path)}` : ""}`,
  Glob:       (i) => `${shorten(i?.pattern ?? "")}`,
  Agent:      (i) => `${shorten(i?.description ?? i?.prompt?.slice(0, 40) ?? "", 40)}`,
  WebSearch:  (i) => `"${shorten(i?.query ?? "", 40)}"`,
  WebFetch:   (i) => `${shorten(i?.url ?? "", 50)}`,
};

function shorten(s: string, max = 45): string {
  if (!s) return "";
  const clean = s.replace(/^\/Users\/[^/]+\//, "~/").replace(/\n.*/s, "");
  return clean.length > max ? clean.slice(0, max - 1) + "…" : clean;
}

const TOOL_PREFIXES: Record<string, string> = {
  Read:      "파일 읽기",
  Edit:      "파일 수정",
  Write:     "파일 수정",
  MultiEdit: "파일 수정",
  Bash:      "명령 실행",
  Grep:      "검색",
  Glob:      "검색",
  Agent:     "서브에이전트",
  WebSearch: "웹 검색",
  WebFetch:  "웹 요청",
};

function buildToolActivity(toolName: string, input: any): AgentActivity {
  const labelFn = TOOL_LABELS[toolName];
  const detail = labelFn ? labelFn(input) : "";
  const prefix = TOOL_PREFIXES[toolName];
  if (prefix && detail) {
    return { type: "tool", message: `[${prefix}] ${detail}` };
  }
  if (prefix) {
    return { type: "tool", message: `[${prefix}]` };
  }
  // Fallback: show tool name as-is (unknown tools)
  return { type: "tool", message: detail ? `[${toolName}] ${detail}` : `[${toolName}]` };
}

export interface AgentActivity {
  type: "tool" | "thinking" | "text" | "error" | "result";
  message: string;
}

/**
 * Parse a raw stream-json chunk and extract a human-readable activity.
 * Returns null if the chunk is not interesting (system events, etc).
 */
export function parseAgentOutput(raw: string): AgentActivity | null {
  // stream-json: one JSON per line
  const lines = raw.split("\n").filter((l) => l.trim());

  for (const line of lines) {
    let obj: any;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }

    // Tool use — most interesting (top-level tool_use event)
    if (obj.type === "tool_use" || obj.tool_use) {
      const toolName = obj.name ?? obj.tool_use?.name ?? obj.tool ?? "";
      const input = obj.input ?? obj.tool_use?.input ?? {};
      return buildToolActivity(toolName, input);
    }

    // Assistant message — may contain tool_use blocks or text blocks
    if (obj.type === "assistant" && obj.message?.content) {
      for (const block of obj.message.content) {
        // tool_use block inside assistant message (Claude Code stream-json format)
        if (block.type === "tool_use") {
          const toolName = block.name ?? "";
          const input = block.input ?? {};
          return buildToolActivity(toolName, input);
        }
      }
      // No tool_use block — extract text
      for (const block of obj.message.content) {
        if (block.type === "text" && block.text) {
          const snippet = block.text.trim().split("\n").slice(0, 3).join(" ").slice(0, 300);
          if (snippet) {
            return { type: "thinking", message: snippet };
          }
        }
      }
    }

    // Content block with text
    if (obj.type === "content_block_delta" || obj.type === "content_block_start") {
      const text = obj.delta?.text ?? obj.content_block?.text ?? "";
      if (text.trim()) {
        return { type: "text", message: text.trim().split("\n").slice(0, 3).join(" ").slice(0, 300) };
      }
    }

    // Result — final
    if (obj.type === "result") {
      const cost = obj.cost_usd ?? obj.usage?.totalCostUsd;
      const costStr = cost ? ` ($${cost.toFixed(3)})` : "";
      return { type: "result", message: `완료${costStr}` };
    }
  }

  return null;
}
