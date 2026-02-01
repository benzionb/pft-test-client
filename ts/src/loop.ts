/**
 * TaskLoopRunner - High-level orchestrator for the complete task lifecycle.
 * 
 * Provides methods to:
 * - Request tasks using "magic phrases"
 * - Accept proposed tasks
 * - Submit evidence with automatic transaction signing
 * - Handle verification questions and responses
 * - Watch until task completion (rewarded/refused)
 */

import type { Payment } from "xrpl";
import { randomUUID } from "node:crypto";
import { TaskNodeApi, type TaskProposal, type ChatMessage } from "./tasknode_api.js";
import { TransactionSigner } from "./signer.js";
import { pollUntil, POLL_INTERVALS, POLL_TIMEOUTS, type PollOptions } from "./polling.js";
import { savePending, clearPending, loadPending } from "./pending.js";

export type TaskType = "personal" | "network" | "alpha";

export type TaskRequest = {
  type: TaskType;
  description: string;
  context: string;
};

export type EvidenceInput = {
  type: "text" | "url" | "code" | "file";
  content: string;
  filePath?: string;
};

export type LoopOptions = {
  pollIntervals?: Partial<typeof POLL_INTERVALS>;
  pollTimeouts?: Partial<typeof POLL_TIMEOUTS>;
  onStatusChange?: (status: string, taskId: string) => void;
  verbose?: boolean;
};

export type FinalTask = {
  id: string;
  title: string;
  status: "rewarded" | "refused" | "cancelled";
  pft?: string;
  rewardTier?: string;
  rewardScore?: string;
  rewardSummary?: string;
  refusalReason?: string;
  txHash?: string;
};

function requirePayment(txJson: unknown): Payment {
  if (!txJson || typeof txJson !== "object") {
    throw new Error("Pointer tx_json is not an object.");
  }
  const tx = txJson as Partial<Payment>;
  if (!tx.Account || !tx.Amount || !tx.Destination || tx.TransactionType !== "Payment") {
    throw new Error("Pointer tx_json missing required Payment fields.");
  }
  return tx as Payment;
}

export class TaskLoopRunner {
  private api: TaskNodeApi;
  private signer: TransactionSigner;
  private encryptionPubkey: string | null = null;
  private opts: LoopOptions;

  constructor(api: TaskNodeApi, signer: TransactionSigner, opts: LoopOptions = {}) {
    this.api = api;
    this.signer = signer;
    this.opts = opts;
  }

  private log(message: string): void {
    if (this.opts.verbose) {
      process.stderr.write(`[TaskLoop] ${message}\n`);
    }
  }

  private async getEncryptionPubkey(): Promise<string> {
    if (!this.encryptionPubkey) {
      const summary = await this.api.getAccountSummary();
      const pubkey = (summary as { tasknode_encryption_pubkey?: string })?.tasknode_encryption_pubkey;
      if (!pubkey) {
        throw new Error("Account summary missing tasknode_encryption_pubkey.");
      }
      this.encryptionPubkey = pubkey;
    }
    return this.encryptionPubkey;
  }

  /**
   * Request a task using the "magic phrase" pattern.
   * Returns the task proposal when detected.
   */
  async requestTask(request: TaskRequest): Promise<TaskProposal> {
    const content = `request a ${request.type} task: ${request.description}`;
    this.log(`Sending: "${content.slice(0, 60)}..."`);

    const { assistantMessage } = await this.api.sendChatAndWait(
      content,
      request.context,
      "chat",
      this.opts.pollTimeouts?.TASK_PROPOSAL ?? POLL_TIMEOUTS.TASK_PROPOSAL,
      this.opts.pollIntervals?.TASK_PROPOSAL ?? POLL_INTERVALS.TASK_PROPOSAL
    );

    if (!assistantMessage) {
      throw new Error("Timeout waiting for task proposal");
    }

    const task = assistantMessage.metadata?.task;
    if (!task?.id) {
      throw new Error(`No task proposal in response. Classification: ${assistantMessage.classification_tag}`);
    }

    this.log(`Task proposed: ${task.id} - "${task.title}"`);
    return task;
  }

  /**
   * Accept a proposed task.
   */
  async acceptTask(taskId: string): Promise<{ status: string }> {
    this.log(`Accepting task: ${taskId}`);
    const result = await this.api.acceptTask(taskId);
    const status = (result as { task?: { status?: string } })?.task?.status || "unknown";
    this.log(`Task accepted. Status: ${status}`);
    this.opts.onStatusChange?.(status, taskId);
    return { status };
  }

