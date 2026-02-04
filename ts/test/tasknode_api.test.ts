import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TaskNodeApi } from "../src/tasknode_api.js";

/**
 * Regression test for getTaskRewardData()
 * 
 * Background: The individual task endpoint (/api/tasks/{id}) does NOT populate
 * reward fields (rewardSummary, rewardTier, rewardScore, txHash). These fields
 * are only available from the summary endpoint (/api/tasks/summary).
 * 
 * This test verifies that getTaskRewardData() correctly fetches from the
 * summary endpoint and extracts reward data for a specific task.
 * 
 * Related commit: fix: fetch reward summary from summary endpoint (6a83011)
 */

describe("TaskNodeApi.getTaskRewardData", () => {
  const TEST_JWT = "test-jwt-token";
  const TEST_TASK_ID = "test-task-777";
  
  // Mock summary response matching actual API structure
  const mockSummaryResponse = {
    alignment: "test",
    counts: { rewarded: 1, refused: 0 },
    rewarded_total_pft: "777.77",
    tasks: {
      rewarded: [
        {
          id: TEST_TASK_ID,
          title: "Lucky Task",
          pft: "777.77",
          rewardTier: "exceptional",
          rewardScore: "77",
          rewardSummary: "This task was completed with exceptional luck. 777.77 PFT - no more, no less.",
          txHash: "LUCKY777HASH",
          status: "rewarded",
        },
        {
          id: "other-task",
          title: "Other Task",
          pft: "100",
          rewardTier: "standard",
          rewardScore: "50",
          rewardSummary: "Standard completion",
          txHash: "OTHERHASH",
          status: "rewarded",
        },
      ],
      refused: [],
      cancelled: [],
    },
  };

  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    // Mock fetch to return our test data
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockSummaryResponse),
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("extracts reward data from summary endpoint for a specific task", async () => {
    const api = new TaskNodeApi(TEST_JWT);
    const rewardData = await api.getTaskRewardData(TEST_TASK_ID);

    expect(rewardData).not.toBeNull();
    expect(rewardData!.id).toBe(TEST_TASK_ID);
    expect(rewardData!.title).toBe("Lucky Task");
    expect(rewardData!.pft).toBe("777.77");
    expect(rewardData!.rewardTier).toBe("exceptional");
    expect(rewardData!.rewardScore).toBe("77");
    expect(rewardData!.rewardSummary).toContain("777.77 PFT");
    expect(rewardData!.txHash).toBe("LUCKY777HASH");
    expect(rewardData!.status).toBe("rewarded");
  });

  it("returns null when task is not found in summary", async () => {
    const api = new TaskNodeApi(TEST_JWT);
    const rewardData = await api.getTaskRewardData("nonexistent-task-id");

    expect(rewardData).toBeNull();
  });

  it("fetches from /api/tasks/summary endpoint", async () => {
    const api = new TaskNodeApi(TEST_JWT);
    await api.getTaskRewardData(TEST_TASK_ID);

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/tasks/summary"),
      expect.any(Object)
    );
  });

  it("handles missing optional fields gracefully", async () => {
    // Mock a task with missing optional fields
    const sparseResponse = {
      ...mockSummaryResponse,
      tasks: {
        rewarded: [
          {
            id: "sparse-task",
            title: "Sparse Task",
            // pft, rewardTier, rewardScore, rewardSummary, txHash all missing
          },
        ],
      },
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(sparseResponse),
    });

    const api = new TaskNodeApi(TEST_JWT);
    const rewardData = await api.getTaskRewardData("sparse-task");

    expect(rewardData).not.toBeNull();
    expect(rewardData!.id).toBe("sparse-task");
    expect(rewardData!.pft).toBe("0"); // Default when missing
    expect(rewardData!.rewardTier).toBeNull();
    expect(rewardData!.rewardScore).toBeNull();
    expect(rewardData!.rewardSummary).toBeNull();
    expect(rewardData!.txHash).toBeNull();
  });

  it("searches across rewarded, refused, and cancelled categories", async () => {
    const multiCategoryResponse = {
      ...mockSummaryResponse,
      tasks: {
        rewarded: [],
        refused: [
          {
            id: "refused-task",
            title: "Refused Task",
            status: "refused",
          },
        ],
        cancelled: [
          {
            id: "cancelled-task", 
            title: "Cancelled Task",
            status: "cancelled",
          },
        ],
      },
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(multiCategoryResponse),
    });

    const api = new TaskNodeApi(TEST_JWT);
    
    const refusedData = await api.getTaskRewardData("refused-task");
    expect(refusedData).not.toBeNull();
    expect(refusedData!.status).toBe("refused");

    const cancelledData = await api.getTaskRewardData("cancelled-task");
    expect(cancelledData).not.toBeNull();
    expect(cancelledData!.status).toBe("cancelled");
  });
});
