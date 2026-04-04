import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { createLogger } from "../../utils/logger.js";

const log = createLogger("agent-roles");

export interface AgentPreset {
  name: string;
  role: string;
  description: string;
  systemPrompt: string;
  capabilities: string[];
  verificationLevel: "standard" | "full";
}

// Resolve templates/agents/ relative to this file's location at runtime.
// __dirname is unavailable in ESM; derive it from import.meta.url instead.
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const TEMPLATES_DIR = join(__dirname, "../../../templates/agents");

let _cache: Map<string, AgentPreset> | null = null;

function loadPresets(): Map<string, AgentPreset> {
  if (_cache) return _cache;

  const map = new Map<string, AgentPreset>();

  let files: string[];
  try {
    files = readdirSync(TEMPLATES_DIR).filter((f) => f.endsWith(".yaml"));
  } catch (err) {
    log.warn(`Could not read templates dir ${TEMPLATES_DIR}: ${err}`);
    return map;
  }

  for (const file of files) {
    try {
      const raw = readFileSync(join(TEMPLATES_DIR, file), "utf-8");
      const preset = parse(raw) as AgentPreset;

      if (!preset.role || !preset.systemPrompt) {
        log.warn(`Skipping ${file}: missing required fields (role, systemPrompt)`);
        continue;
      }

      map.set(preset.role, preset);
      log.info(`Loaded preset: ${preset.role} (${file})`);
    } catch (err) {
      log.warn(`Failed to parse ${file}: ${err}`);
    }
  }

  _cache = map;
  return map;
}

/** Returns all available agent presets loaded from templates/agents/*.yaml */
export function getAgentPresets(): AgentPreset[] {
  return Array.from(loadPresets().values());
}

/** Returns the preset for a given role, or undefined if not found */
export function getPreset(role: string): AgentPreset | undefined {
  return loadPresets().get(role);
}
