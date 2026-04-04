import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { TechStack, AgentRole } from "../../../shared/types.js";
import { createLogger } from "../../utils/logger.js";

const log = createLogger("project-analyzer");

interface AnalysisResult {
  techStack: TechStack;
  suggestedAgents: Array<{ name: string; role: AgentRole; reason: string }>;
}

/**
 * Analyze a local directory to detect tech stack and suggest agents.
 */
export function analyzeProject(dirPath: string): AnalysisResult {
  if (!existsSync(dirPath)) {
    throw new Error(`Directory not found: ${dirPath}`);
  }

  const techStack: TechStack = {
    languages: [],
    frameworks: [],
    buildTool: undefined,
    testFramework: undefined,
    packageManager: undefined,
  };

  const files = listTopLevelFiles(dirPath);

  // Node.js / TypeScript / JavaScript
  if (files.includes("package.json")) {
    const pkg = readJsonSafe(join(dirPath, "package.json"));
    techStack.packageManager = files.includes("pnpm-lock.yaml")
      ? "pnpm"
      : files.includes("yarn.lock")
        ? "yarn"
        : "npm";

    const allDeps = {
      ...(pkg.dependencies ?? {}),
      ...(pkg.devDependencies ?? {}),
    };

    if (allDeps.typescript || files.includes("tsconfig.json")) {
      techStack.languages.push("TypeScript");
    } else {
      techStack.languages.push("JavaScript");
    }

    // Frameworks
    if (allDeps.next) techStack.frameworks.push("Next.js");
    if (allDeps.react) techStack.frameworks.push("React");
    if (allDeps.vue) techStack.frameworks.push("Vue");
    if (allDeps.svelte) techStack.frameworks.push("Svelte");
    if (allDeps.express) techStack.frameworks.push("Express");
    if (allDeps.fastify) techStack.frameworks.push("Fastify");
    if (allDeps["@nestjs/core"]) techStack.frameworks.push("NestJS");
    if (allDeps.tailwindcss) techStack.frameworks.push("TailwindCSS");

    // Build tools
    if (allDeps.vite) techStack.buildTool = "Vite";
    else if (allDeps.webpack) techStack.buildTool = "Webpack";
    else if (allDeps.tsup) techStack.buildTool = "tsup";

    // Test frameworks
    if (allDeps.vitest) techStack.testFramework = "Vitest";
    else if (allDeps.jest) techStack.testFramework = "Jest";
    else if (allDeps.mocha) techStack.testFramework = "Mocha";
  }

  // Python
  if (files.includes("requirements.txt") || files.includes("pyproject.toml") || files.includes("setup.py")) {
    techStack.languages.push("Python");
    if (files.includes("pyproject.toml")) {
      const content = readFileSafe(join(dirPath, "pyproject.toml"));
      if (content.includes("django")) techStack.frameworks.push("Django");
      if (content.includes("fastapi")) techStack.frameworks.push("FastAPI");
      if (content.includes("flask")) techStack.frameworks.push("Flask");
      if (content.includes("pytest")) techStack.testFramework = "pytest";
    }
    techStack.packageManager = files.includes("poetry.lock") ? "Poetry" : "pip";
  }

  // Java / Kotlin
  if (files.includes("build.gradle") || files.includes("build.gradle.kts") || files.includes("pom.xml")) {
    if (files.includes("build.gradle.kts")) {
      techStack.languages.push("Kotlin");
    } else {
      techStack.languages.push("Java");
    }
    techStack.buildTool = files.includes("pom.xml") ? "Maven" : "Gradle";
    const content = readFileSafe(
      join(dirPath, files.includes("pom.xml") ? "pom.xml" : "build.gradle"),
    );
    if (content.includes("spring")) techStack.frameworks.push("Spring Boot");
  }

  // Go
  if (files.includes("go.mod")) {
    techStack.languages.push("Go");
    const content = readFileSafe(join(dirPath, "go.mod"));
    if (content.includes("gin")) techStack.frameworks.push("Gin");
    if (content.includes("echo")) techStack.frameworks.push("Echo");
  }

  // Rust
  if (files.includes("Cargo.toml")) {
    techStack.languages.push("Rust");
    techStack.buildTool = "Cargo";
  }

  // Directory structure hints
  const dirs = listSubDirs(dirPath);
  if (dirs.includes("src") || dirs.includes("lib")) {
    // Standard project structure
  }
  if (dirs.includes("tests") || dirs.includes("test") || dirs.includes("__tests__")) {
    if (!techStack.testFramework) techStack.testFramework = "detected";
  }

  // Suggest agents based on tech stack
  const suggestedAgents = suggestAgents(techStack, dirs);

  log.info("Analysis complete", { techStack, agents: suggestedAgents.length });
  return { techStack, suggestedAgents };
}

function suggestAgents(
  techStack: TechStack,
  dirs: string[],
): Array<{ name: string; role: AgentRole; reason: string }> {
  const agents: Array<{ name: string; role: AgentRole; reason: string }> = [];

  const hasFrontend = techStack.frameworks.some((f) =>
    ["React", "Vue", "Svelte", "Next.js"].includes(f),
  );
  const hasBackend = techStack.frameworks.some((f) =>
    ["Express", "Fastify", "NestJS", "Django", "FastAPI", "Flask", "Spring Boot", "Gin"].includes(f),
  );

  if (hasFrontend && hasBackend) {
    agents.push({ name: "Frontend Dev", role: "coder", reason: `${techStack.frameworks.filter((f) => ["React", "Vue", "Svelte", "Next.js"].includes(f)).join("/")} detected` });
    agents.push({ name: "Backend Dev", role: "coder", reason: `${techStack.frameworks.filter((f) => !["React", "Vue", "Svelte", "Next.js", "TailwindCSS"].includes(f)).join("/")} detected` });
  } else {
    agents.push({ name: "Developer", role: "coder", reason: `${techStack.languages.join("/")} project` });
  }

  // Always suggest a reviewer
  agents.push({ name: "Reviewer", role: "reviewer", reason: "Quality Gate verification" });

  // QA if tests exist
  if (techStack.testFramework) {
    agents.push({ name: "QA Engineer", role: "qa", reason: `${techStack.testFramework} tests detected` });
  }

  return agents;
}

function listTopLevelFiles(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isFile())
      .map((d) => d.name);
  } catch {
    return [];
  }
}

function listSubDirs(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith(".") && d.name !== "node_modules")
      .map((d) => d.name);
  } catch {
    return [];
  }
}

function readJsonSafe(path: string): any {
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return {};
  }
}

function readFileSafe(path: string): string {
  try {
    return readFileSync(path, "utf-8");
  } catch {
    return "";
  }
}
