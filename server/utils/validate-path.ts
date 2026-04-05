import { resolve } from "node:path";
import { realpathSync, existsSync } from "node:fs";
import { homedir } from "node:os";

export function validateWorkdir(inputPath: string): string {
  if (!inputPath || !inputPath.trim()) {
    throw new Error("Path must not be empty");
  }
  const preliminary = resolve(inputPath);
  const real = existsSync(preliminary) ? realpathSync(preliminary) : preliminary;
  const home = homedir();
  if (!real.startsWith(home) && !real.startsWith("/tmp")) {
    throw new Error("Path must be within home directory or /tmp");
  }
  return real;
}
