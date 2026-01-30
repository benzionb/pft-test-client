#!/usr/bin/env node
import { Command } from "commander";
import type { Payment } from "xrpl";
import { randomUUID } from "node:crypto";
import { resolveBaseUrl, resolveContextText, resolveJwt, resolveTimeoutMs, setConfigValue } from "./config.js";
import { TaskNodeApi } from "./tasknode_api.js";
import { TransactionSigner } from "./index.js";
import { requireNonEmpty, parseNumberOption } from "./utils.js";
import { savePending, loadPending, clearPending, listPending, type PendingSubmission } from "./pending.js";

type JsonValue = Record<string, unknown>;
const TASK_STATUSES = ["outstanding", "pending", "rewarded", "refused", "cancelled"] as const;

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

function createSigner(nodeUrl?: string) {
  const seed = process.env.PFT_WALLET_SEED;
  const mnemonic = process.env.PFT_WALLET_MNEMONIC;
  if (!seed && !mnemonic) {
    throw new Error("PFT_WALLET_SEED or PFT_WALLET_MNEMONIC is required for signing.");
  }
  return new TransactionSigner({ seed, mnemonic, nodeUrl });
}

function requireJwt(): string {
  const jwt = resolveJwt();
  if (!jwt) {
    throw new Error("JWT missing. Set PFT_TASKNODE_JWT or run: pft-cli auth:set-token <jwt>");
  }
  return jwt;
}

function getApi() {
  const jwt = requireJwt();
  return new TaskNodeApi(jwt, resolveBaseUrl(), resolveTimeoutMs());
}

function printJson(value: JsonValue) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

const program = new Command();
program.name("pft-cli").description("Programmatic CLI for Post Fiat Task Node").version("0.1.0");

// Auth
program
  .command("auth:status")
  .description("Check JWT and account summary")
  .action(async () => {
    const api = getApi();
    const summary = await api.getAccountSummary();
    printJson(summary as JsonValue);
  });

program
  .command("auth:set-token")
  .description("Save JWT token to ~/.pft-tasknode/config.json")
  .argument("<jwt>", "JWT token")
  .action((jwt) => {
    setConfigValue("jwt", jwt);
    process.stdout.write("JWT saved.\n");
  });

// Tasks
program
  .command("tasks:summary")
  .description("Get task summary with counts")
  .action(async () => {
    const api = getApi();
    const summary = await api.getTasksSummary();
    printJson(summary as JsonValue);
  });

program
  .command("tasks:list")
  .description("List tasks from summary by status")
  .option("--status <status>", "outstanding|pending|rewarded|refused|cancelled", "outstanding")
  .action(async (opts) => {
    const api = getApi();
    const summary = await api.getTasksSummary();
    const status = opts.status as string;
    if (!TASK_STATUSES.includes(status as (typeof TASK_STATUSES)[number])) {
      throw new Error(`Invalid status: ${status}`);
    }
    const tasks = (summary as { tasks?: Record<string, unknown> })?.tasks?.[status] || [];
    printJson({ status, tasks });
  });

program
  .command("tasks:get")
  .description("Get a task by ID")
  .argument("<taskId>", "Task ID")
  .action(async (taskId) => {
    const api = getApi();
    const task = await api.getTask(taskId);
    printJson(task as JsonValue);
  });

program
  .command("tasks:accept")
  .description("Accept a pending task")
  .argument("<taskId>", "Task ID")
  .action(async (taskId) => {
    const api = getApi();
    const result = await api.acceptTask(taskId);
    printJson(result as JsonValue);
  });

