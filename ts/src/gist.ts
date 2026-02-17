import path from "node:path";
import { spawnSync } from "node:child_process";

const FALSE_VALUES = new Set(["0", "false", "no", "off"]);

export function isSecretGistPreferred(): boolean {
  const raw = process.env.PFT_EVIDENCE_PREFER_SECRET_GIST;
  if (!raw) return true;
  return !FALSE_VALUES.has(raw.trim().toLowerCase());
}

export function createSecretGistFromFile(filePath: string, description?: string): string {
  const gistDescription = (description && description.trim().length > 0)
    ? description.trim()
    : `PFT evidence: ${path.basename(filePath)}`;

  const result = spawnSync("gh", ["gist", "create", filePath, "-d", gistDescription], {
    encoding: "utf8",
  });

  if (result.error) {
    throw new Error(`Failed to execute gh gist create: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const stderr = result.stderr?.trim();
    throw new Error(`gh gist create failed${stderr ? `: ${stderr}` : ""}`);
  }

  const stdout = result.stdout?.trim() || "";
  const url = stdout.split(/\s+/)[0];
  if (!url || !url.startsWith("https://gist.github.com/")) {
    throw new Error(`Unexpected gh gist create output: ${JSON.stringify(stdout)}`);
  }
  return url;
}
