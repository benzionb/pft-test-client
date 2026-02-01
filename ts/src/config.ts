import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { encryptMnemonic, decryptMnemonic } from "./crypto.js";

export type CliConfig = {
  jwt?: string;
  baseUrl?: string;
  contextText?: string;
  timeoutMs?: number;
  mnemonic?: string;
  mnemonicEncrypted?: boolean;
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
  if (typeof obj.mnemonic === "string" && obj.mnemonic.length > 0) {
    config.mnemonic = obj.mnemonic;
  }
  if (typeof obj.mnemonicEncrypted === "boolean") {
    config.mnemonicEncrypted = obj.mnemonicEncrypted;
  }
  return config;
}

export function loadConfig(): CliConfig {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, "utf8");
    return normalizeConfig(JSON.parse(raw));
  } catch (err) {
    // Only warn for errors other than missing file (expected on first use)
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      process.stderr.write(`Warning: unable to load config: ${String(err)}\n`);
    }
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

/**
 * Store mnemonic in config file.
 * If password provided, encrypt the mnemonic before storing.
 * If no password, store plaintext.
 */
export function setMnemonic(mnemonic: string, password?: string): void {
  const current = loadConfig();
  if (password) {
    current.mnemonic = encryptMnemonic(mnemonic, password);
    current.mnemonicEncrypted = true;
  } else {
    current.mnemonic = mnemonic;
    current.mnemonicEncrypted = false;
  }
  saveConfig(current);
}

/**
 * Resolve mnemonic from env var or config file.
 * Checks PFT_WALLET_MNEMONIC env var first, then config file.
 * If config mnemonic is encrypted, password is required to decrypt.
 * Returns undefined if not found or decryption fails.
 */
export function resolveMnemonic(password?: string): string | undefined {
  // Check env var first
  const fromEnv = process.env.PFT_WALLET_MNEMONIC;
  if (fromEnv && fromEnv.trim().length > 0) {
    return fromEnv.trim();
  }

  // Check config file
  const config = loadConfig();
  if (!config.mnemonic) {
    return undefined;
  }

  // If encrypted, require password to decrypt
  if (config.mnemonicEncrypted) {
    if (!password) {
      return undefined;
    }
    try {
      return decryptMnemonic(config.mnemonic, password);
    } catch {
      return undefined;
    }
  }

  // Return plaintext mnemonic
  return config.mnemonic;
}

/**
 * Check if mnemonic exists (in env var or config file).
 */
export function hasMnemonic(): boolean {
  const fromEnv = process.env.PFT_WALLET_MNEMONIC;
  if (fromEnv && fromEnv.trim().length > 0) {
    return true;
  }
  const config = loadConfig();
  return typeof config.mnemonic === "string" && config.mnemonic.length > 0;
}

/**
 * Check if the stored mnemonic (in config file) is encrypted.
 * Returns false if mnemonic is from env var or not encrypted.
 */
export function isMnemonicEncrypted(): boolean {
  // Env var mnemonic is never encrypted
  const fromEnv = process.env.PFT_WALLET_MNEMONIC;
  if (fromEnv && fromEnv.trim().length > 0) {
    return false;
  }
  const config = loadConfig();
  return config.mnemonicEncrypted === true;
}
