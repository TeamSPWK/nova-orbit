import { describe, it, expect } from 'vitest';
import { parseStreamJson } from '../core/agent/adapters/stream-parser.js';

describe('parseStreamJson — valid stream-json output', () => {
  it('extracts assistant text from message content', () => {
    const line = JSON.stringify({
      type: 'assistant',
      session_id: 'sess-abc',
      message: {
        content: [
          { type: 'text', text: 'Hello, ' },
          { type: 'text', text: 'world!' },
        ],
      },
    });

    const result = parseStreamJson(line);
    expect(result.text).toBe('Hello, world!');
  });

  it('counts lines correctly', () => {
    const lines = [
      JSON.stringify({ type: 'system', session_id: 's1' }),
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'hi' }] } }),
      JSON.stringify({ type: 'result', result: 'done' }),
    ].join('\n');

    const result = parseStreamJson(lines);
    expect(result.lineCount).toBe(3);
  });

  it('result type overrides intermediate assistant text', () => {
    const lines = [
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'interim' }] } }),
      JSON.stringify({ type: 'result', result: 'final answer' }),
    ].join('\n');

    const result = parseStreamJson(lines);
    expect(result.text).toBe('final answer');
  });

  it('collects multiple tool uses', () => {
    const lines = [
      JSON.stringify({ type: 'tool_use', name: 'read_file', input: { path: '/foo.ts' } }),
      JSON.stringify({ type: 'tool_use', name: 'write_file', input: { path: '/bar.ts', content: 'x' } }),
    ].join('\n');

    const result = parseStreamJson(lines);
    expect(result.toolUses).toHaveLength(2);
    expect(result.toolUses[0].name).toBe('read_file');
    expect(result.toolUses[1].name).toBe('write_file');
  });

  it('collects error messages', () => {
    const line = JSON.stringify({ type: 'error', message: 'Rate limit exceeded' });

    const result = parseStreamJson(line);
    expect(result.errors).toContain('Rate limit exceeded');
  });
});

describe('parseStreamJson — empty string', () => {
  it('returns empty/null fields', () => {
    const result = parseStreamJson('');
    expect(result.text).toBe('');
    expect(result.sessionId).toBeNull();
    expect(result.lineCount).toBe(0);
    expect(result.toolUses).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });
});

describe('parseStreamJson — session ID extraction', () => {
  it('extracts session_id from first line that has it', () => {
    const lines = [
      JSON.stringify({ type: 'system', session_id: 'ses-001' }),
      JSON.stringify({ type: 'assistant', session_id: 'ses-002', message: { content: [] } }),
    ].join('\n');

    const result = parseStreamJson(lines);
    expect(result.sessionId).toBe('ses-001');
  });

  it('returns null when no session_id present', () => {
    const line = JSON.stringify({ type: 'assistant', message: { content: [] } });

    const result = parseStreamJson(line);
    expect(result.sessionId).toBeNull();
  });

  it('handles session_id in any event type', () => {
    const line = JSON.stringify({ type: 'result', session_id: 'ses-xyz', result: 'ok' });

    const result = parseStreamJson(line);
    expect(result.sessionId).toBe('ses-xyz');
  });
});

describe('parseStreamJson — error extraction', () => {
  it('falls back to error field when message is missing', () => {
    const line = JSON.stringify({ type: 'error', error: 'Connection timeout' });

    const result = parseStreamJson(line);
    expect(result.errors).toContain('Connection timeout');
  });

  it('uses "Unknown error" when neither message nor error field is present', () => {
    const line = JSON.stringify({ type: 'error' });

    const result = parseStreamJson(line);
    expect(result.errors).toContain('Unknown error');
  });

  it('collects multiple errors across lines', () => {
    const lines = [
      JSON.stringify({ type: 'error', message: 'Error one' }),
      JSON.stringify({ type: 'error', message: 'Error two' }),
    ].join('\n');

    const result = parseStreamJson(lines);
    expect(result.errors).toHaveLength(2);
  });
});

describe('parseStreamJson — robustness', () => {
  it('skips non-JSON lines without throwing', () => {
    const mixed = [
      'not json at all',
      JSON.stringify({ type: 'result', result: 'ok' }),
      '{ broken json',
    ].join('\n');

    expect(() => parseStreamJson(mixed)).not.toThrow();
    const result = parseStreamJson(mixed);
    expect(result.text).toBe('ok');
  });

  it('handles subtype tool_use field', () => {
    const line = JSON.stringify({ subtype: 'tool_use', tool_name: 'bash', tool_input: { cmd: 'ls' } });

    const result = parseStreamJson(line);
    expect(result.toolUses).toHaveLength(1);
    expect(result.toolUses[0].name).toBe('bash');
  });
});