// Chat
program
  .command("chat:send")
  .description("Send a chat message and optionally wait for assistant response")
  .requiredOption("--content <content>", "Message content")
  .option("--context <context>", "Context text (falls back to config/env)")
  .option("--wait", "Wait for assistant response (polls until response arrives)")
  .option("--timeout <ms>", "Max wait time in ms (default: 60000)", "60000")
  .action(async (opts) => {
    const api = getApi();
    const contextText = opts.context || resolveContextText();
    const content = requireNonEmpty(opts.content, "content");
    const context = requireNonEmpty(contextText, "context");
    
    if (opts.wait) {
      const timeoutMs = parseNumberOption(opts.timeout, "timeout", 1000);
      process.stderr.write("Sending message and waiting for response...\n");
      const { userMessage, assistantMessage } = await api.sendChatAndWait(content, context, "chat", timeoutMs);
      
      if (assistantMessage) {
        // Check if this is a task proposal (has task metadata with id)
        const taskProposal = assistantMessage.metadata?.task;
        const isTaskProposal = !!taskProposal?.id;
        
        const result: JsonValue = {
          user_message: userMessage,
          assistant_response: {
            id: assistantMessage.id,
            content: assistantMessage.content,
            classification: assistantMessage.classification_tag,
            created_at: assistantMessage.created_at,
            is_task_proposal: isTaskProposal,
          },
        };
        
        // If task proposal, include task details prominently
        if (isTaskProposal && taskProposal) {
          (result as Record<string, unknown>).task_proposal = {
            task_id: taskProposal.id,
            title: taskProposal.title,
            description: taskProposal.description,
            pft_offer: taskProposal.pft_offer,
            verification_type: taskProposal.verification?.type,
            status: taskProposal.status,
            steps: taskProposal.steps?.length || 0,
          };
          process.stderr.write(`\n*** TASK PROPOSAL DETECTED ***\n`);
          process.stderr.write(`Task ID: ${taskProposal.id}\n`);
          process.stderr.write(`Title: ${taskProposal.title}\n`);
          process.stderr.write(`PFT Offer: ${taskProposal.pft_offer}\n`);
          process.stderr.write(`\nTo accept: pft-cli tasks:accept ${taskProposal.id}\n\n`);
        }
        
        printJson(result);
      } else {
        process.stderr.write("Timeout: No assistant response received.\n");
        printJson({ user_message: userMessage, assistant_response: null } as JsonValue);
      }
    } else {
      const response = await api.sendChat(content, context);
      printJson(response as JsonValue);
    }
  });

program
  .command("chat:list")
  .description("List recent chat messages")
  .option("--limit <n>", "Number of messages to fetch", "10")
  .action(async (opts) => {
    const api = getApi();
    const limit = parseNumberOption(opts.limit, "limit", 1);
    const { messages } = await api.listChat(limit);
    
    // Sort by created_at descending (newest first) for display
    const sorted = [...messages].sort((a, b) => 
      b.created_at.localeCompare(a.created_at)
    );
    
    printJson({ messages: sorted } as JsonValue);
  });

program
  .command("chat:pending-task")
  .description("Check for pending task proposals in recent chat history")
  .action(async () => {
    const api = getApi();
    const { messages } = await api.listChat(10);
    
    // Find the most recent task proposal (assistant message with task metadata)
    const taskProposal = messages
      .filter(m => m.role === "assistant" && m.metadata?.task?.id)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
    
    if (taskProposal?.metadata?.task) {
      const task = taskProposal.metadata.task;
      
      // Check if this task is already accepted (in_progress or later)
      const taskStatus = await api.getTask(task.id).catch(() => null);
      const actualStatus = (taskStatus as { task?: { status?: string } })?.task?.status;
      
      const isPending = !actualStatus || actualStatus === "pending";
      
      process.stderr.write(isPending 
        ? `\n*** PENDING TASK PROPOSAL ***\n`
        : `\n*** TASK ALREADY ACCEPTED ***\n`);
      process.stderr.write(`Task ID: ${task.id}\n`);
      process.stderr.write(`Title: ${task.title}\n`);
      process.stderr.write(`PFT Offer: ${task.pft_offer}\n`);
      process.stderr.write(`Status: ${actualStatus || task.status}\n`);
      
      if (isPending) {
        process.stderr.write(`\nTo accept: pft-cli tasks:accept ${task.id}\n\n`);
      }
      
      printJson({
        task_id: task.id,
        title: task.title,
        description: task.description,
        pft_offer: task.pft_offer,
        verification_type: task.verification?.type,
        status: actualStatus || task.status,
        can_accept: isPending,
      } as JsonValue);
    } else {
      process.stderr.write("No pending task proposals found in recent chat history.\n");
      printJson({ task_proposal: null } as JsonValue);
    }
  });

