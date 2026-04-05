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

    // Tool use — most interesting
    if (obj.type === "tool_use" || obj.tool_use) {
      const toolName = obj.name ?? obj.tool_use?.name ?? obj.tool ?? "";
      const input = obj.input ?? obj.tool_use?.input ?? {};
      const labelFn = TOOL_LABELS[toolName];
      const detail = labelFn ? labelFn(input) : "";
      return {
        type: "tool",
        message: detail ? `${toolName} ${detail}` : toolName,
      };
    }

    // Assistant text (thinking/writing)
    if (obj.type === "assistant" && obj.message?.content) {
      for (const block of obj.message.content) {
        if (block.type === "text" && block.text) {
          const snippet = block.text.trim().split("\n")[0]?.slice(0, 80);
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
        return { type: "text", message: text.trim().split("\n")[0]?.slice(0, 80) };
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
