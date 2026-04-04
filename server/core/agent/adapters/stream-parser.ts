/**
 * Parse Claude Code stream-json output to extract useful data.
 *
 * Claude Code with `--output-format stream-json` outputs one JSON object per line:
 * - type: "system" — hooks, session info
 * - type: "assistant" — model responses (message.content[].text)
 * - type: "result" — final result text
 * - type: "tool_use" / "tool_result" — tool calls
 */

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
}

export function parseStreamJson(rawOutput: string): ParsedStreamOutput {
  const result: ParsedStreamOutput = {
    text: "",
    sessionId: null,
    lineCount: 0,
    toolUses: [],
    errors: [],
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

      // Extract final result
      if (parsed.type === "result" && parsed.result) {
        // Result overrides intermediate text if present
        result.text = parsed.result;
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
