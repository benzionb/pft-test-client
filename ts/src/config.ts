import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type CliConfig = {
  jwt?: string;
  baseUrl?: string;
  contextText?: string;
};

const CONFIG_DIR = path.join(os.homedir(), ".pft-tasknode");
const CONFIG_PATH = path.join(CONFIG_DIR, "config.json");

export function loadConfig(): CliConfig {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, "utf8");
    return JSON.parse(raw) as CliConfig;
  } catch {
    return {};
  }
}

export function saveConfig(config: CliConfig): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
  try {
    fs.chmodSync(CONFIG_PATH, 0o600);
  } catch {
    // Best-effort permissions.
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
