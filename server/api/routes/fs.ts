import { Router } from "express";
import { readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";

export function createFsRoutes(): Router {
  const router = Router();

  // GET /api/fs/browse?path=/some/dir
  router.get("/browse", (req, res) => {
    const rawPath = typeof req.query.path === "string" ? req.query.path : homedir();
    const target = rawPath.startsWith("~") ? rawPath.replace("~", homedir()) : resolve(rawPath);

    try {
      const stat = statSync(target);
      if (!stat.isDirectory()) {
        return res.status(400).json({ error: "Not a directory" });
      }
    } catch {
      return res.status(404).json({ error: "Path not found" });
    }

    try {
      const entries = readdirSync(target, { withFileTypes: true });
      const dirs = entries
        .filter((e) => e.isDirectory() && !e.name.startsWith("."))
        .map((e) => e.name)
        .sort((a, b) => a.localeCompare(b));

      // Check if it's a git repo (has .git directory)
      const isGitRepo = entries.some((e) => e.name === ".git" && e.isDirectory());

      return res.json({ path: target, dirs, isGitRepo });
    } catch {
      return res.status(403).json({ error: "Permission denied" });
    }
  });

  return router;
}
