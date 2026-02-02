import fs from "node:fs/promises";
import path from "node:path";
import { requireNonEmpty } from "./utils.js";

const MAX_FILE_BYTES = 10 * 1024 * 1024;

export type TaskProposal = {
  id: string;
  title: string;
  description: string;
  status: string;
  pft_offer: string;
  verification: {
    type: string;
    criteria: string;
  };
  steps: Array<{ id: string; done: boolean; text: string }>;
  task_category: string;
  alignment: string;
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
  classification_tag?: string;
  metadata?: {
    task?: TaskProposal;
    odv?: {
      task_generation?: {
        output: string;
      };
    };
  };
};

export type EvidenceUploadOptions = {
  verificationType: string;
  artifact: string;
  artifactJson?: string;
  filePath?: string;
  x25519Pubkey?: string;
};

export type VerificationResponseResult = {
  submission: {
    id: string;
    verification_status: string;
    verification_ask: string;
    verification_response: string;
    verification_responded_at: string | null;
  };
  evidence?: {
    cid: string;
    evidence_id: string;
    image_description?: string | null;
  };
  error?: string;
};

export type VerificationStatus = {
  submission: {
    id: string;
    verification_ask: string;
    verification_status: string;
    verification_response: string | null;
    verification_requested_at: string | null;
    verification_responded_at: string | null;
    verification_tx_hash: string | null;
  };
  debug?: {
    verification_payload?: {
      assessment?: string;
      verification_ask?: string;
      why_this_ask?: string;
      value_to_user?: string;
    };
  };
};

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
  private timeoutMs: number;

  constructor(jwt: string, baseUrl = "https://tasknode.postfiat.org", timeoutMs = 30000) {
    if (!jwt) throw new Error("JWT is required (set PFT_TASKNODE_JWT or use auth:set-token).");
    ensureWebApis();
    try {
      this.baseUrl = new URL(baseUrl).toString();
    } catch (err) {
      throw new Error(`Invalid base URL: ${String(err)}`);
    }
    this.jwt = jwt;
    this.timeoutMs = timeoutMs;
  }

  private async requestJson<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = new URL(path, this.baseUrl).toString();
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.jwt}`,
      Accept: "application/json",
    };
    if (body !== undefined) headers["Content-Type"] = "application/json";

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }

    if (!res.ok) {
      const text = await res.text();
      const snippet = text.length > 2000 ? `${text.slice(0, 2000)}...<truncated>` : text;
      // Provide user-friendly messages for common errors
      if (res.status === 401) {
        throw new Error(`JWT expired or invalid. Get a fresh token from the Task Node and run: pft-cli auth:set-token "<jwt>"\n\nOriginal error: ${snippet}`);
      }
      if (res.status === 403) {
        throw new Error(`Access forbidden. Your JWT may not have permission for this action.\n\nOriginal error: ${snippet}`);
      }
      throw new Error(`HTTP ${res.status} ${res.statusText}: ${snippet}`);
    }
    return (await res.json()) as T;
  }

  private async requestForm<T>(path: string, form: FormData): Promise<T> {
    const url = new URL(path, this.baseUrl).toString();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.jwt}`,
          Accept: "application/json",
        },
        body: form,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }

    if (!res.ok) {
      const text = await res.text();
      const snippet = text.length > 2000 ? `${text.slice(0, 2000)}...<truncated>` : text;
      // Provide user-friendly messages for common errors
      if (res.status === 401) {
        throw new Error(`JWT expired or invalid. Get a fresh token from the Task Node and run: pft-cli auth:set-token "<jwt>"\n\nOriginal error: ${snippet}`);
      }
      if (res.status === 403) {
        throw new Error(`Access forbidden. Your JWT may not have permission for this action.\n\nOriginal error: ${snippet}`);
      }
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

  async sendChat(content: string, contextText: string, chatType = "chat") {
    return this.requestJson("POST", "/api/chat/messages", {
      content,
      chat_type: chatType,
      context_text: contextText,
    });
  }

  async listChat(limit = 10) {
    return this.requestJson<{ messages: ChatMessage[] }>("GET", `/api/chat/messages?limit=${limit}`);
  }

  /**
   * Send a chat message and wait for the assistant response.
   * Polls until an assistant message newer than our sent message appears.
   */
  async sendChatAndWait(
    content: string,
    contextText: string,
    chatType = "chat",
    maxWaitMs = 60000,
    pollIntervalMs = 3000
  ): Promise<{ userMessage: unknown; assistantMessage: ChatMessage | null }> {
    const startTime = Date.now();
    
    // Send the message
    const sendResult = await this.sendChat(content, contextText, chatType);
    const userMessageId = (sendResult as { message?: { id?: string } })?.message?.id;
    const userMessageTime = (sendResult as { message?: { created_at?: string } })?.message?.created_at;
    
    if (!userMessageTime) {
      return { userMessage: sendResult, assistantMessage: null };
    }
    
    // Poll for assistant response
    while (Date.now() - startTime < maxWaitMs) {
      await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
      
      const { messages } = await this.listChat(5);
      
      // Find assistant message newer than our user message
      const assistantMsg = messages.find(
        m => m.role === "assistant" && m.created_at > userMessageTime
      );
      
      if (assistantMsg) {
        return { userMessage: sendResult, assistantMessage: assistantMsg };
      }
    }
    
    return { userMessage: sendResult, assistantMessage: null };
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
      // artifactJson is already a JSON string
      form.set("artifact", requireNonEmpty(options.artifactJson, "artifactJson"));
    } else {
      // For URL/text types, wrap in JSON object with the verification type as key
      const content = requireNonEmpty(options.artifact, "artifact");
      const artifactJson = JSON.stringify({ [verificationType]: content });
      form.set("artifact", artifactJson);
    }

    return this.requestForm(`/api/tasks/${taskId}/evidence`, form);
  }

  async submitEvidence(taskId: string, payload: { cid: string; tx_hash: string; artifact_type: string; evidence_id: string }) {
    return this.requestJson("POST", `/api/tasks/${taskId}/submit`, payload);
  }

  async getVerificationStatus(taskId: string): Promise<VerificationStatus> {
    return this.requestJson<VerificationStatus>("GET", `/api/tasks/${taskId}/verification`);
  }

  async respondVerification(
    taskId: string,
    verificationType: string,
    responseText: string,
    x25519Pubkey?: string
  ): Promise<VerificationResponseResult> {
    const form = new FormData();
    form.set("verification_type", requireNonEmpty(verificationType, "verification_type"));
    form.set("response", requireNonEmpty(responseText, "response"));
    if (x25519Pubkey) {
      form.set("x25519_pubkey", x25519Pubkey);
    }
    return this.requestForm<VerificationResponseResult>(`/api/tasks/${taskId}/verification/respond`, form);
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
