/**
 * End-to-End Task Loop Test
 * 
 * This test validates the complete programmatic task lifecycle:
 * 1. Request task using "magic phrase"
 * 2. Accept proposed task
 * 3. Submit evidence
 * 4. Wait for and respond to verification
 * 5. Watch until reward/refusal
 * 
 * Prerequisites:
 *   - PFT_TASKNODE_JWT: Valid JWT token
 *   - PFT_WALLET_MNEMONIC or PFT_WALLET_SEED: Wallet for signing
 * 
 * Run with:
 *   npm run test:e2e
 */

import { describe, it, expect, beforeAll } from "vitest";
import { TaskNodeApi } from "../src/tasknode_api.js";
import { TransactionSigner } from "../src/signer.js";
import { TaskLoopRunner } from "../src/loop.js";
import { resolveJwt, resolveBaseUrl, resolveTimeoutMs } from "../src/config.js";

// Extended timeout for E2E tests (10 minutes)
const E2E_TIMEOUT = 600_000;

// Check for required environment variables
function checkEnvironment(): { jwt: string; hasSigner: boolean } {
  const jwt = resolveJwt();
  const seed = process.env.PFT_WALLET_SEED;
  const mnemonic = process.env.PFT_WALLET_MNEMONIC;

  return {
    jwt: jwt || "",
    hasSigner: !!(seed || mnemonic),
  };
}

