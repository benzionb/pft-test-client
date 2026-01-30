#!/usr/bin/env node
import { Command } from "commander";
import { resolveBaseUrl, resolveContextText, resolveJwt, setConfigValue } from "./config.js";
import { TaskNodeApi } from "./tasknode_api.js";
import { TransactionSigner } from "./index.js";

type JsonValue = Record<string, unknown>;

function requireJwt(): string {
  const jwt = resolveJwt();
  if (!jwt) {
    throw new Error("JWT missing. Set PFT_TASKNODE_JWT or run: pft-cli auth set-token <jwt>");
  }
  return jwt;
}

function getApi() {
  const jwt = requireJwt();
  return new TaskNodeApi(jwt, resolveBaseUrl());
}

async function printJson(value: JsonValue) {
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
    await printJson(summary as JsonValue);
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
    await printJson(summary as JsonValue);
  });

program
  .command("tasks:list")
  .description("List tasks from summary by status")
  .option("--status <status>", "outstanding|pending|rewarded|refused|cancelled", "outstanding")
  .action(async (opts) => {
    const api = getApi();
    const summary = await api.getTasksSummary();
    const status = opts.status;
    const tasks = (summary as any)?.tasks?.[status] || [];
    await printJson({ status, tasks });
  });

program
  .command("tasks:get")
  .description("Get a task by ID")
  .argument("<taskId>", "Task ID")
  .action(async (taskId) => {
    const api = getApi();
    const task = await api.getTask(taskId);
    await printJson(task as JsonValue);
  });

program
  .command("tasks:accept")
  .description("Accept a pending task")
  .argument("<taskId>", "Task ID")
  .action(async (taskId) => {
    const api = getApi();
    const result = await api.acceptTask(taskId);
    await printJson(result as JsonValue);
  });

// Chat
program
  .command("chat:send")
  .description("Send a chat message (task request, discussion, etc.)")
  .requiredOption("--content <content>", "Message content")
  .option("--context <context>", "Context text (falls back to config/env)")
  .action(async (opts) => {
    const api = getApi();
    const contextText = opts.context || resolveContextText();
    if (!contextText) {
      throw new Error("Context text missing. Set PFT_CONTEXT_TEXT or pass --context.");
    }
    const response = await api.sendChat(opts.content, contextText);
    await printJson(response as JsonValue);
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
  .option("--node-url <url>", "XRPL node URL", "https://rpc.testnet.postfiat.org:6008")
  .action(async (opts) => {
    const api = getApi();
    const seed = process.env.PFT_WALLET_SEED;
    if (!seed) throw new Error("PFT_WALLET_SEED is required for signing.");

    const accountSummary = await api.getAccountSummary();
    const pubkey = (accountSummary as any)?.tasknode_encryption_pubkey;

    if (!opts.content && !opts.file && !opts.artifactJson) {
      throw new Error("Provide --content, --file, or --artifact-json for evidence.");
    }

    const upload = await api.uploadEvidence(opts.taskId, {
      verificationType: opts.type,
      artifact: opts.content || "",
      artifactJson: opts.artifactJson,
      filePath: opts.file,
      x25519Pubkey: pubkey,
    });

    const evidenceId = (upload as any)?.evidence_id || (upload as any)?.evidenceId;
    const cid = (upload as any)?.cid;
    if (!cid || !evidenceId) {
      throw new Error("Evidence upload missing cid or evidence_id.");
    }

    const pointer = await api.preparePointer({
      cid,
      task_id: opts.taskId,
      kind: opts.kind,
      schema: Number(opts.schema),
      flags: Number(opts.flags),
    });

    const txJson = (pointer as any)?.tx_json;
    if (!txJson) throw new Error("Pointer prepare missing tx_json.");

    const signer = new TransactionSigner(seed, opts.nodeUrl);
    const txHash = await signer.signAndSubmit(txJson);

    const submit = await api.submitEvidence(opts.taskId, {
      cid,
      tx_hash: txHash,
      artifact_type: opts.type,
      evidence_id: evidenceId,
    });

    await printJson({ upload, pointer, tx_hash: txHash, submit } as JsonValue);
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
  .option("--node-url <url>", "XRPL node URL", "https://rpc.testnet.postfiat.org:6008")
  .action(async (opts) => {
    const api = getApi();
    const seed = process.env.PFT_WALLET_SEED;
    if (!seed) throw new Error("PFT_WALLET_SEED is required for signing.");

    const respond = await api.respondVerification(opts.taskId, opts.type, opts.response);
    const evidenceId = (respond as any)?.evidence?.evidence_id || (respond as any)?.evidence?.id;
    const cid = (respond as any)?.evidence?.cid;
    if (!cid || !evidenceId) {
      throw new Error("Verification response missing cid or evidence_id.");
    }

    const pointer = await api.preparePointer({
      cid,
      task_id: opts.taskId,
      kind: opts.kind,
      schema: Number(opts.schema),
      flags: Number(opts.flags),
    });

    const txJson = (pointer as any)?.tx_json;
    if (!txJson) throw new Error("Pointer prepare missing tx_json.");

    const signer = new TransactionSigner(seed, opts.nodeUrl);
    const txHash = await signer.signAndSubmit(txJson);

    const submit = await api.submitVerification(opts.taskId, {
      cid,
      tx_hash: txHash,
      artifact_type: opts.type,
      evidence_id: evidenceId,
    });

    await printJson({ respond, pointer, tx_hash: txHash, submit } as JsonValue);
  });

// Watch task status
program
  .command("tasks:watch")
  .description("Poll a task until rewarded or refused")
  .argument("<taskId>", "Task ID")
  .option("--interval <seconds>", "Poll interval (seconds)", "15")
  .action(async (taskId, opts) => {
    const api = getApi();
    const intervalMs = Number(opts.interval) * 1000;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const task = await api.getTask(taskId);
      const status = (task as any)?.task?.status;
      process.stdout.write(`[${new Date().toISOString()}] status=${status}\n`);
      if (status === "rewarded" || status === "refused" || status === "cancelled") {
        await printJson(task as JsonValue);
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  });

program.parseAsync(process.argv).catch((err) => {
  process.stderr.write(`${String(err)}\n`);
  process.exit(1);
});