// Evidence submission flow
program
  .command("evidence:submit")
  .description("Upload evidence, prepare pointer, sign, and submit")
  .requiredOption("--task-id <taskId>", "Task ID")
  .requiredOption("--type <type>", "text|url|code|file")
  .option("--content <content>", "Artifact content (text/url/code)")
  .option("--artifact-json <json>", "JSON string for artifact field")
  .option("--file <path>", "File path for artifact upload")
  .option("--kind <kind>", "Pointer kind", "TASK_SUBMISSION")
  .option("--schema <schema>", "Pointer schema", "1")
  .option("--flags <flags>", "Pointer flags", "1")
  .option("--node-url <url>", "XRPL node URL", "wss://rpc.testnet.postfiat.org:6008")
  .action(async (opts) => {
    const api = getApi();
    const signer = createSigner(opts.nodeUrl);

    const accountSummary = await api.getAccountSummary();
    const pubkey = (accountSummary as { tasknode_encryption_pubkey?: string })?.tasknode_encryption_pubkey;
    if (!pubkey) {
      throw new Error("Account summary missing tasknode_encryption_pubkey.");
    }

    if (!opts.content && !opts.file && !opts.artifactJson) {
      throw new Error("Provide --content, --file, or --artifact-json for evidence.");
    }
    if (opts.content) {
      requireNonEmpty(opts.content, "content");
    }
    if (opts.artifactJson) {
      requireNonEmpty(opts.artifactJson, "artifactJson");
    }

    const upload = await api.uploadEvidence(opts.taskId, {
      verificationType: opts.type,
      artifact: opts.content || "",
      artifactJson: opts.artifactJson,
      filePath: opts.file,
      x25519Pubkey: pubkey,
    });

    const uploadData = upload as { cid?: string; evidence_id?: string; evidenceId?: string };
    const evidenceId = uploadData.evidence_id || uploadData.evidenceId;
    const cid = uploadData.cid;
    if (!cid || !evidenceId) {
      throw new Error("Evidence upload missing cid or evidence_id.");
    }

    const pointer = await api.preparePointer({
      cid,
      task_id: opts.taskId,
      kind: opts.kind,
      schema: parseNumberOption(opts.schema, "schema"),
      flags: parseNumberOption(opts.flags, "flags"),
    });

    const txJson = (pointer as { tx_json?: unknown })?.tx_json;
    if (!txJson) throw new Error("Pointer prepare missing tx_json.");

    // Save pending before signing (in case tx fails)
    savePending({
      task_id: opts.taskId,
      type: "evidence",
      cid,
      evidence_id: evidenceId,
      artifact_type: opts.type,
      created_at: new Date().toISOString(),
    });

    const txHash = await signer.signAndSubmit(requirePayment(txJson));

    const submit = await api.submitEvidence(opts.taskId, {
      cid,
      tx_hash: txHash,
      artifact_type: opts.type,
      evidence_id: evidenceId,
    });

    // Clear pending on success
    clearPending(opts.taskId, "evidence");

    printJson({ upload, pointer, tx_hash: txHash, submit } as JsonValue);
  });

