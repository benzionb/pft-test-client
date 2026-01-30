import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type CliConfig = {
  jwt?: string;
  baseUrl?: string;
  contextText?: string;
  timeoutMs?: number;
};

const CONFIG_DIR = path.join(os.homedir(), ".pft-tasknode");
const CONFIG_PATH = path.join(CONFIG_DIR, "config.json");

function normalizeTimeout(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return undefined;
}

function normalizeConfig(raw: unknown): CliConfig {
  if (!raw || typeof raw !== "object") return {};
  const obj = raw as Record<string, unknown>;
  const config: CliConfig = {};
  if (typeof obj.jwt === "string" && obj.jwt.trim().length > 0) config.jwt = obj.jwt.trim();
  if (typeof obj.baseUrl === "string" && obj.baseUrl.trim().length > 0) config.baseUrl = obj.baseUrl.trim();
  if (typeof obj.contextText === "string" && obj.contextText.trim().length > 0) {
    config.contextText = obj.contextText;
  }
  const timeoutMs = normalizeTimeout(obj.timeoutMs);
  if (timeoutMs) config.timeoutMs = timeoutMs;
  return config;
}

export function loadConfig(): CliConfig {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, "utf8");
    return normalizeConfig(JSON.parse(raw));
  } catch (err) {
    process.stderr.write(`Warning: unable to load config: ${String(err)}\n`);
    return {};
  }
}

export function saveConfig(config: CliConfig): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
  try {
    fs.chmodSync(CONFIG_PATH, 0o600);
  } catch (err) {
    process.stderr.write(`Warning: unable to set config permissions (600): ${String(err)}\n`);
  }
}

export function setConfigValue<K extends keyof CliConfig>(key: K, value: CliConfig[K]) {
  const current = loadConfig();
  current[key] = value;
  saveConfig(current);
}

export function resolveJwt(): string | undefined {
  return process.env.PFT_TASKNODE_JWT || loadConfig().jwt;
}

export function resolveBaseUrl(): string {
  return process.env.PFT_TASKNODE_URL || loadConfig().baseUrl || "https://tasknode.postfiat.org";
}

export function resolveContextText(): string | undefined {
  return process.env.PFT_CONTEXT_TEXT || loadConfig().contextText;
}

export function resolveTimeoutMs(): number {
  const fromEnv = process.env.PFT_TASKNODE_TIMEOUT_MS;
  const parsed = normalizeTimeout(fromEnv);
  if (parsed) return parsed;
  return loadConfig().timeoutMs || 30000;
}
