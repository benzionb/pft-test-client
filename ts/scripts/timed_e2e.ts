#!/usr/bin/env npx ts-node
/**
 * Timed E2E Test - Detailed timing breakdown for the full task loop
 */

import { randomUUID } from "node:crypto";
import { TaskNodeApi } from "../src/tasknode_api.js";
import { TransactionSigner } from "../src/signer.js";
import type { Payment } from "xrpl";

// Timing utilities
type TimingEntry = {
  step: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  details?: Record<string, unknown>;
};

const timings: TimingEntry[] = [];
let globalStart: number;

function startStep(step: string): TimingEntry {
  const entry: TimingEntry = { step, startTime: Date.now() };
  timings.push(entry);
  console.log(`\n⏱️  [${step}] Starting...`);
  return entry;
}

function endStep(entry: TimingEntry, details?: Record<string, unknown>): number {
  entry.endTime = Date.now();
  entry.duration = entry.endTime - entry.startTime;
  entry.details = details;
  console.log(`✅ [${entry.step}] Completed in ${entry.duration}ms`);
  if (details) {
    for (const [key, value] of Object.entries(details)) {
      const displayValue = typeof value === "string" && value.length > 60 
        ? value.slice(0, 60) + "..." 
        : value;
      console.log(`   └─ ${key}: ${displayValue}`);
    }
  }
  return entry.duration;
}