// Verification response flow
program
  .command("verify:respond")
  .description("Respond to verification request and submit pointer")
  .requiredOption("--task-id <taskId>", "Task ID")
  .requiredOption("--type <type>", "text|url|code")
  .requiredOption("--response <text>", "Verification response")
  .option("--kind <kind>", "Pointer kind", "TASK_SUBMISSION")
  .option("--schema <schema>", "Pointer schema", "1")
  .option("--flags <flags>", "Pointer flags", "1")
  .option("--node-url <url>", "XRPL node URL", "wss://rpc.testnet.postfiat.org:6008")
  .action(async (opts) => {
    const api = getApi();
    const signer = createSigner(opts.nodeUrl);

    // Check for existing pending submission first
    const existingPending = loadPending(opts.taskId, "verification_response");
    if (existingPending) {
      process.stderr.write(`Found pending verification response for task ${opts.taskId}.\n`);
      process.stderr.write(`Use 'pending:resume --task-id ${opts.taskId} --type verification_response' to complete it.\n`);
      process.stderr.write(`Or 'pending:clear --task-id ${opts.taskId} --type verification_response' to start fresh.\n`);
      throw new Error("Pending verification response exists. Resume or clear it first.");
    }

    // Fetch encryption pubkey
    const accountSummary = await api.getAccountSummary();
    const pubkey = (accountSummary as { tasknode_encryption_pubkey?: string })?.tasknode_encryption_pubkey;
    if (!pubkey) {
      throw new Error("Account summary missing tasknode_encryption_pubkey.");
    }

    const responseText = requireNonEmpty(opts.response, "response");
    const respond = await api.respondVerification(opts.taskId, opts.type, responseText, pubkey);
    
    // Check for API error (e.g., "awaiting signature" means response already submitted)
    if (respond.error) {
      throw new Error(`Verification response failed: ${respond.error}. Check verification status with 'tasks:get ${opts.taskId}'.`);
    }
    
    const evidence = respond.evidence;
    const cid = evidence?.cid;
    // API sometimes returns evidence_id: null; generate UUID as fallback
    const evidenceId = evidence?.evidence_id ?? randomUUID();
    if (!cid) {
      throw new Error("Verification response missing cid. Response may already be pending signature.");
    }

    // Save pending BEFORE signing (critical for recovery)
    savePending({
      task_id: opts.taskId,
      type: "verification_response",
      cid,
      evidence_id: evidenceId,
      artifact_type: opts.type,
      created_at: new Date().toISOString(),
    });
    process.stderr.write(`Saved pending verification response (CID: ${cid.slice(0, 20)}...)\n`);

    const pointer = await api.preparePointer({
      cid,
      task_id: opts.taskId,
      kind: opts.kind,
      schema: parseNumberOption(opts.schema, "schema"),
      flags: parseNumberOption(opts.flags, "flags"),
    });

    const txJson = (pointer as { tx_json?: unknown })?.tx_json;
    if (!txJson) throw new Error("Pointer prepare missing tx_json.");

    const txHash = await signer.signAndSubmit(requirePayment(txJson));

    const submit = await api.submitVerification(opts.taskId, {
      cid,
      tx_hash: txHash,
      artifact_type: opts.type,
      evidence_id: evidenceId,
    });

    // Clear pending on success
    clearPending(opts.taskId, "verification_response");

    printJson({ respond, pointer, tx_hash: txHash, submit } as JsonValue);
  });

// Watch task status
program
  .command("tasks:watch")
  .description("Poll a task until rewarded or refused")
  .argument("<taskId>", "Task ID")
  .option("--interval <seconds>", "Poll interval (seconds)", "15")
  .action(async (taskId, opts) => {
    const api = getApi();
    const intervalMs = parseNumberOption(opts.interval, "interval", 1) * 1000;
    let errorCount = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      try {
        const task = await api.getTask(taskId);
        const status = (task as { task?: { status?: string } })?.task?.status;
        process.stdout.write(`[${new Date().toISOString()}] status=${status ?? "unknown"}\n`);
        if (status === "rewarded" || status === "refused" || status === "cancelled") {
          printJson(task as JsonValue);
          break;
        }
        errorCount = 0;
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
      } catch (err) {
        errorCount += 1;
        process.stderr.write(`watch error (${errorCount}/5): ${String(err)}\n`);
        if (errorCount >= 5) {
          throw err;
        }
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
      }
    }
  });

// Pending submissions management
program
  .command("pending:list")
  .description("List pending submissions that failed to complete")
  .action(() => {
    const pending = listPending();
    if (pending.length === 0) {
      process.stderr.write("No pending submissions.\n");
      printJson({ pending: [] });
    } else {
      printJson({ pending } as JsonValue);
    }
  });