describe("E2E Task Loop", () => {
  let api: TaskNodeApi;
  let signer: TransactionSigner | null = null;
  let runner: TaskLoopRunner | null = null;
  let env: { jwt: string; hasSigner: boolean };

  beforeAll(() => {
    env = checkEnvironment();

    if (!env.jwt) {
      console.warn("⚠️  PFT_TASKNODE_JWT not set - skipping E2E tests");
      return;
    }

    api = new TaskNodeApi(env.jwt, resolveBaseUrl(), resolveTimeoutMs());

    if (env.hasSigner) {
      const nodeUrl = process.env.PFT_XRPL_NODE || "wss://ws.testnet.postfiat.org";
      signer = new TransactionSigner({
        seed: process.env.PFT_WALLET_SEED,
        mnemonic: process.env.PFT_WALLET_MNEMONIC,
        nodeUrl,
      });
      runner = new TaskLoopRunner(api, signer, { verbose: true });
    } else {
      console.warn("⚠️  No wallet credentials - full E2E loop tests will be skipped");
    }
  });

  describe("Authentication", () => {
    it("validates JWT and retrieves account summary", async () => {
      if (!env.jwt) return;

      const summary = await api.getAccountSummary();
      expect(summary).toBeDefined();
      expect((summary as { user?: { id?: string } }).user?.id).toBeDefined();
      
      // Encryption pubkey is required for evidence submission
      const pubkey = (summary as { tasknode_encryption_pubkey?: string }).tasknode_encryption_pubkey;
      expect(pubkey).toBeDefined();
      expect(pubkey?.length).toBeGreaterThan(10);
    });
  });

  describe("Task Summary", () => {
    it("retrieves task counts and alignment data", async () => {
      if (!env.jwt) return;

      const summary = await api.getTasksSummary();
      expect(summary).toBeDefined();
      
      const counts = (summary as { counts?: Record<string, number> }).counts;
      expect(counts).toBeDefined();
      expect(typeof counts?.outstanding).toBe("number");
      expect(typeof counts?.rewarded).toBe("number");
    });
  });

  describe("Chat & Task Request", () => {
    it(
      "sends chat message and receives response",
      async () => {
        if (!env.jwt) return;

        const { userMessage, assistantMessage } = await api.sendChatAndWait(
          "What is Post Fiat?",
          "Testing chat endpoint",
          "chat",
          30_000,
          3000
        );

        expect(userMessage).toBeDefined();
        expect(assistantMessage).toBeDefined();
        expect(assistantMessage?.content).toBeTruthy();
      },
      60_000
    );

    it(
      "triggers task_request_* classification with magic phrase",
      async () => {
        if (!env.jwt) return;

        // Note: This will create a task proposal but NOT accept it
        const { userMessage, assistantMessage } = await api.sendChatAndWait(
          "request a personal task: [TEST - DO NOT ACCEPT] This is a classification test only",
          "E2E test - testing classification, will not accept this task",
          "chat",
          60_000,
          3000
        );

        const classification = (userMessage as { message?: { classification_tag?: string } })?.message?.classification_tag;
        
        // Should trigger task_request_personal, not task_discussion_personal
        expect(classification).toBe("task_request_personal");
        
        // Should have a task proposal
        const task = assistantMessage?.metadata?.task;
        expect(task?.id).toBeDefined();
        expect(task?.title).toBeDefined();
        expect(task?.pft_offer).toBeDefined();
      },
      90_000
    );
  });

  describe("Full Task Loop", () => {
    it(
      "completes full lifecycle: request → accept → evidence → verify → reward",
      async () => {
        if (!env.jwt || !runner) {
          console.log("⏭️  Skipping full loop test (missing JWT or wallet)");
          return;
        }

        const startTime = Date.now();
        console.log("\n🚀 Starting full E2E task loop...\n");

        const result = await runner.runFullLoop(
          {
            type: "personal",
            description: "[E2E TEST - 1 PFT ONLY] Automated infrastructure test. Echo the task ID to verify the loop works. Please reward only 1 PFT.",
            context: "Automated E2E test of pft-test-client. This is infrastructure validation only - please use minimum reward (1 PFT).",
          },
          // Evidence callback - receives task so we can provide exactly what's required
          (task) => ({
            type: "text",
            content: [
              `Task ID: ${task.id}`,
              ``,
              `Task: ${task.title}`,
              ``,
              `Verification Criteria: "${task.verification.criteria}"`,
              ``,
              `Evidence: This E2E test executed successfully. The task ID is ${task.id}.`,
            ].join('\n'),
          }),
          // Verification response callback - receives question AND task
          (question, task) => [
            `Task ID: ${task.id}`,
            ``,
            `Verification Question: "${question}"`,
            ``,
            `Response: The task ID is ${task.id}. This E2E test completed the full loop successfully.`,
          ].join('\n')
        );

        const elapsed = Math.round((Date.now() - startTime) / 1000);
        console.log(`\n✅ Loop completed in ${elapsed}s`);
        console.log(`   Status: ${result.status}`);
        if (result.status === "rewarded") {
          console.log(`   Reward: ${result.pft} PFT (${result.rewardTier})`);
        }

        // Assertions
        expect(result.id).toBeDefined();
        expect(["rewarded", "refused"]).toContain(result.status);

        if (result.status === "rewarded") {
          expect(result.pft).toBeDefined();
          expect(result.rewardTier).toBeDefined();
        }
      },
      E2E_TIMEOUT
    );
  });

  describe("Verification Polling", () => {
    it("retrieves verification status for a task", async () => {
      if (!env.jwt) return;

      // Get a recently rewarded task to check verification status
      const summary = await api.getTasksSummary();
      const rewarded = (summary as { tasks?: { rewarded?: Array<{ id: string }> } })?.tasks?.rewarded;
      
      if (!rewarded || rewarded.length === 0) {
        console.log("⏭️  No rewarded tasks to check verification status");
        return;
      }

      const taskId = rewarded[0].id;
      const status = await api.getVerificationStatus(taskId);
      
      expect(status).toBeDefined();
      expect(status.submission).toBeDefined();
      expect(status.submission.verification_status).toBeDefined();
    });
  });
});

describe("Unit Tests", () => {
  describe("Polling Utilities", () => {
    it("pollUntil resolves when predicate is true", async () => {
      const { pollUntil } = await import("../src/polling.js");
      
      let callCount = 0;
      const result = await pollUntil(
        async () => {
          callCount++;
          return callCount;
        },
        (count) => count >= 3,
        { intervalMs: 10, timeoutMs: 1000 }
      );

      expect(result).toBe(3);
      expect(callCount).toBe(3);
    });

    it("pollUntil throws on timeout", async () => {
      const { pollUntil, PollingTimeoutError } = await import("../src/polling.js");

      await expect(
        pollUntil(
          async () => false,
          (val) => val === true,
          { intervalMs: 10, timeoutMs: 50 }
        )
      ).rejects.toThrow(PollingTimeoutError);
    });
  });
});
