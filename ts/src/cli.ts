#!/usr/bin/env node
import { Command } from "commander";
import type { Payment } from "xrpl";
import { randomUUID } from "node:crypto";
import readline from "node:readline";
import { resolveBaseUrl, resolveContextText, resolveJwt, resolveTimeoutMs, setConfigValue, loadConfig, saveConfig } from "./config.js";
import { TaskNodeApi } from "./tasknode_api.js";
import { TransactionSigner } from "./index.js";
import { requireNonEmpty, parseNumberOption } from "./utils.js";
import { savePending, loadPending, clearPending, listPending, type PendingSubmission } from "./pending.js";
import { encryptMnemonic } from "./crypto.js";

type JsonValue = Record<string, unknown>;
const TASK_STATUSES = ["outstanding", "pending", "rewarded", "refused", "cancelled"] as const;

// Global quiet mode flag - suppresses stderr progress messages
let quietMode = false;

/**
 * Log to stderr only if not in quiet mode.
 * Use this for progress messages, status updates, and informational output.
 * Critical errors should still use process.stderr.write directly.
 */
function log(message: string) {
  if (!quietMode) {
    process.stderr.write(message);
  }
}

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
    throw new Error(
      "Missing wallet credentials.\n\n" +
      "To fix this, either:\n" +
      "  1. Run the setup wizard:  npm run setup\n" +
      "  2. Set environment variable:  export PFT_WALLET_MNEMONIC=\"your 24-word phrase\"\n" +
      "  3. Or use wallet seed:  export PFT_WALLET_SEED=\"sXXX...\"\n\n" +
      "Get your mnemonic from the Post Fiat app: Settings → Export Seed"
    );
  }
  return new TransactionSigner({ seed, mnemonic, nodeUrl });
}