  /**
   * Submit evidence for a task.
   * Handles upload, pointer preparation, signing, and submission.
   */
  async submitEvidence(taskId: string, evidence: EvidenceInput): Promise<{ txHash: string; cid: string }> {
    const pubkey = await this.getEncryptionPubkey();
    this.log(`Uploading evidence (type: ${evidence.type})`);

    // Upload evidence
    const upload = await this.api.uploadEvidence(taskId, {
      verificationType: evidence.type,
      artifact: evidence.content,
      filePath: evidence.filePath,
      x25519Pubkey: pubkey,
    });

    const uploadData = upload as { cid?: string; evidence_id?: string; evidenceId?: string };
    const evidenceId = uploadData.evidence_id || uploadData.evidenceId;
    const cid = uploadData.cid;
    if (!cid || !evidenceId) {
      throw new Error("Evidence upload missing cid or evidence_id.");
    }
    this.log(`Evidence uploaded. CID: ${cid.slice(0, 20)}...`);

    // Save pending BEFORE signing
    savePending({
      task_id: taskId,
      type: "evidence",
      cid,
      evidence_id: evidenceId,
      artifact_type: evidence.type,
      created_at: new Date().toISOString(),
    });

    // Prepare pointer
    const pointer = await this.api.preparePointer({ cid, task_id: taskId });
    const txJson = (pointer as { tx_json?: unknown })?.tx_json;
    if (!txJson) throw new Error("Pointer prepare missing tx_json.");

    // Sign and submit to XRPL
    this.log("Signing transaction...");
    const txHash = await this.signer.signAndSubmit(requirePayment(txJson));
    this.log(`Transaction submitted: ${txHash.slice(0, 20)}...`);

    // Submit to Task Node
    await this.api.submitEvidence(taskId, {
      cid,
      tx_hash: txHash,
      artifact_type: evidence.type,
      evidence_id: evidenceId,
    });

    // Clear pending on success
    clearPending(taskId, "evidence");
    this.log("Evidence submitted successfully");
    this.opts.onStatusChange?.("pending_verification", taskId);

    return { txHash, cid };
  }

  /**
   * Wait for a verification question to be generated.
   */
  async waitForVerification(taskId: string): Promise<string> {
    this.log("Waiting for verification question...");

    const result = await pollUntil(
      () => this.api.getVerificationStatus(taskId),
      (status) => {
        const ask = status.submission?.verification_ask;
        return !!ask && ask.length > 0 && status.submission?.verification_status === "awaiting_response";
      },
      {
        intervalMs: this.opts.pollIntervals?.VERIFICATION_QUESTION ?? POLL_INTERVALS.VERIFICATION_QUESTION,
        timeoutMs: this.opts.pollTimeouts?.VERIFICATION_QUESTION ?? POLL_TIMEOUTS.VERIFICATION_QUESTION,
        onPoll: (status, elapsed) => {
          this.log(`[${Math.round(elapsed / 1000)}s] verification_status: ${status.submission?.verification_status}`);
        },
      }
    );

    const question = result.submission.verification_ask;
    this.log(`Verification question: "${question.slice(0, 60)}..."`);
    return question;
  }

