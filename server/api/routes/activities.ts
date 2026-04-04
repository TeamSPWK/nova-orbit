import { Router } from "express";
import type { AppContext } from "../../index.js";

export function createActivityRoutes(ctx: AppContext): Router {
  const router = Router();
  const { db } = ctx;

  // GET /api/activities?projectId=xxx
  router.get("/", (req, res) => {
    const projectId = typeof req.query.projectId === "string" ? req.query.projectId : undefined;

    if (!projectId) {
      return res.status(400).json({ error: "projectId query param required" });
    }

    const activities = db
      .prepare(
        `SELECT * FROM activities
         WHERE project_id = ?
         ORDER BY created_at DESC
         LIMIT 50`,
      )
      .all(projectId);

    res.json(activities);
  });

  return router;
}
