import fs from "node:fs/promises";
import path from "node:path";

const MAX_FILE_BYTES = 10 * 1024 * 1024;

export type EvidenceUploadOptions = {
  verificationType: string;
  artifact: string;
  artifactJson?: string;
  filePath?: string;
  x25519Pubkey?: string;
};

function requireNonEmpty(value: string | undefined, label: string): string {
  if (!value || value.trim().length === 0) {
    throw new Error(`${label} is required`);
  }
  return value;
}

function ensureWebApis() {
  if (typeof fetch !== "function") {
    throw new Error("Global fetch is not available. Use Node.js 18+.");
  }
  if (typeof FormData === "undefined") {
    throw new Error("FormData is not available. Use Node.js 18+.");
  }
}

export class TaskNodeApi {
  private jwt: string;
  private baseUrl: string;

  constructor(jwt: string, baseUrl = "https://tasknode.postfiat.org") {
    if (!jwt) throw new Error("JWT is required (set PFT_TASKNODE_JWT or use auth set-token).");
    ensureWebApis();
    try {
      this.baseUrl = new URL(baseUrl).toString();
    } catch (err) {
      throw new Error(`Invalid base URL: ${String(err)}`);
    }
    this.jwt = jwt;
  }

  private async requestJson<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = new URL(path, this.baseUrl).toString();
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.jwt}`,
      Accept: "application/json",
    };
    if (body !== undefined) headers["Content-Type"] = "application/json";

    const res = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      const text = await res.text();
      const snippet = text.length > 2000 ? `${text.slice(0, 2000)}...<truncated>` : text;
      throw new Error(`HTTP ${res.status} ${res.statusText}: ${snippet}`);
    }
    return (await res.json()) as T;
  }

  private async requestForm<T>(path: string, form: FormData): Promise<T> {
    const url = new URL(path, this.baseUrl).toString();
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.jwt}`,
        Accept: "application/json",
      },
      body: form,
    });

    if (!res.ok) {
      const text = await res.text();
      const snippet = text.length > 2000 ? `${text.slice(0, 2000)}...<truncated>` : text;
      throw new Error(`HTTP ${res.status} ${res.statusText}: ${snippet}`);
    }
    return (await res.json()) as T;
  }

  async getAccountSummary() {
    return this.requestJson("GET", "/api/account/summary");
  }

  async getTasksSummary() {
    return this.requestJson("GET", "/api/tasks/summary");
  }

  async getTask(taskId: string) {
    return this.requestJson("GET", `/api/tasks/${taskId}`);
  }

  async acceptTask(taskId: string) {
    return this.requestJson("POST", `/api/tasks/${taskId}/accept`);
  }

  async listChat(limit = 10) {
    return this.requestJson("GET", `/api/chat/messages?limit=${limit}`);
  }

  async sendChat(content: string, contextText: string, chatType = "chat") {
    return this.requestJson("POST", "/api/chat/messages", {
      content,
      chat_type: chatType,
      context_text: contextText,
    });
  }

  async uploadEvidence(taskId: string, options: EvidenceUploadOptions) {
    const form = new FormData();
    const verificationType = requireNonEmpty(options.verificationType, "verification_type");
    form.set("verification_type", verificationType);
    if (options.x25519Pubkey) {
      form.set("x25519_pubkey", options.x25519Pubkey);
    }

    if (options.filePath) {
      if (typeof Blob === "undefined") {
        throw new Error("Blob is not available. Use Node.js 18+ for file uploads.");
      }
      const filePath = requireNonEmpty(options.filePath, "filePath");
      let stats;
      try {
        stats = await fs.stat(filePath);
      } catch (err) {
        throw new Error(`Unable to read file: ${String(err)}`);
      }
      if (!stats.isFile()) {
        throw new Error("filePath must point to a file.");
      }
      if (stats.size > MAX_FILE_BYTES) {
        throw new Error(`File exceeds size limit (${MAX_FILE_BYTES} bytes).`);
      }
      const buffer = await fs.readFile(filePath);
      const filename = path.basename(filePath);
      form.set("artifact", new Blob([buffer]), filename);
    } else if (options.artifactJson) {
      form.set("artifact", requireNonEmpty(options.artifactJson, "artifactJson"));
    } else {
      form.set("artifact", requireNonEmpty(options.artifact, "artifact"));
    }

    return this.requestForm(`/api/tasks/${taskId}/evidence`, form);
  }

  async submitEvidence(taskId: string, payload: { cid: string; tx_hash: string; artifact_type: string; evidence_id: string }) {
    return this.requestJson("POST", `/api/tasks/${taskId}/submit`, payload);
  }

  async respondVerification(taskId: string, verificationType: string, responseText: string) {
    const form = new FormData();
    form.set("verification_type", requireNonEmpty(verificationType, "verification_type"));
    form.set("response", requireNonEmpty(responseText, "response"));
    return this.requestForm(`/api/tasks/${taskId}/verification/respond`, form);
  }

  async submitVerification(taskId: string, payload: { cid: string; tx_hash: string; artifact_type: string; evidence_id: string }) {
    return this.requestJson("POST", `/api/tasks/${taskId}/verification/submit`, payload);
  }

  async preparePointer(payload: { cid: string; task_id: string; kind?: string; schema?: number; flags?: number }) {
    requireNonEmpty(payload.cid, "cid");
    requireNonEmpty(payload.task_id, "task_id");
    return this.requestJson("POST", "/api/pointers/prepare", {
      cid: payload.cid,
      task_id: payload.task_id,
      kind: payload.kind || "TASK_SUBMISSION",
      schema: payload.schema ?? 1,
      flags: payload.flags ?? 1,
    });
  }
}
