import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { analyzeProject } from '../core/project/analyzer.js';

const createdDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'nova-orbit-test-'));
  createdDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of createdDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('analyzeProject — TypeScript + React project', () => {
  it('detects TypeScript language', () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, 'package.json'), JSON.stringify({
      dependencies: { react: '^18.0.0' },
      devDependencies: { typescript: '^5.0.0' },
    }));
    writeFileSync(join(dir, 'tsconfig.json'), '{}');

    const result = analyzeProject(dir);
    expect(result.techStack.languages).toContain('TypeScript');
  });

  it('detects React framework', () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, 'package.json'), JSON.stringify({
      dependencies: { react: '^18.0.0' },
      devDependencies: { typescript: '^5.0.0' },
    }));

    const result = analyzeProject(dir);
    expect(result.techStack.frameworks).toContain('React');
  });

  it('detects npm as package manager (no lock files)', () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, 'package.json'), JSON.stringify({
      dependencies: { react: '^18.0.0' },
    }));

    const result = analyzeProject(dir);
    expect(result.techStack.packageManager).toBe('npm');
  });

  it('detects vitest as test framework', () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, 'package.json'), JSON.stringify({
      devDependencies: { vitest: '^1.0.0' },
    }));

    const result = analyzeProject(dir);
    expect(result.techStack.testFramework).toBe('Vitest');
  });

  it('suggests Frontend Dev + Reviewer + QA for React + TypeScript with tests', () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, 'package.json'), JSON.stringify({
      dependencies: { react: '^18.0.0', express: '^4.0.0' },
      devDependencies: { typescript: '^5.0.0', vitest: '^1.0.0' },
    }));

    const result = analyzeProject(dir);
    const roles = result.suggestedAgents.map((a) => a.role);
    expect(roles).toContain('coder');
    expect(roles).toContain('reviewer');
    expect(roles).toContain('qa');
  });

  it('always includes at least one coder and one reviewer', () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, 'package.json'), JSON.stringify({
      dependencies: { react: '^18.0.0' },
    }));

    const result = analyzeProject(dir);
    expect(result.suggestedAgents.some((a) => a.role === 'coder')).toBe(true);
    expect(result.suggestedAgents.some((a) => a.role === 'reviewer')).toBe(true);
  });
});

describe('analyzeProject — empty directory', () => {
  it('returns empty languages and frameworks', () => {
    const dir = makeTempDir();

    const result = analyzeProject(dir);
    expect(result.techStack.languages).toHaveLength(0);
    expect(result.techStack.frameworks).toHaveLength(0);
  });

  it('still suggests at least one agent', () => {
    const dir = makeTempDir();

    const result = analyzeProject(dir);
    expect(result.suggestedAgents.length).toBeGreaterThan(0);
  });

  it('has undefined packageManager', () => {
    const dir = makeTempDir();

    const result = analyzeProject(dir);
    expect(result.techStack.packageManager).toBeUndefined();
  });
});

describe('analyzeProject — nonexistent directory', () => {
  it('throws an error', () => {
    expect(() => analyzeProject('/tmp/no-such-dir-nova-orbit-xyz')).toThrow(
      /Directory not found/,
    );
  });
});

describe('analyzeProject — suggested agents based on tech stack', () => {
  it('suggests separate frontend/backend coders for fullstack project', () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, 'package.json'), JSON.stringify({
      dependencies: { react: '^18.0.0', express: '^4.0.0' },
    }));

    const result = analyzeProject(dir);
    const coders = result.suggestedAgents.filter((a) => a.role === 'coder');
    expect(coders.length).toBe(2);
    expect(coders.some((a) => a.name === 'Frontend Dev')).toBe(true);
    expect(coders.some((a) => a.name === 'Backend Dev')).toBe(true);
  });

  it('suggests single Developer for backend-only project', () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, 'package.json'), JSON.stringify({
      dependencies: { express: '^4.0.0' },
    }));

    const result = analyzeProject(dir);
    const coders = result.suggestedAgents.filter((a) => a.role === 'coder');
    expect(coders.length).toBe(1);
    expect(coders[0].name).toBe('Developer');
  });

  it('detects test directory and sets testFramework to "detected"', () => {
    const dir = makeTempDir();
    mkdirSync(join(dir, 'tests'));
    // no package.json with test framework

    const result = analyzeProject(dir);
    expect(result.techStack.testFramework).toBe('detected');
  });

  it('does not suggest QA agent when no test framework', () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, 'package.json'), JSON.stringify({
      dependencies: { react: '^18.0.0' },
    }));
    // no test framework in deps, no tests/ directory

    const result = analyzeProject(dir);
    expect(result.suggestedAgents.some((a) => a.role === 'qa')).toBe(false);
  });
});
