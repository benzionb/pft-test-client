/**
 * Pending submissions storage for recovery from failed transactions.
 * Stores CID and evidence_id locally so we can resume if the on-chain tx fails.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type PendingSubmission = {
  task_id: string;
  type: "evidence" | "verification_response";
  cid: string;
  evidence_id: string;
  artifact_type: string;
  created_at: string;
};

const PENDING_DIR = path.join(os.homedir(), ".pft-tasknode", "pending");

function getPendingPath(taskId: string, type: "evidence" | "verification_response"): string {
  return path.join(PENDING_DIR, `${taskId}-${type}.json`);
}

export function savePending(submission: PendingSubmission): void {
  fs.mkdirSync(PENDING_DIR, { recursive: true });
  const filePath = getPendingPath(submission.task_id, submission.type);
  fs.writeFileSync(filePath, JSON.stringify(submission, null, 2));
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // Ignore permission errors on some systems
  }
}

export function loadPending(taskId: string, type: "evidence" | "verification_response"): PendingSubmission | null {
  const filePath = getPendingPath(taskId, type);
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw) as PendingSubmission;
  } catch {
    return null;
  }
}

export function clearPending(taskId: string, type: "evidence" | "verification_response"): void {
  const filePath = getPendingPath(taskId, type);
  try {
    fs.unlinkSync(filePath);
  } catch {
    // Ignore if file doesn't exist
  }
}

export function listPending(): PendingSubmission[] {
  try {
    const files = fs.readdirSync(PENDING_DIR);
    return files
      .filter(f => f.endsWith(".json"))
      .map(f => {
        try {
          const raw = fs.readFileSync(path.join(PENDING_DIR, f), "utf8");
          return JSON.parse(raw) as PendingSubmission;
        } catch {
          return null;
        }
      })
      .filter((s): s is PendingSubmission => s !== null);
  } catch {
    return [];
  }
}