program
  .command("pending:resume")
  .description("Resume a pending submission (complete the on-chain transaction)")
  .requiredOption("--task-id <taskId>", "Task ID")
  .requiredOption("--type <type>", "evidence|verification_response")
  .option("--node-url <url>", "XRPL node URL", "wss://rpc.testnet.postfiat.org:6008")
  .action(async (opts) => {
    const submissionType = opts.type as "evidence" | "verification_response";
    if (submissionType !== "evidence" && submissionType !== "verification_response") {
      throw new Error("--type must be 'evidence' or 'verification_response'");
    }

    const pending = loadPending(opts.taskId, submissionType);
    if (!pending) {
      throw new Error(`No pending ${submissionType} submission found for task ${opts.taskId}`);
    }

    process.stderr.write(`Found pending submission:\n`);
    process.stderr.write(`  CID: ${pending.cid}\n`);
    process.stderr.write(`  Evidence ID: ${pending.evidence_id}\n`);
    process.stderr.write(`  Created: ${pending.created_at}\n\n`);

    const api = getApi();
    const signer = createSigner(opts.nodeUrl);

    // Prepare pointer
    const pointer = await api.preparePointer({
      cid: pending.cid,
      task_id: pending.task_id,
      kind: "TASK_SUBMISSION",
      schema: 1,
      flags: 1,
    });

    const txJson = (pointer as { tx_json?: unknown })?.tx_json;
    if (!txJson) throw new Error("Pointer prepare missing tx_json.");

    // Sign and submit
    const txHash = await signer.signAndSubmit(requirePayment(txJson));

    // Submit to Task Node
    let submit;
    if (submissionType === "evidence") {
      submit = await api.submitEvidence(pending.task_id, {
        cid: pending.cid,
        tx_hash: txHash,
        artifact_type: pending.artifact_type,
        evidence_id: pending.evidence_id,
      });
    } else {
      submit = await api.submitVerification(pending.task_id, {
        cid: pending.cid,
        tx_hash: txHash,
        artifact_type: pending.artifact_type,
        evidence_id: pending.evidence_id,
      });
    }

    // Clear pending on success
    clearPending(pending.task_id, submissionType);

    printJson({ resumed: pending, pointer, tx_hash: txHash, submit } as JsonValue);
  });

program
  .command("pending:clear")
  .description("Clear a pending submission (abandon without completing)")
  .requiredOption("--task-id <taskId>", "Task ID")
  .requiredOption("--type <type>", "evidence|verification_response")
  .action((opts) => {
    const submissionType = opts.type as "evidence" | "verification_response";
    if (submissionType !== "evidence" && submissionType !== "verification_response") {
      throw new Error("--type must be 'evidence' or 'verification_response'");
    }
    clearPending(opts.taskId, submissionType);
    process.stderr.write(`Cleared pending ${submissionType} for task ${opts.taskId}\n`);
  });

// Verification utilities
program
  .command("verify:status")
  .description("Get current verification status for a task")
  .argument("<taskId>", "Task ID")
  .action(async (taskId) => {
    const api = getApi();
    const status = await api.getVerificationStatus(taskId);
    printJson(status as JsonValue);
  });

program
  .command("verify:wait")
  .description("Wait for verification question to be generated")
  .argument("<taskId>", "Task ID")
  .option("--timeout <seconds>", "Timeout in seconds", "300")
  .option("--interval <seconds>", "Poll interval in seconds", "15")
  .action(async (taskId, opts) => {
    const api = getApi();
    const timeoutMs = parseNumberOption(opts.timeout, "timeout", 1) * 1000;
    const intervalMs = parseNumberOption(opts.interval, "interval", 1) * 1000;

    process.stderr.write(`Waiting for verification question (timeout: ${opts.timeout}s)...\n`);
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      const status = await api.getVerificationStatus(taskId);
      const ask = status.submission?.verification_ask;
      const verStatus = status.submission?.verification_status;

      if (ask && ask.length > 0 && verStatus === "awaiting_response") {
        process.stderr.write(`\n*** VERIFICATION QUESTION ***\n`);
        process.stderr.write(`${ask}\n\n`);
        printJson({ verification_ask: ask, verification_status: verStatus } as JsonValue);
        return;
      }

      const elapsed = Math.round((Date.now() - startTime) / 1000);
      process.stderr.write(`[${elapsed}s] status: ${verStatus}\n`);
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }

    throw new Error(`Timeout waiting for verification question after ${opts.timeout}s`);
  });