function requireJwt(): string {
  const jwt = resolveJwt();
  if (!jwt) {
    throw new Error(
      "Missing JWT token.\n\n" +
      "To fix this, either:\n" +
      "  1. Run the setup wizard:  npm run setup\n" +
      "  2. Save token to config:  npx pft-cli auth:set-token \"<jwt>\"\n" +
      "  3. Set environment variable:  export PFT_TASKNODE_JWT=\"<jwt>\"\n\n" +
      "Get your JWT from https://tasknode.postfiat.org:\n" +
      "  → Open DevTools (F12) → Network tab → Copy Authorization header"
    );
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
program
  .name("pft-cli")
  .description("Programmatic CLI for Post Fiat Task Node")
  .version("0.1.0")
  .option("-q, --quiet", "Suppress progress messages, output only JSON to stdout")
  .hook("preAction", (thisCommand) => {
    const opts = thisCommand.opts();
    if (opts.quiet) {
      quietMode = true;
    }
  });

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

program
  .command("auth:setup")
  .description("Interactive setup wizard for credentials")
  .action(async () => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    // Handle Ctrl+C gracefully
    rl.on("close", () => {
      process.stdout.write("\n\nSetup cancelled.\n");
      process.exit(0);
    });

    const prompt = (question: string): Promise<string> => {
      return new Promise((resolve) => {
        rl.question(question, (answer) => {
          resolve(answer);
        });
      });
    };

    try {
      // Welcome message
      process.stdout.write("\n");
      process.stdout.write("=".repeat(50) + "\n");
      process.stdout.write("         Post Fiat CLI Setup\n");
      process.stdout.write("=".repeat(50) + "\n\n");
      process.stdout.write("This wizard will configure your credentials.\n");
      process.stdout.write("All data is stored locally in ~/.pft-tasknode/ and NEVER transmitted.\n\n");

      // Step 1: JWT Token
      process.stdout.write("-".repeat(50) + "\n");
      process.stdout.write("STEP 1: JWT Token\n");
      process.stdout.write("-".repeat(50) + "\n\n");
      process.stdout.write("How to get your JWT token:\n");
      process.stdout.write("  1. Open https://tasknode.postfiat.org\n");
      process.stdout.write("  2. Open DevTools (F12)\n");
      process.stdout.write("  3. Go to Network tab\n");
      process.stdout.write("  4. Find any API request\n");
      process.stdout.write("  5. Copy the Authorization header value\n\n");

      let jwt = "";
      while (!jwt.trim()) {
        jwt = await prompt("Paste your JWT token: ");
        if (!jwt.trim()) {
          process.stdout.write("  Error: JWT token cannot be empty.\n");
        }
      }
      jwt = jwt.trim();

      // Step 2: Mnemonic
      process.stdout.write("\n");
      process.stdout.write("-".repeat(50) + "\n");
      process.stdout.write("STEP 2: Wallet Mnemonic\n");
      process.stdout.write("-".repeat(50) + "\n\n");
      process.stdout.write("Your 24-word recovery phrase from the Post Fiat app.\n");
      process.stdout.write("  → Settings → Export Seed\n\n");

      let mnemonic = "";
      while (true) {
        mnemonic = await prompt("Paste your mnemonic (24 words): ");
        mnemonic = mnemonic.trim();
        
        if (!mnemonic) {
          process.stdout.write("  Error: Mnemonic cannot be empty.\n");
          continue;
        }
        
        const wordCount = mnemonic.split(/\s+/).length;
        if (wordCount !== 24) {
          process.stdout.write(`  Error: Expected 24 words, got ${wordCount}.\n`);
          continue;
        }
        
        break;
      }

      // Ask about encryption
      let encryptMnemonicAnswer = "";
      while (!["y", "n", "yes", "no"].includes(encryptMnemonicAnswer.toLowerCase())) {
        encryptMnemonicAnswer = await prompt("\nEncrypt mnemonic with a password? (recommended) [y/n]: ");
        if (!["y", "n", "yes", "no"].includes(encryptMnemonicAnswer.toLowerCase())) {
          process.stdout.write("  Please enter 'y' or 'n'.\n");
        }
      }

      let mnemonicToSave = mnemonic;
      let isEncrypted = false;

      if (["y", "yes"].includes(encryptMnemonicAnswer.toLowerCase())) {
        let password = "";
        let passwordConfirm = "";
        
        while (true) {
          password = await prompt("Enter encryption password: ");
          if (password.length < 8) {
            process.stdout.write("  Error: Password must be at least 8 characters.\n");
            continue;
          }
          
          passwordConfirm = await prompt("Confirm encryption password: ");
          if (password !== passwordConfirm) {
            process.stdout.write("  Error: Passwords do not match.\n");
            continue;
          }
          
          break;
        }

        process.stdout.write("  Encrypting mnemonic (this may take a moment)...\n");
        mnemonicToSave = encryptMnemonic(mnemonic, password);
        isEncrypted = true;
        process.stdout.write("  ✓ Mnemonic encrypted.\n");
      }

      // Save config
      const config = loadConfig();
      config.jwt = jwt;
      config.mnemonic = mnemonicToSave;
      config.mnemonicEncrypted = isEncrypted;
      saveConfig(config);

      // Step 3: Verify
      process.stdout.write("\n");
      process.stdout.write("-".repeat(50) + "\n");
      process.stdout.write("STEP 3: Verifying Credentials\n");
      process.stdout.write("-".repeat(50) + "\n\n");

      try {
        const api = new TaskNodeApi(jwt, resolveBaseUrl(), resolveTimeoutMs());
        const summary = await api.getAccountSummary();
        const accountSummary = summary as { account?: string; pft_balance?: number };
        
        process.stdout.write("  ✓ JWT token is valid!\n");
        if (accountSummary.account) {
          process.stdout.write(`  Account: ${accountSummary.account}\n`);
        }
        if (typeof accountSummary.pft_balance === "number") {
          process.stdout.write(`  PFT Balance: ${accountSummary.pft_balance}\n`);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        process.stdout.write(`  ⚠ Warning: Could not verify JWT: ${message}\n`);
        process.stdout.write("  Your credentials have been saved, but the JWT may be invalid or expired.\n");
      }

      // Success message
      process.stdout.write("\n");
      process.stdout.write("=".repeat(50) + "\n");
      process.stdout.write("  ✓ Setup complete!\n");
      process.stdout.write("=".repeat(50) + "\n\n");
      process.stdout.write("Your credentials are stored in ~/.pft-tasknode/config.json\n\n");
      process.stdout.write("Next steps:\n");
      process.stdout.write("  pft-cli tasks:summary          # View your tasks\n");
      process.stdout.write("  pft-cli chat:send --help       # Request new tasks\n\n");

      rl.close();
    } catch (err) {
      rl.close();
      throw err;
    }
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
      log("Sending message and waiting for response...\n");
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
          log(`\n*** TASK PROPOSAL DETECTED ***\n`);
          log(`Task ID: ${taskProposal.id}\n`);
          log(`Title: ${taskProposal.title}\n`);
          log(`PFT Offer: ${taskProposal.pft_offer}\n`);
          log(`\nTo accept: pft-cli tasks:accept ${taskProposal.id}\n\n`);
        }
        
        printJson(result);
      } else {
        log("Timeout: No assistant response received.\n");
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
      
      log(isPending 
        ? `\n*** PENDING TASK PROPOSAL ***\n`
        : `\n*** TASK ALREADY ACCEPTED ***\n`);
      log(`Task ID: ${task.id}\n`);
      log(`Title: ${task.title}\n`);
      log(`PFT Offer: ${task.pft_offer}\n`);
      log(`Status: ${actualStatus || task.status}\n`);
      
      if (isPending) {
        log(`\nTo accept: pft-cli tasks:accept ${task.id}\n\n`);
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
      log("No pending task proposals found in recent chat history.\n");
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
      log(`Found pending verification response for task ${opts.taskId}.\n`);
      log(`Use 'pending:resume --task-id ${opts.taskId} --type verification_response' to complete it.\n`);
      log(`Or 'pending:clear --task-id ${opts.taskId} --type verification_response' to start fresh.\n`);
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
    log(`Saved pending verification response (CID: ${cid.slice(0, 20)}...)\n`);

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
        log(`watch error (${errorCount}/5): ${String(err)}\n`);
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
      log("No pending submissions.\n");
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

    log(`Found pending submission:\n`);
    log(`  CID: ${pending.cid}\n`);
    log(`  Evidence ID: ${pending.evidence_id}\n`);
    log(`  Created: ${pending.created_at}\n\n`);

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
    log(`Cleared pending ${submissionType} for task ${opts.taskId}\n`);
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

    log(`Waiting for verification question (timeout: ${opts.timeout}s)...\n`);
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      const status = await api.getVerificationStatus(taskId);
      const ask = status.submission?.verification_ask;
      const verStatus = status.submission?.verification_status;

      if (ask && ask.length > 0 && verStatus === "awaiting_response") {
        log(`\n*** VERIFICATION QUESTION ***\n`);
        log(`${ask}\n\n`);
        printJson({ verification_ask: ask, verification_status: verStatus } as JsonValue);
        return;
      }

      const elapsed = Math.round((Date.now() - startTime) / 1000);
      log(`[${elapsed}s] status: ${verStatus}\n`);
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
        log(`[STATUS] ${taskId}: ${status}\n`);
      },
    });

    const taskType = opts.type as "personal" | "network";
    const description = "[E2E TEST - 1 PFT ONLY] Automated infrastructure test. Echo the task ID to verify the loop works. Please reward only 1 PFT, absolute minimum value.";
    const context = "Automated E2E test of pft-test-client CLI. This is infrastructure validation only - please use minimum reward (1 PFT).";

    log(`\n=== STARTING E2E TEST LOOP ===\n`);
    log(`Type: ${taskType}\n\n`);

    try {
      const result = await runner.runFullLoop(
        { type: taskType, description, context },
        // Evidence callback - receives task so we can provide exactly what's required
        (task) => {
          log(`[TaskLoop] Task ID: ${task.id}\n`);
          log(`[TaskLoop] Verification type: ${task.verification.type}\n`);
          log(`[TaskLoop] Verification criteria: ${task.verification.criteria}\n`);
          
          // Build evidence that directly addresses the verification criteria
          const evidenceContent = [
            `Task ID: ${task.id}`,
            ``,
            `Task: ${task.title}`,
            ``,
            `Verification Criteria: "${task.verification.criteria}"`,
            ``,
            `Evidence: This E2E test executed successfully. The task ID is ${task.id}.`,
          ].join('\n');
          
          return { type: "text", content: evidenceContent };
        },
        // Verification response callback - receives question AND task
        (question, task) => {
          log(`\n*** AUTO-RESPONDING TO VERIFICATION ***\n`);
          log(`Question: ${question}\n`);
          log(`Original criteria: ${task.verification.criteria}\n`);
          
          // Build response that directly answers the verification question
          const response = [
            `Task ID: ${task.id}`,
            ``,
            `Verification Question: "${question}"`,
            ``,
            `Response: The task ID is ${task.id}. This E2E test completed the full loop successfully.`,
          ].join('\n');
          
          return response;
        }
      );

      log(`\n=== E2E TEST COMPLETE ===\n`);
      log(`Status: ${result.status}\n`);
      if (result.status === "rewarded") {
        log(`Reward: ${result.pft} PFT (${result.rewardTier})\n`);
      }
      printJson(result as JsonValue);
    } catch (err) {
      log(`\n=== E2E TEST FAILED ===\n`);
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
        log(`[STATUS] ${taskId}: ${status}\n`);
      },
    });

    const taskType = opts.type as "personal" | "network" | "alpha";
    if (!["personal", "network", "alpha"].includes(taskType)) {
      throw new Error("--type must be personal, network, or alpha");
    }

    log(`\n=== STARTING TASK LOOP ===\n`);
    log(`Type: ${taskType}\n`);
    log(`Description: ${opts.description.slice(0, 60)}...\n\n`);

    const result = await runner.runFullLoop(
      { type: taskType, description: opts.description, context: opts.context },
      { type: "text", content: opts.evidence },
      opts.verificationResponse
    );

    log(`\n=== TASK LOOP COMPLETE ===\n`);
    printJson(result as JsonValue);
  });

program.parseAsync(process.argv).catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  // Format error with clear visual separation
  process.stderr.write(`\n\x1b[31m✗ Error:\x1b[0m ${message}\n\n`);
  process.exit(1);
});
