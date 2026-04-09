import { describe, it, expect } from "vitest";
import { recoverTasksFromPartialJson } from "../core/orchestration/engine.js";

/**
 * Regression tests for the balanced-brace JSON recovery used when the
 * Claude decomposer truncates its response mid-output. The previous
 * regex-based recovery silently broke the moment the task object schema
 * grew new fields (`target_files`, `stack_hint`) — tasks were never
 * recovered and the whole goal stayed at 0/0.
 */
describe("recoverTasksFromPartialJson", () => {
  it("returns empty when input is empty", () => {
    expect(recoverTasksFromPartialJson("")).toEqual([]);
  });

  it("recovers complete array from a well-formed response", () => {
    const raw = `{
  "tasks": [
    {"title": "A", "order": 1},
    {"title": "B", "order": 2}
  ]
}`;
    const tasks = recoverTasksFromPartialJson(raw);
    expect(tasks).toHaveLength(2);
    expect(tasks[0]).toEqual({ title: "A", order: 1 });
    expect(tasks[1]).toEqual({ title: "B", order: 2 });
  });

  it("recovers tasks with nested arrays (target_files)", () => {
    const raw = `{
  "tasks": [
    {
      "title": "Task 1",
      "target_files": ["web/src/app/page.tsx", "api/routes/stats.py"],
      "stack_hint": "Next.js 16",
      "order": 1
    },
    {
      "title": "Task 2",
      "target_files": [],
      "order": 2
    }
  ]
}`;
    const tasks = recoverTasksFromPartialJson(raw);
    expect(tasks).toHaveLength(2);
    expect(tasks[0].target_files).toEqual([
      "web/src/app/page.tsx",
      "api/routes/stats.py",
    ]);
    expect(tasks[1].title).toBe("Task 2");
  });

  it("recovers only complete tasks when response is truncated mid-object", () => {
    // Third task is cut off mid-string — first two must still be recovered
    const raw = `{
  "tasks": [
    {"title": "First", "order": 1, "target_files": ["a.ts"]},
    {"title": "Second", "order": 2, "target_files": ["b.ts"]},
    {"title": "Third", "order": 3, "target_files": ["c`;
    const tasks = recoverTasksFromPartialJson(raw);
    expect(tasks).toHaveLength(2);
    expect(tasks[0].title).toBe("First");
    expect(tasks[1].title).toBe("Second");
  });

  it("survives escaped quotes inside task description", () => {
    const raw = `{
  "tasks": [
    {"title": "Add \\"hello\\" banner", "description": "quoted \\"text\\"", "order": 1}
  ]
}`;
    const tasks = recoverTasksFromPartialJson(raw);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toBe('Add "hello" banner');
  });

  it("handles braces inside string values without miscounting depth", () => {
    const raw = `{
  "tasks": [
    {"title": "T", "description": "body with { and } chars", "order": 1}
  ]
}`;
    const tasks = recoverTasksFromPartialJson(raw);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].description).toContain("{ and }");
  });

  it("handles nested objects (schema field in description)", () => {
    const raw = `{
  "tasks": [
    {
      "title": "API",
      "schema_meta": {"fields": {"id": "string", "count": "number"}},
      "order": 1
    }
  ]
}`;
    const tasks = recoverTasksFromPartialJson(raw);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].schema_meta.fields.id).toBe("string");
  });

  it("returns empty if no tasks array is present", () => {
    expect(
      recoverTasksFromPartialJson(`{"result": "ok"}`),
    ).toEqual([]);
  });

  it("skips a single malformed object but keeps surrounding valid ones", () => {
    // Middle object has an unquoted key — JSON.parse fails on it, but
    // depth-tracking still identifies the boundaries correctly
    const raw = `{
  "tasks": [
    {"title": "Good 1", "order": 1},
    {bad: "skipme", "order": 2},
    {"title": "Good 2", "order": 3}
  ]
}`;
    const tasks = recoverTasksFromPartialJson(raw);
    // The "bad" object is skipped; both good ones are recovered
    expect(tasks.map((t) => t.title).filter(Boolean)).toEqual(["Good 1", "Good 2"]);
  });

  it("handles the production failure mode — truncated mid-stack_hint", () => {
    // Precise simulation of the Pulsar 13:53 failure: big `target_files`
    // array followed by a long `stack_hint` that got cut off.
    const raw = `{
  "tasks": [
    {
      "title": "Ghost API client",
      "description": "Implement Ghost Admin API wrapper",
      "role": "platform-dev",
      "priority": "high",
      "order": 1,
      "target_files": ["shared/ghost/client.py", "shared/ghost/__init__.py"],
      "stack_hint": "Python httpx + pydantic"
    },
    {
      "title": "Wire _fetch_channel_metrics",
      "description": "Replace placeholder 0 returns with real Ghost API calls. The implementation must handle missing API keys gracefully and return a structured error shape of {source: \\"error\\", reason: str`;
    const tasks = recoverTasksFromPartialJson(raw);
    // Only the first task is complete; the second is truncated inside a
    // string. Recovery should return exactly one task.
    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toBe("Ghost API client");
    expect(tasks[0].target_files).toHaveLength(2);
    expect(tasks[0].stack_hint).toBe("Python httpx + pydantic");
  });
});