  /**
   * Respond to a verification question.
   * Handles response submission, signing, and transaction submission.
   */
  async respondToVerification(taskId: string, response: string): Promise<{ txHash: string; cid: string }> {
    const pubkey = await this.getEncryptionPubkey();
    this.log(`Responding to verification...`);

    // Check for existing pending
    const existing = loadPending(taskId, "verification_response");
    if (existing) {
      throw new Error(`Pending verification response exists. Use resumePendingVerification() to complete it.`);
    }

    // Submit response (pubkey required per API)
    const respondResult = await this.api.respondVerification(taskId, "text", response, pubkey);

    if (respondResult.error) {
      throw new Error(`Verification response failed: ${respondResult.error}`);
    }

    const cid = respondResult.evidence?.cid;
    // API sometimes returns evidence_id: null; generate UUID as fallback
    const evidenceId = respondResult.evidence?.evidence_id ?? randomUUID();
    if (!cid) {
      throw new Error("Verification response missing cid.");
    }

    // Save pending BEFORE signing
    savePending({
      task_id: taskId,
      type: "verification_response",
      cid,
      evidence_id: evidenceId,
      artifact_type: "text",
      created_at: new Date().toISOString(),
    });
    this.log(`Saved pending (CID: ${cid.slice(0, 20)}...)`);

    // Prepare pointer
    const pointer = await this.api.preparePointer({ cid, task_id: taskId });
    const txJson = (pointer as { tx_json?: unknown })?.tx_json;
    if (!txJson) throw new Error("Pointer prepare missing tx_json.");

    // Sign and submit
    this.log("Signing verification transaction...");
    const txHash = await this.signer.signAndSubmit(requirePayment(txJson));
    this.log(`Transaction submitted: ${txHash.slice(0, 20)}...`);

    // Verify backend has processed the response before submitting
    // This status check is required - the API rejects submissions if called too quickly
    await this.api.getVerificationStatus(taskId);

    // Submit to Task Node
    await this.api.submitVerification(taskId, {
      cid,
      tx_hash: txHash,
      artifact_type: "text",
      evidence_id: evidenceId,
    });

    // Clear pending on success
    clearPending(taskId, "verification_response");
    this.log("Verification response submitted successfully");

    return { txHash, cid };
  }

  /**
   * Watch a task until it reaches a terminal status (rewarded/refused/cancelled).
   */
  async watchUntilComplete(taskId: string): Promise<FinalTask> {
    this.log("Watching for final status...");

    const result = await pollUntil(
      () => this.api.getTask(taskId),
      (taskResult) => {
        const task = (taskResult as { task?: { status?: string } })?.task;
        const status = task?.status;
        return status === "rewarded" || status === "refused" || status === "cancelled";
      },
      {
        intervalMs: this.opts.pollIntervals?.FINAL_STATUS ?? POLL_INTERVALS.FINAL_STATUS,
        timeoutMs: this.opts.pollTimeouts?.FINAL_STATUS ?? POLL_TIMEOUTS.FINAL_STATUS,
        onPoll: (taskResult, elapsed) => {
          const task = (taskResult as { task?: { status?: string } })?.task;
          this.log(`[${Math.round(elapsed / 1000)}s] status: ${task?.status}`);
        },
      }
    );

    const task = (result as { task?: Record<string, unknown> })?.task;
    if (!task) {
      throw new Error("Task not found in response");
    }

    const finalTask: FinalTask = {
      id: task.id as string,
      title: task.title as string,
      status: task.status as "rewarded" | "refused" | "cancelled",
      pft: task.pft_offer_actual as string | undefined,
      rewardTier: task.reward_tier_final as string | undefined,
      rewardScore: task.reward_score as string | undefined,
      rewardSummary: task.reward_summary as string | undefined,
      refusalReason: task.refusal_reason as string | undefined,
      txHash: task.reward_tx_hash as string | undefined,
    };

    this.log(`Task completed: ${finalTask.status}`);
    if (finalTask.status === "rewarded") {
      this.log(`Reward: ${finalTask.pft} PFT (${finalTask.rewardTier})`);
    }

    return finalTask;
  }

  /**
   * Run the complete task loop from request to reward.
   * 
   * @param request - Task request details
   * @param evidence - Evidence to submit (string or function that receives task and returns evidence)
   * @param verificationResponse - Response to verification question (string or function that receives question AND task)
   */
  async runFullLoop(
    request: TaskRequest,
    evidence: EvidenceInput | ((task: TaskProposal) => EvidenceInput),
    verificationResponse: string | ((question: string, task: TaskProposal) => string)
  ): Promise<FinalTask> {
    // 1. Request task
    const task = await this.requestTask(request);
    
    // 2. Accept task
    await this.acceptTask(task.id);
    
    // 3. Submit evidence - can be dynamic based on task
    const evidenceInput = typeof evidence === "function" ? evidence(task) : evidence;
    await this.submitEvidence(task.id, evidenceInput);
    
    // 4. Wait for verification question
    const question = await this.waitForVerification(task.id);
    
    // 5. Respond to verification - receives both question AND task for context
    const response = typeof verificationResponse === "function"
      ? verificationResponse(question, task)
      : verificationResponse;
    await this.respondToVerification(task.id, response);
    
    // 6. Watch until complete
    return this.watchUntilComplete(task.id);
  }
}
