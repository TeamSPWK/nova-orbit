import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import type { RequestHandler } from "express";
import { createLogger } from "../../utils/logger.js";

const log = createLogger("auth");

export function loadOrCreateApiKey(dataDir: string): string {
  const keyPath = join(dataDir, "api-key");
  if (existsSync(keyPath)) {
    const key = readFileSync(keyPath, "utf-8").trim();
    if (key) {
      log.info("API key loaded from file");
      return key;
    }
    log.warn("API key file is empty — regenerating");
  }
  const key = randomBytes(32).toString("hex");
  writeFileSync(keyPath, key, { mode: 0o600 });
  log.info("New API key generated and saved");
  return key;
}

export function authMiddleware(apiKey: string, dataDir: string): RequestHandler {
  const keyIssuedPath = join(dataDir, ".key-issued");

  return (req, res, next) => {
    // 정적 파일, health check 제외
    if (!req.path.startsWith("/api/") || req.path === "/api/health") {
      return next();
    }

    // 대시보드 초기 키 전달 엔드포인트 — localhost에서만 허용, 최초 1회만 발급
    if (req.path === "/api/auth/key" && req.query.init === "true") {
      // 이미 발급된 경우 비활성화
      if (existsSync(keyIssuedPath)) {
        return res.status(403).json({ error: "Forbidden" });
      }
      const ip = req.ip || req.socket.remoteAddress;
      if (ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1") {
        try {
          writeFileSync(keyIssuedPath, new Date().toISOString(), { mode: 0o600 });
        } catch (err: any) {
          log.warn(`Could not write key-issued flag: ${err?.message ?? err}`);
        }
        return res.json({ key: apiKey });
      }
      return res.status(403).json({ error: "Forbidden" });
    }

    const token = req.headers.authorization?.replace("Bearer ", "");
    if (token !== apiKey) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    next();
  };
}