// Task loop automation
program
  .command("loop:test")
  .description("Run an automated E2E test task loop with minimal reward")
  .option("--type <type>", "Task type: personal|network", "personal")
  .option("--node-url <url>", "XRPL node URL", "wss://rpc.testnet.postfiat.org:6008")
  .action(async (opts) => {
    const { TaskLoopRunner } = await import("./loop.js");
    const api = getApi();
    const signer = createSigner(opts.nodeUrl);

    const runner = new TaskLoopRunner(api, signer, {
      verbose: true,
      onStatusChange: (status, taskId) => {
        process.stderr.write(`[STATUS] ${taskId}: ${status}\n`);
      },
    });

    const taskType = opts.type as "personal" | "network";
    const description = "[E2E TEST - 1 PFT ONLY] Automated infrastructure test. Echo the task ID to verify the loop works. Please reward only 1 PFT, absolute minimum value.";
    const context = "Automated E2E test of pft-test-client CLI. This is infrastructure validation only - please use minimum reward (1 PFT).";

    process.stderr.write(`\n=== STARTING E2E TEST LOOP ===\n`);
    process.stderr.write(`Type: ${taskType}\n\n`);

    try {
      const result = await runner.runFullLoop(
        { type: taskType, description, context },
        { type: "text", content: "E2E Test Output: [TEST PASSED] Full task loop validated programmatically." },
        (question) => {
          process.stderr.write(`\n*** AUTO-RESPONDING TO VERIFICATION ***\n`);
          process.stderr.write(`Question: ${question}\n`);
          // Auto-response includes task context that proves we ran the test
          return `This is an automated E2E test. The task was requested programmatically with description: "${description.slice(0, 50)}..."`;
        }
      );

      process.stderr.write(`\n=== E2E TEST COMPLETE ===\n`);
      process.stderr.write(`Status: ${result.status}\n`);
      if (result.status === "rewarded") {
        process.stderr.write(`Reward: ${result.pft} PFT (${result.rewardTier})\n`);
      }
      printJson(result as JsonValue);
    } catch (err) {
      process.stderr.write(`\n=== E2E TEST FAILED ===\n`);
      throw err;
    }
  });

program
  .command("loop:run")
  .description("Run a full task loop interactively")
  .requiredOption("--type <type>", "Task type: personal|network|alpha")
  .requiredOption("--description <desc>", "Task description")
  .requiredOption("--context <ctx>", "Context for the task")
  .requiredOption("--evidence <text>", "Evidence text to submit")
  .requiredOption("--verification-response <text>", "Response to verification question")
  .option("--node-url <url>", "XRPL node URL", "wss://rpc.testnet.postfiat.org:6008")
  .action(async (opts) => {
    const { TaskLoopRunner } = await import("./loop.js");
    const api = getApi();
    const signer = createSigner(opts.nodeUrl);

    const runner = new TaskLoopRunner(api, signer, {
      verbose: true,
      onStatusChange: (status, taskId) => {
        process.stderr.write(`[STATUS] ${taskId}: ${status}\n`);
      },
    });

    const taskType = opts.type as "personal" | "network" | "alpha";
    if (!["personal", "network", "alpha"].includes(taskType)) {
      throw new Error("--type must be personal, network, or alpha");
    }

    process.stderr.write(`\n=== STARTING TASK LOOP ===\n`);
    process.stderr.write(`Type: ${taskType}\n`);
    process.stderr.write(`Description: ${opts.description.slice(0, 60)}...\n\n`);

    const result = await runner.runFullLoop(
      { type: taskType, description: opts.description, context: opts.context },
      { type: "text", content: opts.evidence },
      opts.verificationResponse
    );

    process.stderr.write(`\n=== TASK LOOP COMPLETE ===\n`);
    printJson(result as JsonValue);
  });

program.parseAsync(process.argv).catch((err) => {
  process.stderr.write(`${String(err)}\n`);
  process.exit(1);
});