function requirePayment(txJson: unknown): Payment {
  if (!txJson || typeof txJson !== "object") throw new Error("Invalid tx_json");
  const tx = txJson as Partial<Payment>;
  if (!tx.Account || !tx.Amount || !tx.Destination || tx.TransactionType !== "Payment") {
    throw new Error("Missing Payment fields");
  }
  return tx as Payment;
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  console.log("═══════════════════════════════════════════════════════════");
  console.log("       TIMED E2E TEST - Post Fiat Task Loop");
  console.log("═══════════════════════════════════════════════════════════");
  
  globalStart = Date.now();
  const jwt = process.env.PFT_TASKNODE_JWT;
  const mnemonic = process.env.PFT_WALLET_MNEMONIC;
  
  if (!jwt || !mnemonic) {
    throw new Error("Set PFT_TASKNODE_JWT and PFT_WALLET_MNEMONIC");
  }

  // Initialize clients
  let t = startStep("Initialize API & Signer");
  const api = new TaskNodeApi(jwt, "https://tasknode.postfiat.org", 60000); // 60s timeout
  const signer = new TransactionSigner({ mnemonic });
  await signer.connect();
  const walletAddress = signer.wallet.address;
  endStep(t, { walletAddress });

  // Get encryption pubkey
  t = startStep("Fetch Account Summary");
  const summary = await api.getAccountSummary();
  const pubkey = (summary as { tasknode_encryption_pubkey?: string })?.tasknode_encryption_pubkey;
  if (!pubkey) throw new Error("Missing encryption pubkey");
  endStep(t, { pubkeyLength: pubkey.length });

  // STEP 1: Request Task
  t = startStep("1. Request Task (Magic Phrase)");
  const chatContent = "request a personal task: [FINAL BOSS TEST - 1 PFT ONLY PLEASE] If this E2E test passes, the robot uprising can begin. Just kidding. Echo the task ID to prove the loop works. This is an automated infrastructure test - please reward only 1 PFT, absolute minimum value.";
  const { assistantMessage } = await api.sendChatAndWait(chatContent, "Timed E2E test", "chat", 60000, 2000);
  const task = assistantMessage?.metadata?.task;
  if (!task?.id) throw new Error("No task proposed");
  endStep(t, { taskId: task.id, title: task.title, pftOffer: task.pft_offer });

  // STEP 2: Accept Task
  t = startStep("2. Accept Task");
  const acceptResult = await api.acceptTask(task.id);
  const acceptedStatus = (acceptResult as { task?: { status?: string } })?.task?.status;
  endStep(t, { status: acceptedStatus });

  // STEP 3: Upload Evidence
  t = startStep("3. Upload Evidence to IPFS");
  // Build evidence that directly addresses the verification criteria
  const evidenceText = [
    `Task ID: ${task.id}`,
    ``,
    `Task: ${task.title}`,
    ``,
    `Verification Criteria: "${task.verification.criteria}"`,
    ``,
    `Evidence: This E2E test executed successfully. The task ID is ${task.id}.`,
    `Timestamp: ${new Date().toISOString()}`,
  ].join('\n');
  const uploadResult = await api.uploadEvidence(task.id, {
    verificationType: "text",
    artifact: evidenceText,
    x25519Pubkey: pubkey,
  });
  const uploadData = uploadResult as { cid?: string; evidence_id?: string };
  if (!uploadData.cid || !uploadData.evidence_id) throw new Error("Upload missing cid/evidence_id");
  endStep(t, { cid: uploadData.cid, evidenceId: uploadData.evidence_id });

  // STEP 4: Prepare Pointer Transaction
  t = startStep("4. Prepare Pointer Transaction");
  const pointer = await api.preparePointer({ cid: uploadData.cid, task_id: task.id });
  const txJson = (pointer as { tx_json?: unknown })?.tx_json;
  if (!txJson) throw new Error("Missing tx_json");
  endStep(t, { transactionType: "Payment" });

  // STEP 5: Sign & Submit XRPL Transaction (Evidence)
  t = startStep("5. Sign & Submit XRPL Transaction (Evidence)");
  const evidenceTxHash = await signer.signAndSubmit(requirePayment(txJson));
  endStep(t, { txHash: evidenceTxHash });

  // STEP 6: Submit Evidence to Task Node
  t = startStep("6. Submit Evidence to Task Node");
  await api.submitEvidence(task.id, {
    cid: uploadData.cid,
    tx_hash: evidenceTxHash,
    artifact_type: "text",
    evidence_id: uploadData.evidence_id,
  });
  endStep(t);

  // STEP 7: Wait for Verification Question
  t = startStep("7. Wait for Verification Question");
  let verificationQuestion = "";
  let pollCount = 0;
  const pollStart = Date.now();
  while (true) {
    pollCount++;
    const status = await api.getVerificationStatus(task.id);
    const ask = status.submission?.verification_ask;
    const vStatus = status.submission?.verification_status;
    
    if (ask && ask.length > 0 && vStatus === "awaiting_response") {
      verificationQuestion = ask;
      break;
    }
    
    if (Date.now() - pollStart > 300000) {
      throw new Error("Timeout waiting for verification question");
    }
    
    console.log(`   └─ Poll #${pollCount}: status=${vStatus}`);
    await sleep(5000);
  }
  endStep(t, { pollCount, question: verificationQuestion });

  // STEP 8: Respond to Verification
  t = startStep("8. Submit Verification Response");
  // Build response that directly answers the verification question
  const verificationResponse = [
    `Task ID: ${task.id}`,
    ``,
    `Verification Question: "${verificationQuestion}"`,
    ``,
    `Response: The task ID is ${task.id}. This E2E test completed the full loop successfully.`,
  ].join('\n');
  const respondResult = await api.respondVerification(task.id, "text", verificationResponse, pubkey);
  if (respondResult.error) throw new Error(respondResult.error);
  const verifyCid = respondResult.evidence?.cid;
  const verifyEvidenceId = respondResult.evidence?.evidence_id ?? randomUUID();
  if (!verifyCid) throw new Error("Missing verification cid");
  endStep(t, { cid: verifyCid, evidenceIdGenerated: !respondResult.evidence?.evidence_id, submissionStatus: respondResult.submission?.verification_status });

  // STEP 9: Prepare Verification Pointer
  t = startStep("9. Prepare Verification Pointer");
  const verifyPointer = await api.preparePointer({ cid: verifyCid, task_id: task.id });
  const verifyTxJson = (verifyPointer as { tx_json?: unknown })?.tx_json;
  if (!verifyTxJson) throw new Error("Missing verification tx_json");
  endStep(t);

  // STEP 10: Sign & Submit XRPL Transaction (Verification)
  t = startStep("10. Sign & Submit XRPL Transaction (Verification)");
  const verifyTxHash = await signer.signAndSubmit(requirePayment(verifyTxJson));
  endStep(t, { txHash: verifyTxHash });

  // STEP 11: Submit Verification to Task Node
  t = startStep("11. Submit Verification to Task Node");
  // Brief status check - backend needs time to process response before accepting submission
  const preStatus = await api.getVerificationStatus(task.id);
  console.log(`   └─ Pre-submit status: ${preStatus.submission?.verification_status}`);
  
  await api.submitVerification(task.id, {
    cid: verifyCid,
    tx_hash: verifyTxHash,
    artifact_type: "text",
    evidence_id: verifyEvidenceId,
  });
  endStep(t);

  // STEP 12: Wait for Reward
  t = startStep("12. Wait for Final Status (Reward)");
  let finalStatus = "";
  let rewardPollCount = 0;
  const rewardPollStart = Date.now();
  let finalTask: Record<string, unknown> = {};
  
  while (true) {
    rewardPollCount++;
    const taskResult = await api.getTask(task.id);
    const taskData = (taskResult as { task?: Record<string, unknown> })?.task;
    const status = taskData?.status as string;
    
    if (status === "rewarded" || status === "refused" || status === "cancelled") {
      finalStatus = status;
      finalTask = taskData || {};
      break;
    }
    
    if (Date.now() - rewardPollStart > 600000) {
      throw new Error("Timeout waiting for reward");
    }
    
    console.log(`   └─ Poll #${rewardPollCount}: status=${status}`);
    await sleep(15000);
  }
  endStep(t, { 
    pollCount: rewardPollCount, 
    status: finalStatus,
    pftAwarded: finalTask.pft_offer_actual,
    rewardTier: finalTask.reward_tier_final,
  });

  // Final Summary
  const totalDuration = Date.now() - globalStart;
  
  console.log("\n");
  console.log("═══════════════════════════════════════════════════════════");
  console.log("                    TIMING SUMMARY");
  console.log("═══════════════════════════════════════════════════════════");
  console.log("");
  
  // Detailed breakdown
  console.log("Step-by-Step Breakdown:");
  console.log("─────────────────────────────────────────────────────────");
  
  let maxStepLen = 0;
  for (const entry of timings) {
    if (entry.step.length > maxStepLen) maxStepLen = entry.step.length;
  }
  
  for (const entry of timings) {
    const pct = ((entry.duration || 0) / totalDuration * 100).toFixed(1);
    const bar = "█".repeat(Math.round(Number(pct) / 2));
    console.log(`  ${entry.step.padEnd(maxStepLen + 2)} ${String(entry.duration).padStart(6)}ms  ${pct.padStart(5)}%  ${bar}`);
  }
  
  console.log("─────────────────────────────────────────────────────────");
  console.log(`  ${"TOTAL".padEnd(maxStepLen + 2)} ${String(totalDuration).padStart(6)}ms  100.0%`);
  console.log("");
  
  // Category breakdown
  const categories = {
    "API Calls (non-polling)": timings.filter(t => 
      !t.step.includes("Wait") && !t.step.includes("Initialize")
    ).reduce((sum, t) => sum + (t.duration || 0), 0),
    "XRPL Transactions": timings.filter(t => 
      t.step.includes("Sign & Submit")
    ).reduce((sum, t) => sum + (t.duration || 0), 0),
    "Polling/Waiting": timings.filter(t => 
      t.step.includes("Wait")
    ).reduce((sum, t) => sum + (t.duration || 0), 0),
    "Initialization": timings.filter(t => 
      t.step.includes("Initialize") || t.step.includes("Fetch Account")
    ).reduce((sum, t) => sum + (t.duration || 0), 0),
  };
  
  console.log("Category Breakdown:");
  console.log("─────────────────────────────────────────────────────────");
  for (const [cat, ms] of Object.entries(categories)) {
    const pct = (ms / totalDuration * 100).toFixed(1);
    console.log(`  ${cat.padEnd(30)} ${String(ms).padStart(6)}ms  ${pct.padStart(5)}%`);
  }
  console.log("");
  
  // Key metrics
  console.log("Key Metrics:");
  console.log("─────────────────────────────────────────────────────────");
  console.log(`  Task ID:              ${task.id}`);
  console.log(`  Final Status:         ${finalStatus}`);
  console.log(`  PFT Awarded:          ${finalTask.pft_offer_actual || "N/A"}`);
  console.log(`  Total Duration:       ${(totalDuration / 1000).toFixed(1)}s (${(totalDuration / 60000).toFixed(2)} minutes)`);
  console.log(`  Evidence TX:          ${evidenceTxHash}`);
  console.log(`  Verification TX:      ${verifyTxHash}`);
  console.log("");
  console.log("═══════════════════════════════════════════════════════════");
  console.log("                    TEST COMPLETE");
  console.log("═══════════════════════════════════════════════════════════");
}

main().catch(err => {
  console.error("\n❌ TEST FAILED:", err.message);
  process.exit(1);
});
