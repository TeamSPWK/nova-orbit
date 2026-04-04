/**
 * Parse Claude Code stream-json output to extract useful data.
 *
 * Claude Code with `--output-format stream-json` outputs one JSON object per line:
 * - type: "system" — hooks, session info
 * - type: "assistant" — model responses (message.content[].text)
 * - type: "result" — final result text + usage + cost
 * - type: "tool_use" / "tool_result" — tool calls
 */

export interface UsageInfo {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  totalCostUsd: number;
  durationMs: number;
  numTurns: number;
}

export interface ParsedStreamOutput {
  /** Extracted text from assistant messages */
  text: string;
  /** Session ID if found */
  sessionId: string | null;
  /** Total raw lines parsed */
  lineCount: number;
  /** Tool uses detected */
  toolUses: Array<{ name: string; input: unknown }>;
  /** Any errors from the stream */
  errors: string[];
  /** Token usage and cost (from result event) */
  usage: UsageInfo | null;
}

export function parseStreamJson(rawOutput: string): ParsedStreamOutput {
  const result: ParsedStreamOutput = {
    text: "",
    sessionId: null,
    lineCount: 0,
    toolUses: [],
    errors: [],
    usage: null,
  };

  const lines = rawOutput.split("\n").filter(Boolean);
  result.lineCount = lines.length;

  for (const line of lines) {
    try {
      const parsed = JSON.parse(line);

      // Extract session ID
      if (parsed.session_id && !result.sessionId) {
        result.sessionId = parsed.session_id;
      }

      // Extract assistant text
      if (parsed.type === "assistant" && parsed.message?.content) {
        for (const block of parsed.message.content) {
          if (block.type === "text") {
            result.text += block.text;
          }
        }
      }

      // Extract final result + usage data
      if (parsed.type === "result") {
        if (parsed.result) {
          result.text = parsed.result;
        }

        // Extract usage from result event
        const u = parsed.usage;
        if (u || parsed.total_cost_usd !== undefined) {
          result.usage = {
            inputTokens: u?.input_tokens ?? 0,
            outputTokens: u?.output_tokens ?? 0,
            cacheReadTokens: u?.cache_read_input_tokens ?? 0,
            cacheCreationTokens: u?.cache_creation_input_tokens ?? 0,
            totalCostUsd: parsed.total_cost_usd ?? 0,
            durationMs: parsed.duration_ms ?? 0,
            numTurns: parsed.num_turns ?? 0,
          };
        }
      }

      // Track tool uses
      if (parsed.type === "tool_use" || parsed.subtype === "tool_use") {
        result.toolUses.push({
          name: parsed.name ?? parsed.tool_name ?? "unknown",
          input: parsed.input ?? parsed.tool_input ?? {},
        });
      }

      // Track errors
      if (parsed.type === "error") {
        result.errors.push(parsed.message ?? parsed.error ?? "Unknown error");
      }
    } catch {
      // Non-JSON line, skip
    }
  }

  return result;
}
